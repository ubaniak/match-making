-- Migration 57: an athlete can be in the system only once, across every club.
--
-- Bhavek (2026-11-04): "the csv upload process allows 2 duplicate athletes. once an athlete is
-- entered you can't enter them again. Even if you enter them from another club".
--
-- The same athlete means either:
--   * the same name and date of birth. Names are compared ignoring case, spaces at the ends and
--     repeated spaces, so "ali  HASSAN " is the same as "Ali Hassan"; or
--   * the same Boxing Canada (BC) number, ignoring case and spaces at the ends.
--
-- What this migration does:
--   1. Cleans up duplicates already saved. In each group of copies it keeps one record and
--      deletes the others, but only copies that nothing points at (no event entry, bout,
--      weigh-in, transfer, or anything else). The record kept is the one that is in use, or the
--      oldest when none is. Any BC number, email, user link or last medical the deleted copy had
--      and the kept one lacks is moved onto the kept record.
--   2. If a group has two or more copies that are both in use (entered in events, in bouts...),
--      it stops and changes nothing, listing those athletes. Fix them by hand (withdraw or delete
--      one copy, or correct a name / date of birth / BC number), then run this again.
--   3. Adds unique indexes so the database refuses a second copy from now on, whoever adds it.
--   4. Adds find_athlete_duplicates(), which the add form and the CSV upload call to say which
--      club already has an athlete. Club owners can't read other clubs' athletes, so this runs as
--      the database owner and only answers for the exact name + date of birth or BC number asked.
--
-- To preview duplicates before running: project files sql/preview-duplicate-athletes.sql.
-- Runs after 20261104150000_answer_invitations_during_event.sql. Run it BEFORE deploying the app.

-- The name as compared: lower case, trimmed, single spaces.
create or replace function public.athlete_name_key(p_name text) returns text
language sql immutable parallel safe set search_path = public
as $$
  select lower(regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g'))
$$;

create or replace function public.athlete_bc_key(p_bc text) returns text
language sql immutable parallel safe set search_path = public
as $$
  select nullif(lower(trim(coalesce(p_bc, ''))), '')
$$;

-- A YYYY-MM-DD text as a date, or null when it isn't a real day.
create or replace function public.athlete_try_date(p_text text) returns date
language plpgsql immutable set search_path = public
as $$
begin
  if coalesce(p_text, '') !~ '^\d{4}-\d{2}-\d{2}$' then
    return null;
  end if;
  return p_text::date;
exception when others then
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1 and 2: clean up existing duplicates
-- ---------------------------------------------------------------------------

do $$
declare
  fk record;
  sql_text text := '';
  grp record;
  keeper uuid;
  extra record;
  problems text := '';
  pass text;
begin
  -- Every column in any table that points at athletes.id, found from the catalog so tables
  -- added by later migrations are covered too.
  create temporary table athlete_refs (athlete_id uuid primary key) on commit drop;
  for fk in
    select c.conrelid::regclass as tbl, a.attname as col
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
    where c.contype = 'f' and c.confrelid = 'public.athletes'::regclass
  loop
    execute format(
      'insert into athlete_refs select distinct %1$I from %2$s where %1$I is not null on conflict do nothing',
      fk.col, fk.tbl);
  end loop;

  foreach pass in array array['name', 'bc'] loop
    for grp in
      select array_agg(a.id order by (r.athlete_id is not null) desc, a.created_at, a.id) as ids,
             count(*) filter (where r.athlete_id is not null) as in_use,
             string_agg(format('%s (club %s, born %s, BC %s, id %s)%s',
                               a.name, coalesce(c.name, 'none'), coalesce(a.date_of_birth::text, '?'),
                               coalesce(a.bc_number, '-'), a.id,
                               case when r.athlete_id is not null then ' IN USE' else '' end),
                        '; ' order by a.created_at) as described
      from public.athletes a
      left join athlete_refs r on r.athlete_id = a.id
      left join public.clubs c on c.id = a.club_id
      where (pass = 'name' and a.date_of_birth is not null)
         or (pass = 'bc' and public.athlete_bc_key(a.bc_number) is not null)
      group by case when pass = 'name' then public.athlete_name_key(a.name) || '|' || a.date_of_birth::text
                    else public.athlete_bc_key(a.bc_number) end
      having count(*) > 1
    loop
      if grp.in_use > 1 then
        problems := problems || E'\n  - ' || grp.described;
        continue;
      end if;
      keeper := grp.ids[1];
      for extra in select * from public.athletes where id = any (grp.ids[2:]) loop
        -- Free up the user link (it's unique) before moving it to the kept record.
        delete from public.athletes where id = extra.id;
        update public.athletes k set
          bc_number    = coalesce(k.bc_number, extra.bc_number),
          invite_email = coalesce(k.invite_email, extra.invite_email),
          user_id      = coalesce(k.user_id, extra.user_id),
          last_medical = greatest(k.last_medical, extra.last_medical),
          updated_at   = now()
        where k.id = keeper;
        raise notice 'Removed duplicate athlete % (%), kept %', extra.name, extra.id, keeper;
      end loop;
    end loop;
  end loop;

  if problems <> '' then
    raise exception E'Some athletes are in the system more than once and more than one copy is in use (entered in an event, a bout, a transfer...). Nothing was changed. Fix these by hand, then run this migration again:%', problems
      using errcode = '23505';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3: the database refuses a second copy
-- ---------------------------------------------------------------------------

create unique index if not exists athletes_unique_name_dob
  on public.athletes (public.athlete_name_key(name), date_of_birth);

create unique index if not exists athletes_unique_bc_number
  on public.athletes (public.athlete_bc_key(bc_number))
  where public.athlete_bc_key(bc_number) is not null;

-- ---------------------------------------------------------------------------
-- 4: who already has this athlete?
-- ---------------------------------------------------------------------------

-- p_rows is a JSON array of {"name", "date_of_birth", "bc_number"} (each optional), and
-- p_ignore an athlete id to leave out (the one being edited). Returns one row per match:
-- the index of the row asked about (from 0), what matched, and the existing athlete's name
-- and club.
create or replace function public.find_athlete_duplicates(p_rows jsonb, p_ignore uuid default null)
returns table (row_index integer, matched_on text, athlete_name text, club_name text)
language sql stable security definer set search_path = public
as $$
  select (r.ord - 1)::integer,
         case when public.athlete_bc_key(r.item ->> 'bc_number') is not null
                   and public.athlete_bc_key(a.bc_number) = public.athlete_bc_key(r.item ->> 'bc_number')
              then 'bc_number' else 'name_dob' end,
         a.name,
         c.name
  from jsonb_array_elements(case when jsonb_typeof(p_rows) = 'array' then p_rows else '[]'::jsonb end)
         with ordinality as r(item, ord)
  join public.athletes a
    on (a.id is distinct from p_ignore)
   and (
         (public.athlete_bc_key(r.item ->> 'bc_number') is not null
           and public.athlete_bc_key(a.bc_number) = public.athlete_bc_key(r.item ->> 'bc_number'))
      or (a.date_of_birth = public.athlete_try_date(r.item ->> 'date_of_birth')
           and public.athlete_name_key(a.name) = public.athlete_name_key(r.item ->> 'name'))
       )
  left join public.clubs c on c.id = a.club_id
  where auth.uid() is not null
  order by 1
$$;

revoke execute on function public.find_athlete_duplicates(jsonb, uuid) from public, anon;
grant execute on function public.find_athlete_duplicates(jsonb, uuid) to authenticated;
