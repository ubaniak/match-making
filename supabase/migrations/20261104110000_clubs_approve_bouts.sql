-- Migration 52: both corners' club owners AND the Chief Official or Deputy approve a bout.
--
-- Bhavek, 2026-11-04: "the official and club owners must all approve a bout". This brings back the
-- corner approvals that migration 26 removed, while keeping migration 26's fixes:
--
-- * A bout is Approved once every corner that has a club owner AND the Chief Official or Deputy
--   approve it. Any one rejection makes it Rejected (back to the Owner to re-match).
-- * A corner whose club has no active owner doesn't need approving, so its bouts can't get stuck.
--   The officials still approve every bout.
-- * The person who makes the bout approves their own corner automatically when they own that club.
-- * When both corners are the same club, one owner approval covers both.
-- * After the day's weigh-in starts, the Chief Official or Deputy can decide for a corner (as before
--   migration 26). A site Admin can decide for any side but gets no to-do.
-- * "Send for approval" gives each side still waiting one "Approve bout" to-do: the corner's club
--   owners, and the Chief Official and Deputy. Sending again replaces the open to-do rather than
--   adding a second one (the duplicate to-do fix from migration 26).
-- * Swapping corners moves each corner's approval with its club.
--
-- Also: either corner's club owner can withdraw their own athlete from a bout (withdraw_corner), at
-- any time until it has a result. The bout is cancelled and everyone involved is told.
--
-- Run after migration 51 (20261104100000_hide_event_officials.sql, PR #94).

-- ---------------------------------------------------------------------------
-- Corners are back
-- ---------------------------------------------------------------------------

alter table public.bout_approvals drop constraint if exists bout_approvals_side_check;
alter table public.bout_approvals add constraint bout_approvals_side_check check (side in ('red', 'blue', 'official'));

-- Does this club have an active owner who can approve?
create or replace function public.club_has_owner(p_club_id uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.club_members m
    join public.profiles p on p.id = m.user_id and p.status = 'active'
    where m.club_id = p_club_id and m.role = 'owner' and m.status = 'active'
  )
$$;

revoke execute on function public.club_has_owner(uuid) from public, anon, authenticated;

-- Computed fields the app reads with the bout (select red_club_has_owner, blue_club_has_owner), so
-- it can show "No club owner" instead of waiting forever. Only says yes or no, never who.
create or replace function public.red_club_has_owner(b public.bouts) returns boolean
language sql stable security definer set search_path = public
as $$ select public.club_has_owner(b.red_club_id) $$;

create or replace function public.blue_club_has_owner(b public.bouts) returns boolean
language sql stable security definer set search_path = public
as $$ select public.club_has_owner(b.blue_club_id) $$;

revoke execute on function public.red_club_has_owner(public.bouts) from public, anon;
revoke execute on function public.blue_club_has_owner(public.bouts) from public, anon;
grant execute on function public.red_club_has_owner(public.bouts) to authenticated;
grant execute on function public.blue_club_has_owner(public.bouts) to authenticated;

-- ---------------------------------------------------------------------------
-- Status: every corner with an owner, and the officials
-- ---------------------------------------------------------------------------

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
      ('official', true),
      ('red', public.club_has_owner(v_bout.red_club_id)),
      ('blue', public.club_has_owner(v_bout.blue_club_id))
    ) s (side, needed)
    where s.needed and not exists (
      select 1 from public.bout_approvals a where a.bout_id = p_bout_id and a.side = s.side and a.decision = 'approved'
    )
  ) into v_waiting;
  update public.bouts
  set status = case
    when bout_type = 'sparring' then 'approved'
    when v_rejected then 'rejected'
    when not v_waiting then 'approved'
    else 'pending' end
  where id = p_bout_id and status <> 'cancelled';
end;
$$;

