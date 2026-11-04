-- Hide each event's officials from everyone except the people who run it.
--
-- Bhavek 2026-11-04: "hide the officials list from events from anyone who is not an event owner,
-- or official or admin".
--
-- Who still sees an event's officials (public.can_see_official_lists, unchanged):
--   * the site Admin
--   * the event's Owner
--   * the event's Chief Officials (both seats)
--   * officials who accepted the event's invitation
-- Everyone else (club owners and coaches, members who entered athletes, the public) no longer sees:
--   * the Chief Official seats (event_officials)
--   * who works each bout (bout_officials)
--   * the event's officials' profiles, unless they share a club or commented on the club's bout
-- An official still sees their own seat, bout rows and invitation.
--
-- The invitation list (official_invitations, list_event_invitations) already used
-- can_see_official_lists. The public page (list_public_events) never listed officials.
--
-- Runs after migration 50 (20261104090000_event_locations.sql).

-- Chief Official seats.
drop policy if exists "read event officials" on public.event_officials;
create policy "read event officials" on public.event_officials for select to authenticated
  using (user_id = auth.uid() or public.can_see_official_lists(event_id));

-- Who works each bout.
drop policy if exists "read bout officials" on public.bout_officials;
create policy "read bout officials" on public.bout_officials for select to authenticated
  using (
    user_id = auth.uid()
    or exists (select 1 from public.bouts b where b.id = bout_id and public.can_see_official_lists(b.event_id))
  );

-- People: same as migration 30, without "an official of an event my club is in".
create or replace function public.can_see_person(p_user_id uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    p_user_id = auth.uid()
    or public.sees_everyone()
    -- Shares a club with me (any status on their side, so my club's pending invites show).
    or exists (
      select 1 from public.club_members theirs
      where theirs.user_id = p_user_id and public.club_role(theirs.club_id) is not null
    )
    -- Owner of an event my club is in.
    or exists (
      select 1 from public.event_members m
      where m.user_id = p_user_id and public.in_event_club(m.event_id)
    )
    -- Commented on one of my club's bouts.
    or exists (
      select 1 from public.bout_comments c
      where c.author_id = p_user_id and public.in_bout(c.bout_id)
    )
    -- Asked to transfer an athlete to or from my club.
    or exists (
      select 1 from public.athlete_transfers t
      where t.requested_by = p_user_id
        and ((t.from_club_id is not null and public.club_role(t.from_club_id) is not null)
          or (t.to_club_id is not null and public.club_role(t.to_club_id) is not null))
    ),
    false)
$$;
