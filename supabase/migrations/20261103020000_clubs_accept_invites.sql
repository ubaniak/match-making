-- Migration 34: an invited club must accept before it is in the event.
-- Needs migrations 1-33 first. Safe to run more than once.
--
-- Bhavek 2026-11-03: "When a club is invited to an event, do not add their athletes to the event
-- until the club has accepted, and only add athletes that the club has submitted for the event."
--
--   * invite_club no longer puts a club straight in. The club is 'invited' and its Owners get a
--     to-do. A club Owner (or a site Admin) accepts or declines with answer_club_invite.
--   * Until it accepts, the club can't enter athletes and can't see the event's entries or bouts
--     (in_event_club and check_entry only count 'accepted').
--   * Athletes are only ever on the event because their club Owner entered them (enter_athlete or
--     an accepted late entry). Accepting an invitation enters nobody.
--   * If the club had already asked to join, the Owner's invite accepts that request (both sides
--     agreed). A club that is invited and then asks to join is simply in.
--   * A club the event's Owner creates on the event (create_event_club) still joins straight away:
--     it is brand new and has no athletes until its owners add and enter them.
--   * Clubs already in an event stay in.

-- ---------------------------------------------------------------------------
-- New status and notification kinds
-- ---------------------------------------------------------------------------

alter table public.event_clubs drop constraint if exists event_clubs_status_check;
alter table public.event_clubs add constraint event_clubs_status_check
  check (status in ('invited', 'requested', 'accepted', 'declined'));

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'availability', 'invitation_answer', 'official_role',
  'bout_approval', 'bout_decision', 'bout_cancelled', 'bout_comment',
  'join_request', 'join_answer', 'late_entry', 'late_entry_answer',
  'transfer', 'transfer_answer', 'member_request', 'member_answer',
  'event_role', 'event_status',
  'club_invite', 'club_invite_answer'
));

-- ---------------------------------------------------------------------------
-- Inviting, asking to join and answering
-- ---------------------------------------------------------------------------

-- The Owner (or a site Admin) invites a club. It is in only once one of its Owners accepts,
-- unless the club had already asked to join, in which case this accepts that request.
create or replace function public.invite_club(p_event_id uuid, p_club_id uuid) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_status text;
begin
  if not coalesce(public.is_site_admin() or public.is_event_owner(p_event_id), false) then
    raise exception 'Only the event''s Owner or a site Admin can invite clubs' using errcode = '42501';
  end if;
  if not public.event_is_open(p_event_id) then
    raise exception 'Clubs can be invited once the event is Active' using errcode = '22023';
  end if;
  if not exists (select 1 from public.clubs where id = p_club_id) then
    raise exception 'That club no longer exists' using errcode = 'P0002';
  end if;
  select status into v_status from public.event_clubs where event_id = p_event_id and club_id = p_club_id;
  if v_status = 'accepted' then
    raise exception 'That club is already in this event' using errcode = '23505';
  end if;
  if v_status = 'invited' then
    return;
  end if;
  if v_status = 'requested' then
    update public.event_clubs set status = 'accepted', decided_by = auth.uid(), decided_at = now()
    where event_id = p_event_id and club_id = p_club_id;
    return;
  end if;
  -- New, or invited again after the club (or the Owner) said no.
  insert into public.event_clubs (event_id, club_id, status, requested_by, requested_at, decided_by, decided_at)
  values (p_event_id, p_club_id, 'invited', auth.uid(), now(), null, null)
  on conflict (event_id, club_id) do update
    set status = 'invited', requested_by = auth.uid(), requested_at = now(), decided_by = null, decided_at = null;
end;
$$;

-- A club Owner (or a site Admin) accepts or declines their club's invitation.
create or replace function public.answer_club_invite(p_event_id uuid, p_club_id uuid, p_accept boolean) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not coalesce(public.is_site_admin() or public.club_role(p_club_id) = 'owner', false) then
    raise exception 'Only the club''s Owners can answer its invitation' using errcode = '42501';
  end if;
  if p_accept and not public.event_is_open(p_event_id) then
    raise exception 'This event is no longer taking clubs' using errcode = '22023';
  end if;
  update public.event_clubs
  set status = case when p_accept then 'accepted' else 'declined' end, decided_by = auth.uid(), decided_at = now()
  where event_id = p_event_id and club_id = p_club_id and status = 'invited';
  if not found then
    raise exception 'That invitation is no longer waiting' using errcode = '22023';
  end if;
