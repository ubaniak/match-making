-- Events: one-day or multi-day competitions, each owned by a coach.
-- An Admin creates the event and picks the owning coach. That coach can edit the event
-- (dates, venue, weigh-in and bout times) and add or remove athletes. Members can view events.

insert into public.permissions (id, description) values
  ('events:read', 'View events and who is entered'),
  ('events:create', 'Create and delete events, and choose their owning coach'),
  ('events:manage', 'Edit an event''s details and times, and add or remove its athletes');

insert into public.role_permissions (role_id, permission, scope) values
  ('official', 'events:read', 'any'),
  ('coach', 'events:read', 'any'),
  ('coach', 'events:manage', 'own'),
  ('athlete', 'events:read', 'any');

-- Members need to see a coach's name next to the events and athletes they look after.
create policy "members read coach profiles" on public.profiles for select to authenticated
  using (role_id = 'coach' and public.has_permission('pages:read'));

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.events (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  venue text,
  start_date date not null,
  end_date date not null,
  owner_id uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  check (end_date >= start_date),
  check (end_date - start_date < 31)
);

-- One row per day of the event, with that day's weigh-in and first-bout times (event local time).
create table public.event_days (
  event_id uuid not null references public.events (id) on delete cascade,
  day date not null,
  weigh_in_time time not null,
  bouts_time time not null,
  primary key (event_id, day)
);

create table public.event_athletes (
  event_id uuid not null references public.events (id) on delete cascade,
  athlete_id uuid not null references public.athletes (id) on delete cascade,
  added_by uuid default auth.uid() references public.profiles (id) on delete set null,
  added_at timestamptz not null default now(),
  primary key (event_id, athlete_id)
);

create index event_athletes_athlete_idx on public.event_athletes (athlete_id);

-- The coach who owns an event, for RLS checks on its child rows.
create function public.event_owner(p_event_id uuid) returns uuid
language sql stable security definer set search_path = public
as $$
  select owner_id from public.events where id = p_event_id
$$;

-- ---------------------------------------------------------------------------
-- Rules: the owner must be a coach, and only Admins can change who owns an event
-- ---------------------------------------------------------------------------

create function public.check_event() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();

  if tg_op = 'UPDATE' and new.owner_id is distinct from old.owner_id
     and not public.has_permission('events:create') then
    raise exception 'Only Admins can change who owns an event' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' or new.owner_id is distinct from old.owner_id then
    if not exists (select 1 from public.profiles where id = new.owner_id and role_id = 'coach' and status = 'active') then
      raise exception 'An event''s owner must be an active coach' using errcode = '23514';
    end if;
  end if;

  -- Days that fall outside new dates go with them.
  if tg_op = 'UPDATE' then
    delete from public.event_days
    where event_id = new.id and (day < new.start_date or day > new.end_date);
  end if;
  return new;
end;
$$;

create trigger check_event
  before insert or update on public.events
  for each row execute function public.check_event();

-- Create or update an event and its daily schedule in one go.
-- p_days is a JSON array of {"day": "YYYY-MM-DD", "weigh_in_time": "HH:MM", "bouts_time": "HH:MM"},
-- with exactly one entry for each day from start to end. Runs as the caller, so RLS still applies.
create function public.save_event(
  p_id uuid,
  p_name text,
  p_venue text,
  p_start_date date,
  p_end_date date,
  p_owner_id uuid,
  p_days jsonb
) returns uuid
language plpgsql security invoker set search_path = public
as $$
declare
  v_id uuid := p_id;
  day_count int;
begin
  select count(distinct (d ->> 'day')::date) into day_count
  from jsonb_array_elements(p_days) d
  where (d ->> 'day')::date between p_start_date and p_end_date
    and nullif(d ->> 'weigh_in_time', '') is not null
    and nullif(d ->> 'bouts_time', '') is not null;
  if day_count <> (p_end_date - p_start_date + 1) or jsonb_array_length(p_days) <> day_count then
    raise exception 'Every day of the event needs a weigh-in time and a bout time' using errcode = '22023';
  end if;

  if v_id is null then
    insert into public.events (name, venue, start_date, end_date, owner_id)
    values (trim(p_name), nullif(trim(p_venue), ''), p_start_date, p_end_date, p_owner_id)
    returning id into v_id;
  else
    update public.events
    set name = trim(p_name), venue = nullif(trim(p_venue), ''),
        start_date = p_start_date, end_date = p_end_date, owner_id = p_owner_id
    where id = v_id;
    if not found then
      raise exception 'You can''t edit that event' using errcode = '42501';
    end if;
  end if;

  delete from public.event_days where event_id = v_id;
  insert into public.event_days (event_id, day, weigh_in_time, bouts_time)
  select v_id, (d ->> 'day')::date, (d ->> 'weigh_in_time')::time, (d ->> 'bouts_time')::time
  from jsonb_array_elements(p_days) d;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.events enable row level security;
alter table public.event_days enable row level security;
alter table public.event_athletes enable row level security;

create policy "read events" on public.events for select to authenticated
  using (public.has_permission('events:read'));
create policy "create events" on public.events for insert to authenticated
  with check (public.has_permission('events:create'));
create policy "edit events" on public.events for update to authenticated
  using (public.has_permission('events:manage', owner_id))
  with check (public.has_permission('events:manage', owner_id));
create policy "delete events" on public.events for delete to authenticated
  using (public.has_permission('events:create'));

create policy "read event days" on public.event_days for select to authenticated
  using (public.has_permission('events:read'));
create policy "manage event days" on public.event_days for all to authenticated
  using (public.has_permission('events:manage', public.event_owner(event_id)))
  with check (public.has_permission('events:manage', public.event_owner(event_id)));

create policy "read event athletes" on public.event_athletes for select to authenticated
  using (public.has_permission('events:read'));
create policy "add event athletes" on public.event_athletes for insert to authenticated
  with check (public.has_permission('events:manage', public.event_owner(event_id)));
create policy "remove event athletes" on public.event_athletes for delete to authenticated
  using (public.has_permission('events:manage', public.event_owner(event_id)));

revoke execute on function public.save_event(uuid, text, text, date, date, uuid, jsonb) from public, anon;
grant execute on function public.save_event(uuid, text, text, date, date, uuid, jsonb) to authenticated;
revoke execute on function public.check_event() from public, anon, authenticated;
