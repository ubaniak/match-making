-- Migration 22: in-app alerts and notifications.
--
-- Everyone gets a notification when something needs them or concerns them:
--
--   Needs action (shown as "To do" until someone deals with it):
--     * an official is invited to an event (are they available?)
--     * a bout is sent for approval (each waiting corner's club Owners; the Chief Official and Deputy)
--     * a club asks to join an event, or sends a late entry (the event's Owner)
--     * a transfer is requested (the receiving club's Owners)
--     * a club Owner invites someone to the club (site Admins approve)
--   For information:
--     * a comment on a bout (everyone involved in it, except whoever wrote it)
--     * answers: invitation accepted or declined, bout approved or rejected or cancelled,
--       join request, late entry and transfer accepted or declined, member approved
--     * being made an event's Owner or a member, Chief Official or Deputy, and the event approved
--
-- A to-do carries an action_key. When the thing is dealt with (by anyone who can), every to-do
-- with that key is marked done, so it leaves everyone's list. Nobody is told about their own action.
--
-- Rows are written only by the triggers below. People read their own, mark them read or unread,
-- and delete them. The table is on Supabase Realtime so the bell updates straight away.

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in (
    'availability', 'invitation_answer', 'official_role',
    'bout_approval', 'bout_decision', 'bout_cancelled', 'bout_comment',
    'join_request', 'join_answer', 'late_entry', 'late_entry_answer',
    'transfer', 'transfer_answer', 'member_request', 'member_answer',
    'event_role', 'event_status'
  )),
  title text not null,
  body text,
  event_id uuid references public.events (id) on delete cascade,
  club_id uuid references public.clubs (id) on delete cascade,
  bout_id uuid references public.bouts (id) on delete cascade,
  -- Which tab of the event to open: 'bouts', 'clubs', 'officials', 'settings'.
  tab text,
  -- Set on to-dos; the same key on every copy of the same to-do.
  action_key text,
  needs_action boolean generated always as (action_key is not null) stored,
  actor_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  done_at timestamptz
);

create index notifications_user_idx on public.notifications (user_id, created_at desc);
create index notifications_open_action_idx on public.notifications (action_key) where done_at is null;

-- ---------------------------------------------------------------------------
-- Helpers (internal: not callable from the app)
-- ---------------------------------------------------------------------------

-- Writes one notification per person, skipping whoever is acting and inactive accounts.
create function public.add_notification(
  p_users uuid[], p_kind text, p_title text, p_body text default null,
  p_event uuid default null, p_club uuid default null, p_bout uuid default null,
  p_tab text default null, p_action_key text default null
) returns void
language sql security definer set search_path = public
as $$
  insert into public.notifications (user_id, kind, title, body, event_id, club_id, bout_id, tab, action_key, actor_id)
  select distinct p.id, p_kind, p_title, nullif(left(p_body, 300), ''), p_event, p_club, p_bout, p_tab, p_action_key, auth.uid()
  from unnest(coalesce(p_users, '{}'::uuid[])) as u (id)
  join public.profiles p on p.id = u.id and p.status = 'active'
  where p.id is distinct from auth.uid()
$$;

-- Marks every open to-do with this key (or matching this LIKE pattern) as done.
create function public.resolve_notifications(p_key text) returns void
language sql security definer set search_path = public
as $$
  update public.notifications
  set done_at = now(), read_at = coalesce(read_at, now())
  where done_at is null and action_key like p_key
$$;

create function public.event_owner_ids(p_event uuid) returns uuid[]
language sql stable security definer set search_path = public
as $$
  select coalesce(array_agg(user_id), '{}') from public.event_members where event_id = p_event and role = 'owner'
$$;

create function public.event_official_ids(p_event uuid) returns uuid[]
language sql stable security definer set search_path = public
as $$
  select coalesce(array_agg(user_id), '{}') from public.event_officials where event_id = p_event
$$;

-- The club's active Owners, or its Owners and Coaches.
create function public.club_people_ids(p_club uuid, p_coaches boolean default false) returns uuid[]
language sql stable security definer set search_path = public
as $$
  select coalesce(array_agg(user_id), '{}') from public.club_members
  where club_id = p_club and status = 'active' and (role = 'owner' or (p_coaches and role = 'coach'))
$$;

create function public.site_admin_ids() returns uuid[]
language sql stable security definer set search_path = public
as $$
  select coalesce(array_agg(id), '{}') from public.profiles where role_id = 'admin' and status = 'active'
$$;

create function public.event_name(p_event uuid) returns text
language sql stable security definer set search_path = public
as $$
  select name from public.events where id = p_event
$$;

create function public.club_name(p_club uuid) returns text
language sql stable security definer set search_path = public
as $$
  select name from public.clubs where id = p_club
$$;

create function public.athlete_name(p_athlete uuid) returns text
language sql stable security definer set search_path = public
as $$
  select name from public.athletes where id = p_athlete
$$;

create function public.person_name(p_user uuid) returns text
language sql stable security definer set search_path = public
as $$
  select coalesce(nullif(trim(name), ''), email) from public.profiles where id = p_user
$$;

-- 'Ali Hassan vs Marco Ruiz'
create function public.bout_label(p_bout public.bouts) returns text
language sql stable security definer set search_path = public
as $$
  select coalesce(public.athlete_name(p_bout.red_athlete_id), 'Red') || ' vs ' || coalesce(public.athlete_name(p_bout.blue_athlete_id), 'Blue')
$$;

-- 'Eastside Winter Box Cup · Sat 14 Nov'
create function public.bout_where(p_bout public.bouts) returns text
language sql stable security definer set search_path = public
as $$
  select coalesce(public.event_name(p_bout.event_id), 'Event') || ' · ' || to_char(p_bout.day, 'Dy DD Mon')
$$;

-- ---------------------------------------------------------------------------
-- Official invitations: "are you available?" and the answers
-- ---------------------------------------------------------------------------

create function public.notify_official_invitation() returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_key text;
  v_user uuid;
  v_name text;
  v_event public.events;
begin
  v_key := 'invitation:' || coalesce(new.id, old.id);
  if tg_op = 'DELETE' then
    perform public.resolve_notifications(v_key);
    return old;
  end if;

  select user_id, name into v_user, v_name from public.officials where id = new.official_id;
  select * into v_event from public.events where id = new.event_id;

  if new.status = 'pending'
     and (tg_op = 'INSERT' or old.status <> 'pending' or old.invited_at is distinct from new.invited_at) then
    perform public.resolve_notifications(v_key);
    perform public.add_notification(
      array[v_user], 'availability', 'Are you available for ' || v_event.name || '?',
      to_char(v_event.start_date, 'Dy DD Mon YYYY')
        || case when v_event.end_date > v_event.start_date then ' to ' || to_char(v_event.end_date, 'Dy DD Mon YYYY') else '' end
        || coalesce(' · ' || v_event.venue, '')
        || coalesce('. Please answer by ' || to_char(new.respond_by, 'Dy DD Mon'), ''),
      new.event_id, null, null, 'officials', v_key);
  elsif tg_op = 'UPDATE' and new.status in ('accepted', 'declined') and new.responded_at is distinct from old.responded_at then
    perform public.resolve_notifications(v_key);
    perform public.add_notification(
      public.event_owner_ids(new.event_id), 'invitation_answer',
      coalesce(v_name, 'An official') || ' ' || new.status || ' ' || v_event.name,
      case when new.status = 'accepted' and new.days is not null
        then 'Days: ' || (select string_agg(to_char(d, 'Dy DD Mon'), ', ' order by d) from unnest(new.days) as d) end,
      new.event_id, null, null, 'officials');
  end if;
  return new;
end;
$$;

create trigger official_invitations_notify
  after insert or update or delete on public.official_invitations
  for each row execute function public.notify_official_invitation();

-- An official who signs in after being invited still gets their open invitations.
create function public.notify_official_linked() returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_inv record;
begin
  for v_inv in
    select i.id, e.id as event_id, e.name, e.start_date, i.respond_by
    from public.official_invitations i
    join public.events e on e.id = i.event_id
    where i.official_id = new.id and i.status = 'pending' and e.status = 'active'
  loop
    perform public.add_notification(
      array[new.user_id], 'availability', 'Are you available for ' || v_inv.name || '?',
      to_char(v_inv.start_date, 'Dy DD Mon YYYY') || coalesce('. Please answer by ' || to_char(v_inv.respond_by, 'Dy DD Mon'), ''),
      v_inv.event_id, null, null, 'officials', 'invitation:' || v_inv.id);
  end loop;
  return new;
end;
$$;

create trigger officials_notify_linked
  after update of user_id on public.officials
  for each row when (new.user_id is not null and old.user_id is distinct from new.user_id)
  execute function public.notify_official_linked();

-- Chief Official and Deputy.
create function public.notify_event_official() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and old.user_id = new.user_id then
    return new;
  end if;
  perform public.add_notification(
    array[new.user_id], 'official_role',
    'You are the ' || case new.role when 'chief' then 'Chief Official' else 'Deputy' end || ' for ' || public.event_name(new.event_id),
    null, new.event_id, null, null, 'officials');
  return new;
end;
$$;

create trigger event_officials_notify
  after insert or update of user_id on public.event_officials
  for each row execute function public.notify_event_official();

-- ---------------------------------------------------------------------------
-- Bouts: sent for approval, decided, cancelled, and comments
-- ---------------------------------------------------------------------------

create function public.notify_bout_change() returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_side text;
  v_users uuid[];
  v_label text := public.bout_label(new);
  v_where text := public.bout_where(new);
begin
  -- Sent (or sent again) for approval: a to-do for each side still waiting.
  if new.approval_requested_at is not null and new.approval_requested_at is distinct from old.approval_requested_at
     and new.status = 'pending' and new.winner is null then
    foreach v_side in array array['red', 'blue', 'official'] loop
      perform public.resolve_notifications('bout:' || new.id || ':' || v_side);
      continue when exists (
        select 1 from public.bout_approvals a where a.bout_id = new.id and a.side = v_side and a.decision = 'approved'
      );
      v_users := case v_side
        when 'red' then public.club_people_ids(new.red_club_id)
        when 'blue' then public.club_people_ids(new.blue_club_id)
        else public.event_official_ids(new.event_id) end;
      perform public.add_notification(
        v_users, 'bout_approval', 'Approve bout: ' || v_label,
        v_where || case v_side when 'official' then ' · official approval' else ' · ' || v_side || ' corner' end,
        new.event_id, null, new.id, 'bouts', 'bout:' || new.id || ':' || v_side);
    end loop;
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

-- No column list: re-matching clears approval_requested_at in a BEFORE trigger.
create trigger bouts_notify
  after update on public.bouts
  for each row when (old.approval_requested_at is distinct from new.approval_requested_at
    or old.status is distinct from new.status or old.winner is distinct from new.winner)
  execute function public.notify_bout_change();

-- A corner or the officials decided: their to-do is done; a rejection is reported.
create function public.notify_bout_approval() returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_bout public.bouts;
  v_who text;
begin
  perform public.resolve_notifications('bout:' || new.bout_id || ':' || new.side);
  if new.decision = 'rejected' and (tg_op = 'INSERT' or old.decision <> 'rejected') then
    select * into v_bout from public.bouts where id = new.bout_id;
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

create trigger bout_approvals_notify
  after insert or update on public.bout_approvals
  for each row execute function public.notify_bout_approval();

-- Comments go to everyone involved in the bout: the Owner, the officials and both clubs.
create function public.notify_bout_comment() returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_bout public.bouts;
begin
  select * into v_bout from public.bouts where id = new.bout_id;
  perform public.add_notification(
    public.event_owner_ids(v_bout.event_id) || public.event_official_ids(v_bout.event_id)
      || public.club_people_ids(v_bout.red_club_id, true) || public.club_people_ids(v_bout.blue_club_id, true),
    'bout_comment',
    coalesce(public.person_name(new.author_id), 'Someone') || ' commented on ' || public.bout_label(v_bout),
    '"' || new.body || '"',
    v_bout.event_id, null, v_bout.id, 'bouts');
  return new;
end;
$$;

create trigger bout_comments_notify
  after insert on public.bout_comments
  for each row execute function public.notify_bout_comment();

-- ---------------------------------------------------------------------------
-- Clubs joining events, and late entries
-- ---------------------------------------------------------------------------

create function public.notify_event_club() returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_key text := 'join:' || coalesce(new.event_id, old.event_id) || ':' || coalesce(new.club_id, old.club_id);
begin
  if tg_op = 'DELETE' then
    perform public.resolve_notifications(v_key);
    return old;
  end if;
  if new.status = 'requested' and (tg_op = 'INSERT' or old.status <> 'requested') then
    perform public.add_notification(
      public.event_owner_ids(new.event_id), 'join_request',
      coalesce(public.club_name(new.club_id), 'A club') || ' asked to join ' || public.event_name(new.event_id),
      null, new.event_id, new.club_id, null, 'clubs', v_key);
  elsif new.status in ('accepted', 'declined') and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    perform public.resolve_notifications(v_key);
    perform public.add_notification(
      public.club_people_ids(new.club_id, true), 'join_answer',
      coalesce(public.club_name(new.club_id), 'Your club')
        || case when new.status = 'accepted' then ' is in ' else ' was declined by ' end || public.event_name(new.event_id),
      case when new.status = 'accepted' then 'You can now enter athletes.' end,
      new.event_id, new.club_id, null, 'clubs');
  end if;
  return new;
end;
$$;

create trigger event_clubs_notify
  after insert or update of status or delete on public.event_clubs
  for each row execute function public.notify_event_club();

create function public.notify_late_entry() returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_key text := 'late:' || new.id;
begin
  if tg_op = 'INSERT' and new.status = 'pending' then
    perform public.add_notification(
      public.event_owner_ids(new.event_id), 'late_entry',
      'Late entry: ' || coalesce(public.athlete_name(new.athlete_id), 'an athlete') || ' for ' || public.event_name(new.event_id),
      coalesce(public.club_name(new.club_id), '') || coalesce(': "' || new.note || '"', ''),
      new.event_id, new.club_id, null, 'clubs', v_key);
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status and old.status = 'pending' then
    perform public.resolve_notifications(v_key);
    if new.status in ('accepted', 'declined') then
      perform public.add_notification(
        array[new.requested_by] || public.club_people_ids(new.club_id), 'late_entry_answer',
        'Late entry ' || new.status || ': ' || coalesce(public.athlete_name(new.athlete_id), 'athlete'),
        public.event_name(new.event_id), new.event_id, new.club_id, null, 'clubs');
    end if;
  end if;
  return new;
end;
$$;

create trigger late_entry_requests_notify
  after insert or update of status on public.late_entry_requests
  for each row execute function public.notify_late_entry();

-- ---------------------------------------------------------------------------
-- Transfers and club members
-- ---------------------------------------------------------------------------

create function public.notify_transfer() returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_key text := 'transfer:' || new.id;
  v_athlete text := coalesce(public.athlete_name(new.athlete_id), 'An athlete');
begin
  if tg_op = 'INSERT' and new.status = 'pending' then
    perform public.add_notification(
      public.club_people_ids(new.to_club_id), 'transfer',
      'Transfer request: ' || v_athlete || ' to ' || coalesce(public.club_name(new.to_club_id), 'your club'),
      'From ' || coalesce(public.club_name(new.from_club_id), 'no club') || coalesce(': "' || new.note || '"', ''),
      null, new.to_club_id, null, null, v_key);
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status and old.status = 'pending' then
    perform public.resolve_notifications(v_key);
    if new.status in ('accepted', 'declined') then
      perform public.add_notification(
        array[new.requested_by] || public.club_people_ids(new.from_club_id), 'transfer_answer',
        coalesce(public.club_name(new.to_club_id), 'The club') || ' ' || new.status || ' the transfer of ' || v_athlete,
        null, null, new.from_club_id, null, null);
    end if;
  end if;
  return new;
end;
$$;

create trigger athlete_transfers_notify
  after insert or update of status on public.athlete_transfers
  for each row execute function public.notify_transfer();

create function public.notify_club_member() returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_key text := 'member:' || coalesce(new.club_id, old.club_id) || ':' || coalesce(new.user_id, old.user_id);
begin
  if tg_op = 'DELETE' then
    perform public.resolve_notifications(v_key);
    return old;
  end if;
  if tg_op = 'INSERT' and new.status = 'pending' then
    perform public.add_notification(
      public.site_admin_ids(), 'member_request',
      'Approve ' || coalesce(public.person_name(new.user_id), 'someone') || ' as ' || new.role || ' of ' || coalesce(public.club_name(new.club_id), 'a club'),
      'Invited by ' || coalesce(public.person_name(new.invited_by), 'a club Owner'),
      null, new.club_id, null, null, v_key);
  elsif new.status = 'active' and (tg_op = 'INSERT' or old.status = 'pending') then
    perform public.resolve_notifications(v_key);
    perform public.add_notification(
      array[new.user_id], 'member_answer',
      'You are now ' || case new.role when 'owner' then 'an Owner' else 'a Coach' end || ' of ' || coalesce(public.club_name(new.club_id), 'a club'),
      null, null, new.club_id, null, null);
    if tg_op = 'UPDATE' then
      perform public.add_notification(
        array[new.invited_by], 'member_answer',
        coalesce(public.person_name(new.user_id), 'Your invite') || ' was approved for ' || coalesce(public.club_name(new.club_id), 'the club'),
        null, null, new.club_id, null, null);
    end if;
  end if;
  return new;
end;
$$;

create trigger club_members_notify
  after insert or update of status or delete on public.club_members
  for each row execute function public.notify_club_member();

-- ---------------------------------------------------------------------------
-- Events: new Owner or member, and status changes
-- ---------------------------------------------------------------------------

create function public.notify_event_member() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and old.user_id = new.user_id and old.role = new.role then
    return new;
  end if;
  perform public.add_notification(
    array[new.user_id], 'event_role',
    case when new.role = 'owner' then 'You are the Owner of ' else 'You were added to ' end || public.event_name(new.event_id),
    case when new.role = 'owner' then 'Add the poster and the weigh-in and bout times under Settings.' else 'As ' || initcap(new.role) || '.' end,
    new.event_id, null, null, case when new.role = 'owner' then 'settings' end);
  return new;
end;
$$;

create trigger event_members_notify
  after insert or update of user_id, role on public.event_members
  for each row execute function public.notify_event_member();

create function public.notify_event_status() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  -- Events closing on their own after the end date aren't news.
  if new.status in ('active', 'cancelled') then
    perform public.add_notification(
      public.event_owner_ids(new.id), 'event_status',
      new.name || case new.status when 'active' then ' was approved' else ' was cancelled' end,
      case new.status when 'active' then 'It is on the public page, and you can invite clubs and officials.' end,
      new.id);
  end if;
  return new;
end;
$$;

create trigger events_notify_status
  after update of status on public.events
  for each row when (old.status is distinct from new.status)
  execute function public.notify_event_status();

-- ---------------------------------------------------------------------------
-- Things already waiting when this runs become to-dos straight away.
-- ---------------------------------------------------------------------------

-- Officials who haven't answered yet.
select public.add_notification(
  array[o.user_id], 'availability', 'Are you available for ' || e.name || '?',
  to_char(e.start_date, 'Dy DD Mon YYYY') || coalesce('. Please answer by ' || to_char(i.respond_by, 'Dy DD Mon'), ''),
  e.id, null, null, 'officials', 'invitation:' || i.id)
from public.official_invitations i
join public.officials o on o.id = i.official_id and o.user_id is not null
join public.events e on e.id = i.event_id and e.status = 'active'
where i.status = 'pending';

-- Bouts sent for approval, each side still waiting.
select public.add_notification(
  case s.side when 'red' then public.club_people_ids(b.red_club_id)
    when 'blue' then public.club_people_ids(b.blue_club_id) else public.event_official_ids(b.event_id) end,
  'bout_approval', 'Approve bout: ' || public.bout_label(b),
  public.bout_where(b) || case s.side when 'official' then ' · official approval' else ' · ' || s.side || ' corner' end,
  b.event_id, null, b.id, 'bouts', 'bout:' || b.id || ':' || s.side)
from public.bouts b
cross join (values ('red'), ('blue'), ('official')) as s (side)
join public.events e on e.id = b.event_id and e.status = 'active'
where b.approval_requested_at is not null and b.status = 'pending' and b.winner is null
  and not exists (select 1 from public.bout_approvals a where a.bout_id = b.id and a.side = s.side and a.decision = 'approved');

-- Clubs asking to join, and late entries.
select public.add_notification(
  public.event_owner_ids(ec.event_id), 'join_request',
  coalesce(public.club_name(ec.club_id), 'A club') || ' asked to join ' || public.event_name(ec.event_id),
  null, ec.event_id, ec.club_id, null, 'clubs', 'join:' || ec.event_id || ':' || ec.club_id)
from public.event_clubs ec
where ec.status = 'requested';

select public.add_notification(
  public.event_owner_ids(r.event_id), 'late_entry',
  'Late entry: ' || coalesce(public.athlete_name(r.athlete_id), 'an athlete') || ' for ' || public.event_name(r.event_id),
  public.club_name(r.club_id), r.event_id, r.club_id, null, 'clubs', 'late:' || r.id)
from public.late_entry_requests r
where r.status = 'pending';

-- Transfers and club invites waiting for an answer.
select public.add_notification(
  public.club_people_ids(t.to_club_id), 'transfer',
  'Transfer request: ' || coalesce(public.athlete_name(t.athlete_id), 'An athlete') || ' to ' || coalesce(public.club_name(t.to_club_id), 'your club'),
  'From ' || coalesce(public.club_name(t.from_club_id), 'no club'),
  null, t.to_club_id, null, null, 'transfer:' || t.id)
from public.athlete_transfers t
where t.status = 'pending';

select public.add_notification(
  public.site_admin_ids(), 'member_request',
  'Approve ' || coalesce(public.person_name(m.user_id), 'someone') || ' as ' || m.role || ' of ' || coalesce(public.club_name(m.club_id), 'a club'),
  'Invited by ' || coalesce(public.person_name(m.invited_by), 'a club Owner'),
  null, m.club_id, null, null, 'member:' || m.club_id || ':' || m.user_id)
from public.club_members m
where m.status = 'pending';

-- ---------------------------------------------------------------------------
-- Row-level security: people see, mark and delete only their own notifications.
-- ---------------------------------------------------------------------------

alter table public.notifications enable row level security;

create policy "read own notifications" on public.notifications for select to authenticated
  using (user_id = auth.uid());
create policy "mark own notifications" on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "delete own notifications" on public.notifications for delete to authenticated
  using (user_id = auth.uid());

revoke all on public.notifications from anon, authenticated;
grant select, delete on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;

-- Live updates for the bell (Realtime respects the policies above).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants: every helper and trigger function is internal.
-- ---------------------------------------------------------------------------

revoke execute on function public.add_notification(uuid[], text, text, text, uuid, uuid, uuid, text, text) from public, anon, authenticated;
revoke execute on function public.resolve_notifications(text) from public, anon, authenticated;
revoke execute on function public.event_owner_ids(uuid) from public, anon, authenticated;
revoke execute on function public.event_official_ids(uuid) from public, anon, authenticated;
revoke execute on function public.club_people_ids(uuid, boolean) from public, anon, authenticated;
revoke execute on function public.site_admin_ids() from public, anon, authenticated;
revoke execute on function public.event_name(uuid) from public, anon, authenticated;
revoke execute on function public.club_name(uuid) from public, anon, authenticated;
revoke execute on function public.athlete_name(uuid) from public, anon, authenticated;
revoke execute on function public.person_name(uuid) from public, anon, authenticated;
revoke execute on function public.bout_label(public.bouts) from public, anon, authenticated;
revoke execute on function public.bout_where(public.bouts) from public, anon, authenticated;
revoke execute on function public.notify_official_invitation() from public, anon, authenticated;
revoke execute on function public.notify_official_linked() from public, anon, authenticated;
revoke execute on function public.notify_event_official() from public, anon, authenticated;
revoke execute on function public.notify_bout_change() from public, anon, authenticated;
revoke execute on function public.notify_bout_approval() from public, anon, authenticated;
revoke execute on function public.notify_bout_comment() from public, anon, authenticated;
revoke execute on function public.notify_event_club() from public, anon, authenticated;
revoke execute on function public.notify_late_entry() from public, anon, authenticated;
revoke execute on function public.notify_transfer() from public, anon, authenticated;
revoke execute on function public.notify_club_member() from public, anon, authenticated;
revoke execute on function public.notify_event_member() from public, anon, authenticated;
revoke execute on function public.notify_event_status() from public, anon, authenticated;