end;
$$;

-- A club owner asks for their club to join. If the club was already invited, this accepts.
create or replace function public.request_to_join(p_event_id uuid, p_club_id uuid) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_status text;
begin
  if not coalesce(public.is_site_admin() or public.club_role(p_club_id) = 'owner', false) then
    raise exception 'Only the club''s Owners can ask to join for it' using errcode = '42501';
  end if;
  if not public.event_is_open(p_event_id) then
    raise exception 'Clubs can join once the event is Active' using errcode = '22023';
  end if;
  select status into v_status from public.event_clubs where event_id = p_event_id and club_id = p_club_id;
  if v_status = 'accepted' then
    raise exception 'That club is already in this event' using errcode = '23505';
  end if;
  if v_status = 'requested' then
    return;
  end if;
  if v_status = 'invited' then
    perform public.answer_club_invite(p_event_id, p_club_id, true);
    return;
  end if;
  insert into public.event_clubs (event_id, club_id, status)
  values (p_event_id, p_club_id, 'requested')
  on conflict (event_id, club_id) do update
    set status = 'requested', requested_by = auth.uid(), requested_at = now(), decided_by = null, decided_at = null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------------

-- Same as migration 22, plus: an invitation is a to-do for the club's Owners, and their answer
-- goes to the event's Owners. Whoever acts is never told about their own action.
create or replace function public.notify_event_club() returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_key text := 'join:' || coalesce(new.event_id, old.event_id) || ':' || coalesce(new.club_id, old.club_id);
  v_invite_key text := 'club-invite:' || coalesce(new.event_id, old.event_id) || ':' || coalesce(new.club_id, old.club_id);
  v_was text := case when tg_op = 'UPDATE' then old.status end;
begin
  if tg_op = 'DELETE' then
    perform public.resolve_notifications(v_key);
    perform public.resolve_notifications(v_invite_key);
    return old;
  end if;
  if new.status = 'invited' and v_was is distinct from 'invited' then
    perform public.add_notification(
      public.club_people_ids(new.club_id), 'club_invite',
      coalesce(public.club_name(new.club_id), 'Your club') || ' is invited to ' || public.event_name(new.event_id),
      'Accept to enter athletes. Only the athletes you enter take part.',
      new.event_id, new.club_id, null, 'clubs', v_invite_key);
  elsif new.status = 'requested' and v_was is distinct from 'requested' then
    perform public.add_notification(
      public.event_owner_ids(new.event_id), 'join_request',
      coalesce(public.club_name(new.club_id), 'A club') || ' asked to join ' || public.event_name(new.event_id),
      null, new.event_id, new.club_id, null, 'clubs', v_key);
  elsif new.status in ('accepted', 'declined') and v_was = 'invited' then
    -- The club answered the Owner's invitation.
    perform public.resolve_notifications(v_invite_key);
    perform public.add_notification(
      public.event_owner_ids(new.event_id), 'club_invite_answer',
      coalesce(public.club_name(new.club_id), 'A club')
        || case when new.status = 'accepted' then ' accepted the invitation to ' else ' declined the invitation to ' end
        || public.event_name(new.event_id),
      null, new.event_id, new.club_id, null, 'clubs');
    if new.status = 'accepted' then
      -- Coaches and the other Owners of the club hear that it's in.
      perform public.add_notification(
        public.club_people_ids(new.club_id, true), 'join_answer',
        coalesce(public.club_name(new.club_id), 'Your club') || ' is in ' || public.event_name(new.event_id),
        'You can now enter athletes.', new.event_id, new.club_id, null, 'clubs');
    end if;
  elsif new.status in ('accepted', 'declined') and v_was is distinct from new.status then
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

revoke execute on function public.answer_club_invite(uuid, uuid, boolean) from public, anon;
grant execute on function public.answer_club_invite(uuid, uuid, boolean) to authenticated;
