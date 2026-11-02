-- Migration 26: only the Chief Official or Deputy approves or rejects bouts.
--
-- Before: a bout needed both corners' club Owners and an official to approve it, and the
-- "Approve bout" to-do went to all of them. Now one decision from the event's Chief Official or
-- Deputy approves or rejects a bout, and only they get the to-do. A site Admin can still approve
-- or reject (for when the officials are unavailable) but isn't sent the to-do.
--
-- Also fixes duplicate "Approve bout" to-dos: "Send for approval" marks bouts sent once from the
-- app and again from the send-event-email function, and each mark used to close the open to-do
-- and add a new one (one Done, one To do). Sending again now replaces the open to-do instead.
--
-- Run after migration 25 (20261102120000_bout_types.sql).

-- ---------------------------------------------------------------------------
-- Existing data: corner approvals no longer count
-- ---------------------------------------------------------------------------

-- Corner to-dos leave everyone's list.
update public.notifications
set done_at = now(), read_at = coalesce(read_at, now())
where done_at is null and (action_key like 'bout:%:red' or action_key like 'bout:%:blue');

delete from public.bout_approvals where side in ('red', 'blue');

alter table public.bout_approvals drop constraint if exists bout_approvals_side_check;
alter table public.bout_approvals add constraint bout_approvals_side_check check (side = 'official');

-- ---------------------------------------------------------------------------
-- Status: the official decision alone
-- ---------------------------------------------------------------------------

create or replace function public.refresh_bout_status(p_bout_id uuid) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_decision text;
begin
  select decision into v_decision from public.bout_approvals where bout_id = p_bout_id and side = 'official';
  update public.bouts
  set status = case
    when bout_type = 'sparring' then 'approved'
    when v_decision = 'approved' then 'approved'
    when v_decision = 'rejected' then 'rejected'
    else 'pending' end
  where id = p_bout_id and status <> 'cancelled';
end;
$$;

revoke execute on function public.refresh_bout_status(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Deciding: Chief Official, Deputy or site Admin only
-- ---------------------------------------------------------------------------

-- p_side is kept so the app's call doesn't change; only 'official' is accepted.
create or replace function public.decide_bout(p_bout_id uuid, p_side text, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_bout public.bouts;
begin
  select * into v_bout from public.bouts where id = p_bout_id for update;
  if not found then
    raise exception 'That bout no longer exists' using errcode = 'P0002';
  end if;
  if coalesce(p_side, 'official') <> 'official' then
    raise exception 'Only the Chief Official or Deputy can approve or reject bouts' using errcode = '42501';
  end if;
  -- is_event_official: the event's Chief Official or Deputy, or a site Admin.
  if not public.is_event_official(v_bout.event_id) then
    raise exception 'Only the Chief Official or Deputy can approve or reject bouts' using errcode = '42501';
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

  insert into public.bout_approvals (bout_id, side, decision, note, override)
  values (p_bout_id, 'official', case when p_approve then 'approved' else 'rejected' end, nullif(trim(p_note), ''), false)
  on conflict (bout_id, side) do update
    set decision = excluded.decision, note = excluded.note, override = false,
        decided_by = auth.uid(), decided_at = now();
  perform public.refresh_bout_status(p_bout_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Send for approval: tells only the Chief Official and Deputy
-- ---------------------------------------------------------------------------

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
      select b.*,
        (select count(*)::integer from public.bouts x
         where x.event_id = b.event_id and x.day = b.day and x.status <> 'cancelled'
           and (x.position < b.position or (x.position = b.position and x.id <= b.id))) as num
      from public.bouts b
      where b.id = any (p_bout_ids) and b.status = 'pending' and b.winner is null
    )
    select s.id, 'official'::text, p.name, p.email,
      e.name, e.venue, s.day, s.num,
      ra.name, rc.name, ba.name, bc.name
    from sent s
    join public.event_officials o on o.event_id = s.event_id
    join public.profiles p on p.id = o.user_id and p.status = 'active'
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
-- Notifications: one "Approve bout" to-do, for the Chief Official and Deputy
-- ---------------------------------------------------------------------------

create or replace function public.notify_bout_change() returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_key text := 'bout:' || new.id || ':official';
  v_label text := public.bout_label(new);
  v_where text := public.bout_where(new);
begin
  -- Sent (or sent again) for approval: the open to-do is replaced, so nobody ends up with two.
  if new.approval_requested_at is not null and new.approval_requested_at is distinct from old.approval_requested_at
     and new.status = 'pending' and new.winner is null then
    delete from public.notifications where action_key = v_key and done_at is null;
    perform public.add_notification(
      public.event_official_ids(new.event_id), 'bout_approval', 'Approve bout: ' || v_label,
      v_where, new.event_id, null, new.id, 'bouts', v_key);
  end if;

  -- Re-matched (the request was cleared) or no longer waiting: the to-do goes.
  if (new.approval_requested_at is null and old.approval_requested_at is not null)
     or (new.status <> 'pending' and old.status = 'pending') or (new.winner is not null and old.winner is null) then
    perform public.resolve_notifications('bout:' || new.id || ':%');
  end if;

  if new.status is distinct from old.status then
    if new.status = 'approved' then
      perform public.add_notification(
        public.club_people_ids(new.red_club_id, true) || public.club_people_ids(new.blue_club_id, true)
          || public.event_owner_ids(new.event_id),
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

-- The officials decided: the to-do is done; a rejection is reported to the Owner and both clubs.
create or replace function public.notify_bout_approval() returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_bout public.bouts;
begin
  perform public.resolve_notifications('bout:' || new.bout_id || ':' || new.side);
  if new.decision = 'rejected' and (tg_op = 'INSERT' or old.decision <> 'rejected') then
    select * into v_bout from public.bouts where id = new.bout_id;
    perform public.add_notification(
      public.event_owner_ids(v_bout.event_id) || public.event_official_ids(v_bout.event_id)
        || public.club_people_ids(v_bout.red_club_id) || public.club_people_ids(v_bout.blue_club_id),
      'bout_decision', 'The officials rejected ' || public.bout_label(v_bout),
      public.bout_where(v_bout) || coalesce(': "' || new.note || '"', ''),
      v_bout.event_id, null, v_bout.id, 'bouts');
  end if;
  return new;
end;
$$;

revoke execute on function public.notify_bout_change() from public, anon, authenticated;
revoke execute on function public.notify_bout_approval() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Re-work out every open bout under the new rule
-- ---------------------------------------------------------------------------

-- A bout the officials already approved becomes Approved even if a corner hadn't; a bout only a
-- corner rejected goes back to waiting. Bouts with results and cancelled bouts are left alone.
select public.refresh_bout_status(b.id)
from public.bouts b
where b.status in ('pending', 'rejected') and b.winner is null;

-- Bouts sent for approval that the officials haven't decided yet: make sure the Chief Official and
-- Deputy each have exactly one open to-do (older data may have had none or duplicates).
delete from public.notifications n
where n.done_at is null and n.action_key like 'bout:%:official';

select public.add_notification(
  public.event_official_ids(b.event_id), 'bout_approval', 'Approve bout: ' || public.bout_label(b),
  public.bout_where(b), b.event_id, null, b.id, 'bouts', 'bout:' || b.id || ':official')
from public.bouts b
join public.events e on e.id = b.event_id and e.status = 'active'
where b.approval_requested_at is not null and b.status = 'pending' and b.winner is null;
