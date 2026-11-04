-- Migration 54: every new event needs its bout location. Run after migration 53 (20261104120000_bout_conflicts.sql).
--
-- Bhavek, 2026-11-04: "When creating an event location is required and you must let user pick using Google
-- maps pin". create_event now refuses an empty location. The map pin itself is checked in the app (the pin is
-- saved straight after the event is created, migration 50). Existing events are left as they are.

create or replace function public.create_event(
  p_name text,
  p_venue text,
  p_start_date date,
  p_end_date date,
  p_owner_id uuid,
  p_timezone text default 'America/Winnipeg'
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_id uuid;
  v_owner uuid := p_owner_id;
begin
  if auth.uid() is null or not public.has_permission('events:create') then
    raise exception 'Only event owners and site Admins can create events' using errcode = '42501';
  end if;
  if not public.is_site_admin() then
    if p_owner_id is not null and p_owner_id <> auth.uid() then
      raise exception 'Only a site Admin can create an event for someone else' using errcode = '42501';
    end if;
    v_owner := auth.uid();
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'Give the event a name' using errcode = '22023';
  end if;
  if coalesce(trim(p_venue), '') = '' then
    raise exception 'Add the bout location' using errcode = '22023';
  end if;
  if v_owner is null or not exists (select 1 from public.profiles where id = v_owner and status = 'active') then
    raise exception 'Pick an Owner who has signed in at least once' using errcode = '23514';
  end if;
  if not public.is_valid_timezone(p_timezone) then
    raise exception 'Pick a time zone for the event' using errcode = '22023';
  end if;

  insert into public.events (name, venue, start_date, end_date, timezone)
  values (trim(p_name), nullif(trim(p_venue), ''), p_start_date, p_end_date, p_timezone)
  returning id into v_id;
  insert into public.event_members (event_id, user_id, role, added_by)
  values (v_id, v_owner, 'owner', auth.uid());
  return v_id;
end;
$$;