revoke execute on function public.refresh_bout_status(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Deciding
-- ---------------------------------------------------------------------------

-- p_side: 'red' or 'blue' (that corner's club owners) or 'official' (Chief Official or Deputy).
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
  if v_bout.bout_type = 'sparring' then
    raise exception 'Sparring bouts don''t need approval' using errcode = '22023';
  end if;
  if v_bout.status = 'cancelled' or v_bout.winner is not null then
    raise exception 'This bout can no longer be approved or rejected' using errcode = '22023';
  end if;
  if not public.card_open(v_bout.event_id) then
    raise exception 'The event isn''t Active' using errcode = '22023';
  end if;

  if p_side = 'official' then
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

-- ---------------------------------------------------------------------------
-- The maker approves their own corner
-- ---------------------------------------------------------------------------

-- Runs when a bout is made or re-matched (save_bout sets made_at and clears approvals on a
-- re-match). If the maker owns a corner's club, that corner is approved for them.
create or replace function public.approve_makers_corner() returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_side text;
begin
  if new.bout_type = 'sparring' or new.status = 'cancelled' or new.made_by is null then
    return new;
  end if;
  foreach v_side in array array['red', 'blue'] loop
    if exists (
      select 1 from public.club_members m
      where m.club_id = case when v_side = 'red' then new.red_club_id else new.blue_club_id end
        and m.user_id = new.made_by and m.role = 'owner' and m.status = 'active'
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

revoke execute on function public.approve_makers_corner() from public, anon, authenticated;

drop trigger if exists bouts_approve_makers_corner on public.bouts;
create trigger bouts_approve_makers_corner
  after insert or update of made_at on public.bouts
  for each row execute function public.approve_makers_corner();

-- ---------------------------------------------------------------------------
-- Send for approval: each corner's club owners and the Chief Official and Deputy
-- ---------------------------------------------------------------------------

-- The people still to approve a bout, one row per side and person. Approved sides and corners
-- with no club owner are left out.
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
$$;

revoke execute on function public.bout_waiting_approvers(public.bouts) from public, anon, authenticated;

create or replace function public.request_bout_approvals(p_bout_ids uuid[])
returns table (
  bout_id uuid, side text, recipient_name text, recipient_email text,
  event_name text, venue text, day date, bout_number integer,
  red_name text, red_club text, blue_name text, blue_club text
)
language plpgsql security definer set search_path = public
as $$
#variable_conflict use_column
declare
  v_event uuid;
begin
  if p_bout_ids is null or cardinality(p_bout_ids) = 0 then
    return;
  end if;
  for v_event in select distinct b.event_id from public.bouts b where b.id = any (p_bout_ids) loop
    if not (public.is_owner_or_admin(v_event) or public.is_event_official(v_event)) then
      raise exception 'Only the event''s Owner, its Chief Official or Deputy, or a site Admin can send bouts for approval' using errcode = '42501';
    end if;
    if not public.card_open(v_event) then
      raise exception 'Bouts can be sent for approval only while the event is Active' using errcode = '22023';
    end if;
  end loop;

  update public.bouts b
  set approval_requested_at = now(), approval_requested_by = auth.uid()
  where b.id = any (p_bout_ids) and b.status = 'pending' and b.winner is null;

  return query
    with sent as (
      select b as bout, b.id, b.event_id, b.day, b.red_athlete_id, b.blue_athlete_id, b.red_club_id, b.blue_club_id,
        (select count(*)::integer from public.bouts x
         where x.event_id = b.event_id and x.day = b.day and x.status <> 'cancelled'
           and (x.position < b.position or (x.position = b.position and x.id <= b.id))) as num
      from public.bouts b
      where b.id = any (p_bout_ids) and b.status = 'pending' and b.winner is null
    )
    select s.id, w.side, p.name, p.email,
      e.name, e.venue, s.day, s.num,
      ra.name, rc.name, ba.name, bc.name
    from sent s
    cross join lateral public.bout_waiting_approvers(s.bout) w
    join public.profiles p on p.id = w.user_id and p.status = 'active'
    join public.events e on e.id = s.event_id
    join public.athletes ra on ra.id = s.red_athlete_id
    join public.athletes ba on ba.id = s.blue_athlete_id
    left join public.clubs rc on rc.id = s.red_club_id
    left join public.clubs bc on bc.id = s.blue_club_id
    where p.email is not null
    order by p.email, s.day, s.num;
end;
$$;

revoke execute on function public.request_bout_approvals(uuid[]) from public, anon;
grant execute on function public.request_bout_approvals(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- Notifications: one "Approve bout" to-do per waiting side
-- ---------------------------------------------------------------------------

-- Adds (or replaces) the open to-do of each side still waiting on a bout.
create or replace function public.add_bout_approval_todos(p_bout public.bouts) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_side text;
  v_users uuid[];
  v_key text;
begin
  foreach v_side in array array['red', 'blue', 'official'] loop
    v_key := 'bout:' || p_bout.id || ':' || v_side;
    delete from public.notifications where action_key = v_key and done_at is null;
    select coalesce(array_agg(distinct w.user_id), '{}') into v_users
    from public.bout_waiting_approvers(p_bout) w where w.side = v_side;
    continue when cardinality(v_users) = 0;
    perform public.add_notification(
      v_users, 'bout_approval', 'Approve bout: ' || public.bout_label(p_bout),
      public.bout_where(p_bout) || case v_side
        when 'official' then ' · official approval'
        when 'red' then ' · for ' || coalesce(public.club_name(p_bout.red_club_id), 'the red corner')
        else ' · for ' || coalesce(public.club_name(p_bout.blue_club_id), 'the blue corner') end,
      p_bout.event_id, null, p_bout.id, 'bouts', v_key);
  end loop;
end;
$$;

revoke execute on function public.add_bout_approval_todos(public.bouts) from public, anon, authenticated;

create or replace function public.notify_bout_change() returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_label text := public.bout_label(new);
  v_where text := public.bout_where(new);
begin
  -- Sent (or sent again) for approval: each waiting side's open to-do is replaced, so nobody ends
  -- up with two.
  if new.approval_requested_at is not null and new.approval_requested_at is distinct from old.approval_requested_at
     and new.status = 'pending' and new.winner is null then
    perform public.add_bout_approval_todos(new);
  end if;

  -- Re-matched (the request was cleared) or no longer waiting: the to-dos go.
  if (new.approval_requested_at is null and old.approval_requested_at is not null)
     or (new.status <> 'pending' and old.status = 'pending') or (new.winner is not null and old.winner is null) then
    perform public.resolve_notifications('bout:' || new.id || ':%');
  end if;

  if new.status is distinct from old.status then
    if new.status = 'approved' then
      perform public.add_notification(
        public.club_people_ids(new.red_club_id, true) || public.club_people_ids(new.blue_club_id, true)
          || public.event_owner_ids(new.event_id) || public.event_official_ids(new.event_id),
        'bout_decision', 'Bout approved: ' || v_label, v_where, new.event_id, null, new.id, 'bouts');
    elsif new.status = 'cancelled' then
      perform public.add_notification(
        public.club_people_ids(new.red_club_id, true) || public.club_people_ids(new.blue_club_id, true)
          || public.event_owner_ids(new.event_id) || public.event_official_ids(new.event_id),
        'bout_cancelled', 'Bout cancelled: ' || v_label, v_where || coalesce(' · ' || new.cancel_reason, ''),
        new.event_id, null, new.id, 'bouts');
    end if;
  end if;
  return new;
end;
$$;

-- A side decided: its to-do is done; a rejection is reported to the Owner, officials and both clubs.
create or replace function public.notify_bout_approval() returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_bout public.bouts;
  v_who text;
begin
  -- Swapping corners puts an earlier decision back on the other side; nothing new was decided.
  if new.decided_at < now() then
    return new;
  end if;
  perform public.resolve_notifications('bout:' || new.bout_id || ':' || new.side);
  if new.decision = 'rejected' and (tg_op = 'INSERT' or old.decision <> 'rejected') then
    select * into v_bout from public.bouts where id = new.bout_id;
    -- Same club in both corners writes two rows; report it once.
    if new.side = 'blue' and v_bout.red_club_id = v_bout.blue_club_id then
      return new;
    end if;
    v_who := case new.side
      when 'red' then coalesce(public.club_name(v_bout.red_club_id), 'The red corner')
      when 'blue' then coalesce(public.club_name(v_bout.blue_club_id), 'The blue corner')
      else 'The officials' end;
    perform public.add_notification(
      public.event_owner_ids(v_bout.event_id) || public.event_official_ids(v_bout.event_id)
        || public.club_people_ids(v_bout.red_club_id) || public.club_people_ids(v_bout.blue_club_id),
      'bout_decision', v_who || ' rejected ' || public.bout_label(v_bout),
      public.bout_where(v_bout) || coalesce(': "' || new.note || '"', ''),
      v_bout.event_id, null, v_bout.id, 'bouts');
  end if;
  return new;
end;
$$;

revoke execute on function public.notify_bout_change() from public, anon, authenticated;
revoke execute on function public.notify_bout_approval() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Swapping corners moves each corner's approval with its club
-- ---------------------------------------------------------------------------

create or replace function public.swap_bout_corners(p_bout_id uuid) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_bout public.bouts;
  v_rows public.bout_approvals[];
begin
  select * into v_bout from public.bouts where id = p_bout_id for update;
  if not found then
    raise exception 'That bout no longer exists' using errcode = 'P0002';
  end if;
  if not coalesce(public.can_match(v_bout.event_id, v_bout.day), false) then
    if public.is_event_owner(v_bout.event_id) then
      raise exception 'The weigh-in for that day has started, so only the Chief Official or Deputy can change bouts' using errcode = '42501';
    end if;
    raise exception 'Only the event''s Owner or officials can change bouts' using errcode = '42501';
  end if;
  if not public.card_open(v_bout.event_id) then
    raise exception 'Bouts can be changed only while the event is Active' using errcode = '22023';
  end if;
  if v_bout.winner is not null then
    raise exception 'This bout has a result, so its corners can''t be swapped' using errcode = '22023';
  end if;
  if v_bout.status = 'cancelled' then
    raise exception 'This bout is cancelled' using errcode = '22023';
  end if;

  update public.bouts
  set red_athlete_id = v_bout.blue_athlete_id, blue_athlete_id = v_bout.red_athlete_id,
      red_club_id = v_bout.blue_club_id, blue_club_id = v_bout.red_club_id
  where id = p_bout_id;

  -- Swap the red and blue approvals. The primary key is checked row by row, so one update can't
  -- swap them: take the corner rows out and put them back on the other side. They keep their
  -- decided_at, which tells notify_bout_approval nothing new was decided.
  if v_bout.red_club_id is distinct from v_bout.blue_club_id then
    v_rows := array(select a from public.bout_approvals a where a.bout_id = p_bout_id and a.side in ('red', 'blue'));
    delete from public.bout_approvals where bout_id = p_bout_id and side in ('red', 'blue');
    insert into public.bout_approvals (bout_id, side, decision, note, override, decided_by, decided_at)
    select r.bout_id, case r.side when 'red' then 'blue' else 'red' end, r.decision, r.note, r.override, r.decided_by, r.decided_at
    from unnest(v_rows) r;
    -- Open corner to-dos follow their club.
    update public.notifications
    set action_key = case when action_key like '%:red' then 'bout:' || p_bout_id || ':blue' else 'bout:' || p_bout_id || ':red' end
    where done_at is null and action_key in ('bout:' || p_bout_id || ':red', 'bout:' || p_bout_id || ':blue');
  end if;
end;
$$;

revoke execute on function public.swap_bout_corners(uuid) from public, anon;
grant execute on function public.swap_bout_corners(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- A club owner withdraws their athlete from a bout
-- ---------------------------------------------------------------------------

-- p_side: the caller's corner, 'red' or 'blue'. That corner's club owners (or a site Admin) can
-- withdraw at any time until the bout has a result, even after it's approved. The bout is cancelled
-- and everyone involved is told (notify_bout_change).
create or replace function public.withdraw_corner(p_bout_id uuid, p_side text, p_reason text default null) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_bout public.bouts;
  v_club uuid;
  v_reason text := nullif(trim(p_reason), '');
begin
  select * into v_bout from public.bouts where id = p_bout_id for update;
  if not found then
    raise exception 'That bout no longer exists' using errcode = 'P0002';
  end if;
  if p_side not in ('red', 'blue') then
    raise exception 'Pick the red or blue corner' using errcode = '22023';
  end if;
  v_club := case when p_side = 'red' then v_bout.red_club_id else v_bout.blue_club_id end;
  if not coalesce(public.club_role(v_club) = 'owner', false) and not public.is_site_admin() then
    raise exception 'Only that corner''s club owners can withdraw its athlete' using errcode = '42501';
  end if;
  if v_bout.status = 'cancelled' then
    raise exception 'This bout is already cancelled' using errcode = '22023';
  end if;
  if v_bout.winner is not null then
    raise exception 'This bout has a result, so it can''t be withdrawn from' using errcode = '22023';
  end if;
  if not public.card_open(v_bout.event_id) then
    raise exception 'The event isn''t Active' using errcode = '22023';
  end if;
  update public.bouts
  set status = 'cancelled', cancelled_at = now(),
      cancel_reason = 'Withdrawn by ' || coalesce(public.club_name(v_club), 'the ' || p_side || ' corner')
        || coalesce(': ' || v_reason, '')
  where id = p_bout_id;
end;
$$;

revoke execute on function public.withdraw_corner(uuid, text, text) from public, anon;
grant execute on function public.withdraw_corner(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Re-work out every open bout under the new rule
-- ---------------------------------------------------------------------------

-- Bouts that are already Approved stay Approved, so no card changes under anyone. Waiting bouts
-- the officials approved now also wait for each corner with a club owner. Bouts with results and
-- cancelled bouts are left alone.
select public.refresh_bout_status(b.id)
from public.bouts b
where b.status in ('pending', 'rejected') and b.winner is null and b.bout_type <> 'sparring';

-- Bouts sent for approval and still waiting: one open to-do per waiting side.
select public.add_bout_approval_todos(b)
from public.bouts b
join public.events e on e.id = b.event_id and e.status = 'active'
where b.approval_requested_at is not null and b.status = 'pending' and b.winner is null;
