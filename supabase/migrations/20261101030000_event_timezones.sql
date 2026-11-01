-- Migration 11: every event has a time zone, picked by the site Admin who creates it.
--
-- Weigh-in and bout times are wall-clock times in the event's time zone. "Today" for an
-- event is today in its time zone, not in UTC (the database's clock): before this, events
-- vanished from the public page and stopped taking entries at 7 PM Winnipeg time on their
-- last day. Existing events get America/Winnipeg.

-- ---------------------------------------------------------------------------
-- The time zone column
-- ---------------------------------------------------------------------------

-- Is this a time zone name Postgres knows, like 'America/Winnipeg'?
create function public.is_valid_timezone(p_tz text) returns boolean
language plpgsql stable set search_path = public
as $$
begin
  if p_tz is null or p_tz = '' then
    return false;
  end if;
  perform now() at time zone p_tz;
  return true;
exception when others then
  return false;
end;
$$;

-- Today's date in a time zone.
create function public.local_today(p_tz text) returns date
language sql stable set search_path = public
as $$
  select (now() at time zone coalesce(p_tz, 'America/Winnipeg'))::date
$$;

alter table public.events
  add column timezone text not null default 'America/Winnipeg'
    check (public.is_valid_timezone(timezone));

-- ---------------------------------------------------------------------------
-- Functions that compare against "today" now use the event's own time zone.
-- Only a site Admin changes an event's time zone.
-- ---------------------------------------------------------------------------

create or replace function public.touch_event() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  if tg_op = 'UPDATE' then
    if new.status is distinct from old.status then
      if auth.uid() is not null and not public.is_site_admin() then
        raise exception 'Only a site Admin can approve, cancel or close an event' using errcode = '42501';
      end if;
      new.status_changed_at := now();
    end if;
    if new.timezone is distinct from old.timezone and auth.uid() is not null and not public.is_site_admin() then
      raise exception 'Only a site Admin can change an event''s time zone' using errcode = '42501';
    end if;
    delete from public.event_days
    where event_id = new.id and (day < new.start_date or day > new.end_date);
  end if;
  return new;
end;
$$;

create or replace function public.can_edit_event(p_event_id uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select public.is_site_admin() or exists (
    select 1 from public.events e
    where e.id = p_event_id
      and e.status in ('requested', 'active')
      and e.end_date >= public.local_today(e.timezone)
      and public.event_role(e.id) = 'owner'
  )
$$;

create or replace function public.event_is_open(p_event_id uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.events
    where id = p_event_id and status = 'active' and end_date >= public.local_today(timezone)
  )
$$;

create or replace function public.close_finished_events() returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_count integer;
begin
  update public.events set status = 'done'
  where status in ('requested', 'active') and end_date < public.local_today(timezone);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.list_public_events() returns jsonb
language sql stable security definer set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', e.id,
    'name', e.name,
    'venue', e.venue,
    'start_date', e.start_date,
    'end_date', e.end_date,
    'timezone', e.timezone,
    'poster_path', e.poster_path,
    'days', coalesce((
      select jsonb_agg(jsonb_build_object(
        'day', d.day,
        'weigh_in_start', to_char(d.weigh_in_start, 'HH24:MI'),
        'weigh_in_end', to_char(d.weigh_in_end, 'HH24:MI'),
        'sessions', coalesce((
          select jsonb_agg(jsonb_build_object('starts_at', to_char(s.starts_at, 'HH24:MI'), 'label', s.label) order by s.starts_at)
          from public.event_bout_sessions s where s.event_id = d.event_id and s.day = d.day
        ), '[]')
      ) order by d.day)
      from public.event_days d where d.event_id = e.id
    ), '[]')
  ) order by e.start_date, e.name), '[]')
  from public.events e
  where e.status = 'active' and e.end_date >= public.local_today(e.timezone)
$$;

create or replace function public.athlete_in_open_event(p_athlete_id uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.event_athletes ea
    join public.events e on e.id = ea.event_id
    where ea.athlete_id = p_athlete_id and e.status = 'active' and e.end_date >= public.local_today(e.timezone)
  )
