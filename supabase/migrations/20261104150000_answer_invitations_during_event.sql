-- Invited officials can answer their invitation until the event is over.
--
-- Bhavek 2026-11-04: "If I am invited as an official I should be allowed to accept or decline".
-- Before, answers locked on the event's first day, so an official invited to an event that had
-- already started (or starts today) saw their invitation with no Accept or Decline.
--
-- Now respond_to_invitation takes an answer while the event is Active, up to and including its
-- last day (in the event's time zone). A pending invitation past its respond-by date still can't
-- be answered (the inviter set that date); they can be invited again.
--
-- Same function as migration 42 (20261104010000_official_event_roles.sql) except that check.
-- Runs after 20261104140000_weigh_in_id_checks.sql.

create or replace function public.respond_to_invitation(
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
  if v_event.status <> 'active' or public.local_today(v_event.timezone) > v_event.end_date then
    raise exception 'This event is over or cancelled, so the invitation can no longer be answered.' using errcode = '22023';
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
