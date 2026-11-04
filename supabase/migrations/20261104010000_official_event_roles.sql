-- Migration 42 (Bhavek, 2026-11-04): "assign event roles to officials. The event roles are:
-- Judge, Referee, Supervisor, Timekeeper ... make these booleans so someone can be all 4 or just
-- one or a combination. The official can select them when they accept the event."
--
--   * official_invitations gets four yes/no columns. Accepting needs at least one of them; the
--     official can change them with their days until the event's first day. Declining clears them.
--   * Officials who already accepted keep their days and start with no roles; they pick them with
--     "Change days and roles". TEST officials get all four, for testing.
--   * Taking a bout (migration 41) no longer asks "Judge only" or "Ref and Judge". The official
--     ticks which of their event roles they do on that bout instead. Existing bout answers carry
--     over: Judge only -> Judge, Ref and Judge -> Referee and Judge.
--
-- Run after migration 41.

alter table public.official_invitations
  add column judge boolean not null default false,
  add column referee boolean not null default false,
  add column supervisor boolean not null default false,
  add column timekeeper boolean not null default false;

-- TEST officials (test data and demo accounts) who already accepted get every role, so testers can
-- take bouts straight away.
update public.official_invitations i set judge = true, referee = true, supervisor = true, timekeeper = true
from public.officials o
where o.id = i.official_id and i.status = 'accepted' and o.name like 'TEST %';

-- ---------------------------------------------------------------------------
-- Accepting with roles
-- ---------------------------------------------------------------------------