$$;

create or replace function public.entries_open(p_event_id uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.events
    where id = p_event_id and status = 'active' and end_date >= public.local_today(timezone)
      and (entry_deadline is null or now() <= entry_deadline)
  )
$$;

create or replace function public.remove_event_club(p_event_id uuid, p_club_id uuid) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not coalesce(public.is_site_admin() or public.is_event_owner(p_event_id) or public.club_role(p_club_id) = 'owner', false) then
    raise exception 'Only the event''s Owner, the club''s Owners or a site Admin can do that' using errcode = '42501';
  end if;
  if not exists (select 1 from public.events where id = p_event_id and status in ('requested', 'active') and end_date >= public.local_today(timezone))
     and not public.is_site_admin() then
    raise exception 'This event can no longer be changed' using errcode = '22023';
  end if;
  delete from public.event_athletes where event_id = p_event_id and club_id = p_club_id;
  update public.late_entry_requests set status = 'cancelled', decided_by = auth.uid(), decided_at = now()
  where event_id = p_event_id and club_id = p_club_id and status = 'pending';
  delete from public.event_clubs where event_id = p_event_id and club_id = p_club_id;
end;
$$;

create or replace function public.withdraw_athlete(p_event_id uuid, p_athlete_id uuid) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_club uuid;
begin
  select club_id into v_club from public.event_athletes where event_id = p_event_id and athlete_id = p_athlete_id;
  if not found then
    raise exception 'That athlete isn''t entered' using errcode = 'P0002';
  end if;
  if not coalesce(public.is_site_admin() or public.club_role(v_club) = 'owner', false) then
    raise exception 'Only the athlete''s club Owners can withdraw them' using errcode = '42501';
  end if;
  if not public.is_site_admin()
     and not exists (select 1 from public.events where id = p_event_id and status in ('requested', 'active') and end_date >= public.local_today(timezone)) then
    raise exception 'This event is over, so its entries can''t change' using errcode = '22023';
  end if;
  delete from public.event_athletes where event_id = p_event_id and athlete_id = p_athlete_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- create_event takes the time zone
-- ---------------------------------------------------------------------------

drop function public.create_event(text, text, date, date, uuid);

create function public.create_event(
  p_name text,
  p_venue text,
  p_start_date date,
  p_end_date date,
  p_owner_id uuid,
  p_timezone text default 'America/Winnipeg'
) returns uuid
language plpgsql security invoker set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.is_site_admin() then
    raise exception 'Only a site Admin can create events' using errcode = '42501';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'Give the event a name' using errcode = '22023';
  end if;
  if p_owner_id is null or not exists (select 1 from public.profiles where id = p_owner_id and status = 'active') then
    raise exception 'Pick an Owner who has signed in at least once' using errcode = '23514';
  end if;
  if not public.is_valid_timezone(p_timezone) then
    raise exception 'Pick a time zone for the event' using errcode = '22023';
  end if;

  insert into public.events (name, venue, start_date, end_date, timezone)
  values (trim(p_name), nullif(trim(p_venue), ''), p_start_date, p_end_date, p_timezone)
  returning id into v_id;
  insert into public.event_members (event_id, user_id, role, added_by)
  values (v_id, p_owner_id, 'owner', auth.uid());
  return v_id;
end;
$$;

revoke execute on function public.create_event(text, text, date, date, uuid, text) from public, anon;
grant execute on function public.create_event(text, text, date, date, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- The Done job runs hourly, so each event closes soon after midnight in its own time zone.
-- ---------------------------------------------------------------------------

do $$
begin
  perform cron.unschedule('close-finished-events');
  perform cron.schedule('close-finished-events', '5 * * * *', 'select public.close_finished_events()');
exception when others then
  raise notice 'Could not reschedule the Done job (%). If pg_cron is on, run: select cron.schedule(''close-finished-events'', ''5 * * * *'', ''select public.close_finished_events()'');', sqlerrm;
end;
$$;
