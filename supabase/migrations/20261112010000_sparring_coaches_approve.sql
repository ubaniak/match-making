-- Sparring bouts need both corners' club owners (coaches) to approve, and NOT the Chief Official or
-- Deputy (Bhavek, 2026-11-12: "for sparring both coaches approval is needed the co is not").
--
-- Until now a Sparring bout was approved as soon as it was made (migrations 25 and 58). Now:
-- * A Sparring bout waits for each corner whose club has an active owner, like any other bout,
--   but there is no official side. Any rejection makes it Rejected.
-- * A corner with no club owner is skipped (as in migration 52), so a Sparring bout between two
--   ownerless clubs is still approved straight away.
-- * The maker's own corner is approved for them when they own that club; one club in both corners
--   approves once for both; after the weigh-in starts the Chief Official or Deputy can still decide
--   for a corner (all as in migration 52).
-- * "Send for approval" emails and gives to-dos to the corners' club owners only.
-- * Scored and Developmental bouts are unchanged: both corners and a Chief Official or Deputy.
-- * Sparring bouts that are already Approved stay Approved, so no card changes under anyone.
--
-- Run after 20261105030000_sparring_no_weigh_in.sql, BEFORE deploying the app. It doesn't depend on
-- 20261112000000_officials_can_sign_in.sql (PR #115); either order is fine.

create or replace function public.save_bout(
  p_bout_id uuid,
  p_event_id uuid,
  p_day date,
  p_red_athlete_id uuid,
  p_blue_athlete_id uuid,
  p_needs_supervisor boolean default false,
  p_warnings text[] default '{}',
  p_bout_type text default 'scored',
  p_blocks text[] default '{}',
  p_override_reason text default null
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_event public.events;
  v_red public.event_athletes;
  v_blue public.event_athletes;
  v_old public.bouts;
  v_id uuid;
  v_type text := coalesce(p_bout_type, 'scored');
  v_blocks text[] := coalesce(p_blocks, '{}');
  v_reason text := nullif(trim(p_override_reason), '');
  v_status text;
begin
  select * into v_event from public.events where id = p_event_id;
  if not found then
    raise exception 'That event no longer exists' using errcode = 'P0002';
  end if;
  if v_type not in ('scored', 'developmental', 'sparring') then
    raise exception 'Pick Scored, Developmental or Sparring' using errcode = '22023';
  end if;
  if p_bout_id is not null then
    select * into v_old from public.bouts where id = p_bout_id and event_id = p_event_id for update;
    if not found then
      raise exception 'That bout no longer exists' using errcode = 'P0002';
    end if;
    if v_old.winner is not null then
      raise exception 'This bout has a result, so it can''t be re-matched' using errcode = '22023';
    end if;
    if not coalesce(public.can_match(p_event_id, v_old.day), false) then
      raise exception 'After the weigh-in starts, only the Chief Official or Deputy can change bouts' using errcode = '42501';
    end if;
  end if;
  if not coalesce(public.can_match(p_event_id, p_day), false) then
    if public.is_event_owner(p_event_id) then
      raise exception 'The weigh-in for that day has started, so only the Chief Official or Deputy can make bouts' using errcode = '42501';
    end if;
    raise exception 'Only the event''s Owner or officials can make bouts' using errcode = '42501';
  end if;
  if not public.card_open(p_event_id) then
    raise exception 'Bouts can be made only while the event is Active' using errcode = '22023';
  end if;
  if p_day is null or p_day < v_event.start_date or p_day > v_event.end_date then
    raise exception 'Pick a day of the event' using errcode = '22023';
  end if;
  if p_red_athlete_id is null or p_blue_athlete_id is null or p_red_athlete_id = p_blue_athlete_id then
    raise exception 'Pick two different athletes' using errcode = '22023';
  end if;
  select * into v_red from public.event_athletes where event_id = p_event_id and athlete_id = p_red_athlete_id;
  select * into v_blue from public.event_athletes where event_id = p_event_id and athlete_id = p_blue_athlete_id;
  if v_red.athlete_id is null or v_blue.athlete_id is null then
    raise exception 'Both athletes must be entered in the event' using errcode = '23514';
  end if;
  if (select gender from public.athletes where id = p_red_athlete_id)
     is distinct from (select gender from public.athletes where id = p_blue_athlete_id) then
    raise exception 'Male and female athletes can''t box each other' using errcode = '23514';
  end if;

  -- Sparring skips the match rules, so any rule breaks the app found don't matter.
  if v_type = 'sparring' then
    v_blocks := '{}';
  end if;

  -- Rule breaks: only a Developmental bout, overridden by an official with a reason.
  if cardinality(v_blocks) > 0 then
    if v_type = 'scored' then
      raise exception 'A Scored bout must follow every match rule' using errcode = '23514';
    elsif not public.is_event_official(p_event_id) then
      raise exception 'Only the Chief Official or Deputy can override the match rules' using errcode = '42501';
    elsif v_reason is null then
      raise exception 'Give a reason for overriding the match rules' using errcode = '22023';
    end if;
  else
    v_reason := null;
  end if;

  if exists (
    select 1 from public.bouts b
    where b.event_id = p_event_id and b.day = p_day and b.status <> 'cancelled'
      and b.id is distinct from p_bout_id
      and (b.red_athlete_id in (p_red_athlete_id, p_blue_athlete_id) or b.blue_athlete_id in (p_red_athlete_id, p_blue_athlete_id))
  ) then
    raise exception 'One of these athletes already has a bout that day' using errcode = '23505';
  end if;

  -- Every bout starts waiting. The approve_makers_corner trigger then works out its status, so a
  -- Sparring bout with no club owner in either corner is approved straight away.
  v_status := 'pending';

  if p_bout_id is null then
    insert into public.bouts (event_id, day, position, red_athlete_id, blue_athlete_id, red_club_id, blue_club_id,
                              needs_supervisor, warnings, after_weigh_in, status, bout_type,
                              override_blocks, override_reason, override_by, override_at)
    values (p_event_id, p_day,
            coalesce((select max(position) + 1 from public.bouts where event_id = p_event_id and day = p_day), 1),
            p_red_athlete_id, p_blue_athlete_id, v_red.club_id, v_blue.club_id,
            coalesce(p_needs_supervisor, false), coalesce(p_warnings, '{}'), public.weigh_in_started(p_event_id, p_day),
            v_status, v_type,
            case when v_reason is null then '{}' else v_blocks end, v_reason,
            case when v_reason is null then null else auth.uid() end,
            case when v_reason is null then null else now() end)
    returning id into v_id;
  else
    delete from public.bout_approvals where bout_id = p_bout_id;
    update public.bouts
    set day = p_day,
        position = case when day = p_day then position
                        else coalesce((select max(position) + 1 from public.bouts where event_id = p_event_id and day = p_day), 1) end,
        session_starts_at = case when day = p_day then session_starts_at end,
        red_athlete_id = p_red_athlete_id, blue_athlete_id = p_blue_athlete_id,
        red_club_id = v_red.club_id, blue_club_id = v_blue.club_id,
        needs_supervisor = coalesce(p_needs_supervisor, false), warnings = coalesce(p_warnings, '{}'),
        after_weigh_in = public.weigh_in_started(p_event_id, p_day),
        status = v_status, bout_type = v_type,
        override_blocks = case when v_reason is null then '{}' else v_blocks end,
        override_reason = v_reason,
        override_by = case when v_reason is null then null else auth.uid() end,
        override_at = case when v_reason is null then null else now() end,
        -- A changed type needs sending for approval again.
        approval_requested_at = case when bout_type = v_type then approval_requested_at end,
        approval_requested_by = case when bout_type = v_type then approval_requested_by end,
        cancel_reason = null, cancelled_at = null,
        made_by = auth.uid(), made_at = now()
    where id = p_bout_id
    returning id into v_id;
  end if;
  return v_id;
end;
$$;

create or replace function public.refresh_bout_status(p_bout_id uuid) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_bout public.bouts;
  v_rejected boolean;
  v_waiting boolean;
begin
  select * into v_bout from public.bouts where id = p_bout_id;
  if not found then
    return;
  end if;
  select coalesce(bool_or(decision = 'rejected'), false) into v_rejected
  from public.bout_approvals where bout_id = p_bout_id;
  -- A side is still waiting when it needs approving and hasn't approved.
  select exists (
    select 1 from (values
      -- Sparring: only the corners approve, never the officials.
      ('official', v_bout.bout_type <> 'sparring'),
      ('red', public.club_has_owner(v_bout.red_club_id)),
      ('blue', public.club_has_owner(v_bout.blue_club_id))
    ) s (side, needed)
    where s.needed and not exists (
      select 1 from public.bout_approvals a where a.bout_id = p_bout_id and a.side = s.side and a.decision = 'approved'
    )
  ) into v_waiting;
  update public.bouts
  set status = case
    when v_rejected then 'rejected'
    when not v_waiting then 'approved'
    else 'pending' end
  where id = p_bout_id and status <> 'cancelled';
end;
$$;

create or replace function public.decide_bout(p_bout_id uuid, p_side text, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_bout public.bouts;
  v_club uuid;
  v_override boolean := false;
  v_sides text[];
begin
  select * into v_bout from public.bouts where id = p_bout_id for update;
  if not found then
    raise exception 'That bout no longer exists' using errcode = 'P0002';
  end if;
  if v_bout.status = 'cancelled' or v_bout.winner is not null then
    raise exception 'This bout can no longer be approved or rejected' using errcode = '22023';
  end if;
  if not public.card_open(v_bout.event_id) then
    raise exception 'The event isn''t Active' using errcode = '22023';
  end if;

  if p_side = 'official' and v_bout.bout_type = 'sparring' then
    raise exception 'Sparring bouts don''t need the Chief Official''s approval, only both corners''' using errcode = '22023';
  elsif p_side = 'official' then
    -- is_event_official: the event's Chief Official or Deputy, or a site Admin.
    if not public.is_event_official(v_bout.event_id) then
      raise exception 'Only the Chief Official or Deputy gives the official approval' using errcode = '42501';
    end if;
    v_sides := array['official'];
  elsif p_side in ('red', 'blue') then
    v_club := case when p_side = 'red' then v_bout.red_club_id else v_bout.blue_club_id end;
    if not coalesce(public.club_role(v_club) = 'owner', false) and not public.is_site_admin() then
      -- After the weigh-in starts, the Chief Official or Deputy can decide for a corner.
      if v_bout.after_weigh_in or public.weigh_in_started(v_bout.event_id, v_bout.day) then
        if public.event_official_role(v_bout.event_id) is not null then
          v_override := true;
        end if;
      end if;
      if not v_override then
        raise exception 'Only that corner''s club owners can approve for it' using errcode = '42501';
      end if;
    end if;
    -- Both corners from the same club: one decision covers both.
    v_sides := case when v_bout.red_club_id = v_bout.blue_club_id then array['red', 'blue'] else array[p_side] end;
  else
    raise exception 'Unknown side' using errcode = '22023';
  end if;

  insert into public.bout_approvals (bout_id, side, decision, note, override)
  select p_bout_id, s, case when p_approve then 'approved' else 'rejected' end, nullif(trim(p_note), ''), v_override
  from unnest(v_sides) s
  on conflict (bout_id, side) do update
    set decision = excluded.decision, note = excluded.note, override = excluded.override,
        decided_by = auth.uid(), decided_at = now();
  perform public.refresh_bout_status(p_bout_id);
end;
$$;

create or replace function public.approve_makers_corner() returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_side text;
begin
  if new.status = 'cancelled' then
    return new;
  end if;
  -- Always work out the status, even without a maker, so a new bout with no corner to wait on
  -- (a Sparring bout between two clubs with no owner) is approved.
  foreach v_side in array array['red', 'blue'] loop
    if exists (
      select 1 from public.club_members m
      where m.club_id = case when v_side = 'red' then new.red_club_id else new.blue_club_id end
        and new.made_by is not null and m.user_id = new.made_by and m.role = 'owner' and m.status = 'active'
    ) then
      insert into public.bout_approvals (bout_id, side, decision, note, override, decided_by)
      values (new.id, v_side, 'approved', null, false, new.made_by)
      on conflict (bout_id, side) do nothing;
    end if;
  end loop;
  perform public.refresh_bout_status(new.id);
  return new;
end;
$$;

create or replace function public.bout_waiting_approvers(p_bout public.bouts)
returns table (side text, user_id uuid)
language sql stable security definer set search_path = public
as $$
  select s.side, u.user_id
  from (values ('red'), ('blue'), ('official')) s (side)
  cross join lateral unnest(case s.side
    when 'red' then public.club_people_ids(p_bout.red_club_id)
    when 'blue' then public.club_people_ids(p_bout.blue_club_id)
    else public.event_official_ids(p_bout.event_id) end) u (user_id)
  where not exists (
    select 1 from public.bout_approvals a where a.bout_id = p_bout.id and a.side = s.side and a.decision = 'approved'
  )
  -- Same club in both corners: only the red to-do, since one decision covers both.
  and not (s.side = 'blue' and p_bout.red_club_id = p_bout.blue_club_id)
  -- Sparring: the Chief Official and Deputy don't approve, so they get no to-do or email.
  and not (s.side = 'official' and p_bout.bout_type = 'sparring')
$$;

revoke execute on function public.bout_waiting_approvers(public.bouts) from public, anon, authenticated;