drop function public.respond_to_invitation(uuid, boolean, date[], text[]);
create function public.respond_to_invitation(
  p_invitation_id uuid, p_accept boolean, p_days date[] default null, p_sessions text[] default null,
  p_judge boolean default false, p_referee boolean default false,
  p_supervisor boolean default false, p_timekeeper boolean default false
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_inv public.official_invitations;
  v_event public.events;
  v_user uuid;
  v_days date[];
  v_sessions text[];
begin
  select * into v_inv from public.official_invitations where id = p_invitation_id;
  if not found then
    raise exception 'That invitation has been cancelled' using errcode = 'P0002';
  end if;
  select user_id into v_user from public.officials where id = v_inv.official_id;
  if v_user is null or v_user <> auth.uid() then
    raise exception 'Only the invited official can answer this invitation' using errcode = '42501';
  end if;
  select * into v_event from public.events where id = v_inv.event_id;
  if v_event.status <> 'active' or public.local_today(v_event.timezone) >= v_event.start_date then
    raise exception 'Answers are locked once the event starts. Contact the event''s Owner.' using errcode = '22023';
  end if;
  if v_inv.status = 'pending' and v_inv.respond_by is not null
     and public.local_today(v_event.timezone) > v_inv.respond_by then
    raise exception 'The respond-by date has passed. Ask the event''s Owner to invite you again.' using errcode = '22023';
  end if;

  if p_accept then
    if not (coalesce(p_judge, false) or coalesce(p_referee, false) or coalesce(p_supervisor, false) or coalesce(p_timekeeper, false)) then
      raise exception 'Pick at least one role: Judge, Referee, Supervisor or Timekeeper' using errcode = '22023';
    end if;
    select array_agg(distinct d order by d) into v_days
    from unnest(coalesce(p_days, (
      select array_agg(g::date) from generate_series(v_event.start_date, v_event.end_date, interval '1 day') g
    ))) d;
    if v_days is null then
      raise exception 'Pick at least one day you can officiate' using errcode = '22023';
    end if;
    if exists (select 1 from unnest(v_days) d where d < v_event.start_date or d > v_event.end_date) then
      raise exception 'Pick days of the event' using errcode = '22023';
    end if;
    select array_agg(distinct k order by k) into v_sessions from unnest(p_sessions) k;
    if exists (
      select 1 from unnest(v_sessions) k
      where k !~ '^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$'
         or not (left(k, 10)::date = any (v_days))
         or not exists (
           select 1 from public.event_bout_sessions s
           where s.event_id = v_event.id and s.day = left(k, 10)::date and to_char(s.starts_at, 'HH24:MI') = right(k, 5)
         )
    ) then
      raise exception 'Pick bout sessions of the days you work' using errcode = '22023';
    end if;
  end if;

  update public.official_invitations
  set status = case when p_accept then 'accepted' else 'declined' end,
      days = case when p_accept then v_days else null end,
      sessions = case when p_accept then v_sessions else null end,
      judge = p_accept and coalesce(p_judge, false),
      referee = p_accept and coalesce(p_referee, false),
      supervisor = p_accept and coalesce(p_supervisor, false),
      timekeeper = p_accept and coalesce(p_timekeeper, false),
      responded_at = now()
  where id = p_invitation_id;

  if not p_accept then
    delete from public.event_officials where event_id = v_inv.event_id and user_id = v_user;
    -- Declining also takes them off the event's bouts.
    delete from public.bout_officials bo using public.bouts b
    where b.id = bo.bout_id and b.event_id = v_inv.event_id and bo.user_id = v_user;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- The lists show the roles
-- ---------------------------------------------------------------------------

drop function public.list_event_invitations(uuid);
create function public.list_event_invitations(p_event_id uuid)
returns table (
  id uuid, official_id uuid, name text, email text, user_id uuid, status text, respond_by date,
  invited_at timestamptz, responded_at timestamptz, days date[], sessions text[],
  judge boolean, referee boolean, supervisor boolean, timekeeper boolean
)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.can_see_official_lists(p_event_id) then
    return;
  end if;
  return query
    select i.id, i.official_id, o.name, o.invite_email, o.user_id, i.status, i.respond_by, i.invited_at, i.responded_at,
      i.days, i.sessions, i.judge, i.referee, i.supervisor, i.timekeeper
    from public.official_invitations i
    join public.officials o on o.id = i.official_id
    where i.event_id = p_event_id
    order by o.name;
end;
$$;

drop function public.list_my_invitations();
create function public.list_my_invitations()
returns table (
  id uuid, event_id uuid, event_name text, venue text, start_date date, end_date date, timezone text,
  event_status text, status text, respond_by date, invited_at timestamptz, responded_at timestamptz, days date[],
  sessions text[], judge boolean, referee boolean, supervisor boolean, timekeeper boolean
)
language sql stable security definer set search_path = public
as $$
  select i.id, e.id, e.name, e.venue, e.start_date, e.end_date, e.timezone, e.status,
    i.status, i.respond_by, i.invited_at, i.responded_at, i.days, i.sessions,
    i.judge, i.referee, i.supervisor, i.timekeeper
  from public.official_invitations i
  join public.officials o on o.id = i.official_id
  join public.events e on e.id = i.event_id
  where o.user_id = auth.uid()
  order by e.start_date desc, e.name
$$;

-- The signed-in user's event roles: {judge, referee, supervisor, timekeeper} (all false if none).
create function public.my_event_roles(p_event_id uuid)
returns table (judge boolean, referee boolean, supervisor boolean, timekeeper boolean)
language sql stable security definer set search_path = public
as $$
  select coalesce(bool_or(i.judge), false), coalesce(bool_or(i.referee), false),
    coalesce(bool_or(i.supervisor), false), coalesce(bool_or(i.timekeeper), false)
  from public.official_invitations i
  join public.officials o on o.id = i.official_id
  join public.profiles p on p.id = o.user_id and p.status = 'active'
  where i.event_id = p_event_id and i.status = 'accepted' and o.user_id = auth.uid()
$$;

-- ---------------------------------------------------------------------------
-- Bouts: tick which event roles you do on the bout
-- ---------------------------------------------------------------------------

alter table public.bout_officials
  add column judge boolean not null default false,
  add column referee boolean not null default false,
  add column supervisor boolean not null default false,
  add column timekeeper boolean not null default false;

update public.bout_officials set judge = true, referee = (role = 'ref_judge');

alter table public.bout_officials drop column role;
alter table public.bout_officials add constraint bout_officials_some_role
  check (judge or referee or supervisor or timekeeper);

drop function public.accept_bout(uuid, text);
-- Take a bout (or change the roles on it). Each role ticked must be one of the official's event
-- roles, and at least one is needed.
create function public.accept_bout(
  p_bout_id uuid, p_judge boolean default false, p_referee boolean default false,
  p_supervisor boolean default false, p_timekeeper boolean default false
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_bout public.bouts;
  v_mine record;
begin
  if not (coalesce(p_judge, false) or coalesce(p_referee, false) or coalesce(p_supervisor, false) or coalesce(p_timekeeper, false)) then
    raise exception 'Pick at least one role for this bout' using errcode = '22023';
  end if;
  select * into v_bout from public.bouts where id = p_bout_id;
  if not found then
    raise exception 'That bout no longer exists' using errcode = 'P0002';
  end if;
  if not public.can_work_bout_day(v_bout.event_id, v_bout.day) then
    raise exception 'Only officials working this day can accept the bout' using errcode = '42501';
  end if;
  select * into v_mine from public.my_event_roles(v_bout.event_id);
  if (coalesce(p_judge, false) and not v_mine.judge) or (coalesce(p_referee, false) and not v_mine.referee)
     or (coalesce(p_supervisor, false) and not v_mine.supervisor) or (coalesce(p_timekeeper, false) and not v_mine.timekeeper) then
    raise exception 'You can only take roles you chose when you accepted the event' using errcode = '42501';
  end if;
  if not public.card_open(v_bout.event_id) then
    raise exception 'Bouts can be accepted only while the event is Active' using errcode = '22023';
  end if;
  if v_bout.status = 'cancelled' then
    raise exception 'This bout is cancelled' using errcode = '22023';
  end if;
  if v_bout.winner is not null then
    raise exception 'This bout already has a result' using errcode = '22023';
  end if;

  insert into public.bout_officials (bout_id, user_id, judge, referee, supervisor, timekeeper)
  values (p_bout_id, auth.uid(), coalesce(p_judge, false), coalesce(p_referee, false), coalesce(p_supervisor, false), coalesce(p_timekeeper, false))
  on conflict (bout_id, user_id) do update
    set judge = excluded.judge, referee = excluded.referee, supervisor = excluded.supervisor,
        timekeeper = excluded.timekeeper, accepted_at = now();
end;
$$;

grant execute on function public.my_event_roles(uuid) to authenticated;
grant execute on function public.accept_bout(uuid, boolean, boolean, boolean, boolean) to authenticated;
