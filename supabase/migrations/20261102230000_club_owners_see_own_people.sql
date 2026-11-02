-- Migration 30: club owners and coaches see only the people of their own clubs (Bhavek 2026-11-02).
--
-- Before this, every signed-in user could read every account (profiles), every athlete, every
-- club membership and the Officials list. Now:
--
-- * Site Admins, event Owners and officials still see everyone. They pick people for events,
--   officials and club owners. (Only site Admins create events and pick their Owners.)
-- * Everyone else (club Owners and Coaches) sees:
--     - people:   themselves, the members of their own clubs (including invites waiting for a site
--                 Admin), the Owner and officials of events their club is in, whoever commented on
--                 their club's bouts, and whoever asked to transfer an athlete to or from their club.
--     - athletes: their own clubs' athletes, plus the opponent on a bout against their club and an
--                 athlete being transferred into their club. Nothing else.
--   Event entries and weigh-ins follow the same rule, so a club sees only its own entries and the
--   weigh-ins of athletes it can see.
-- * Club owners invite people by email (invite_club_member) since they no longer see the full
--   user list.
--
-- Runs after migration 29 (20261102220000_officials_reorder_card.sql).

-- ---------------------------------------------------------------------------
-- Who sees everyone
-- ---------------------------------------------------------------------------

-- Site Admins, Owners of any event, and officials (an Officials record, the Official account
-- type, or a CO/Deputy seat on an event).
create or replace function public.sees_everyone() returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    public.is_site_admin()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.status = 'active' and (
        p.role_id = 'official'
        or exists (select 1 from public.event_members m where m.user_id = p.id and m.role = 'owner')
        or exists (select 1 from public.event_officials o where o.user_id = p.id)
        or exists (select 1 from public.officials o where o.user_id = p.id)
      )
    ),
    false)
$$;

-- Is the signed-in user an Owner, CO, Deputy or accepted official of this event (or a site Admin)?
create or replace function public.runs_event(p_event_id uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    public.is_site_admin() or public.is_event_owner(p_event_id)
    or public.event_official_role(p_event_id) is not null
    or public.is_accepted_official(p_event_id),
    false)
$$;

-- ---------------------------------------------------------------------------
-- People (profiles)
-- ---------------------------------------------------------------------------

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
    -- Owner, viewer or official of an event my club is in.
    or exists (
      select 1 from public.event_members m
      where m.user_id = p_user_id and public.in_event_club(m.event_id)
    )
    or exists (
      select 1 from public.event_officials o
      where o.user_id = p_user_id and public.in_event_club(o.event_id)
    )
    or exists (
      select 1 from public.official_invitations i
      join public.officials o on o.id = i.official_id
      where o.user_id = p_user_id and i.status = 'accepted' and public.in_event_club(i.event_id)
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

drop policy if exists "members read user profiles" on public.profiles;
create policy "read people you work with" on public.profiles for select to authenticated
  using (public.can_see_person(id));

-- ---------------------------------------------------------------------------
-- Club members
-- ---------------------------------------------------------------------------

drop policy if exists "members read club members" on public.club_members;
create policy "read club members" on public.club_members for select to authenticated
  using (
    user_id = auth.uid()
    or public.club_role(club_id) is not null
    or public.sees_everyone()
  );

-- ---------------------------------------------------------------------------
-- Officials list
-- ---------------------------------------------------------------------------

drop policy if exists "read officials" on public.officials;
create policy "read officials" on public.officials for select to authenticated
  using (user_id = auth.uid() or (public.has_permission('officials:read') and public.sees_everyone()));

-- ---------------------------------------------------------------------------
-- Athletes
-- ---------------------------------------------------------------------------

create or replace function public.can_see_athlete(p_athlete_id uuid, p_club_id uuid, p_user_id uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    public.is_site_admin()
    or p_user_id = auth.uid()
    or (p_club_id is not null and public.club_role(p_club_id) is not null)
    -- The people running an event see everyone entered, or asking to enter late.
    or exists (select 1 from public.event_athletes ea where ea.athlete_id = p_athlete_id and public.runs_event(ea.event_id))
    or exists (select 1 from public.late_entry_requests l where l.athlete_id = p_athlete_id and public.runs_event(l.event_id))
    -- Bouts: the event's Owner and officials, and both corners' clubs (so a club sees its opponent).
    or exists (
      select 1 from public.bouts b
      where (b.red_athlete_id = p_athlete_id or b.blue_athlete_id = p_athlete_id)
        and (public.runs_event(b.event_id)
          or public.club_role(b.red_club_id) is not null
          or public.club_role(b.blue_club_id) is not null)
    )
    -- Being transferred into my club.
    or exists (
      select 1 from public.athlete_transfers t
      where t.athlete_id = p_athlete_id and t.to_club_id is not null and public.club_role(t.to_club_id) is not null
    ),
    false)
$$;

drop policy if exists "read athletes" on public.athletes;
create policy "read athletes" on public.athletes for select to authenticated
  using (public.can_see_athlete(id, club_id, user_id));

-- ---------------------------------------------------------------------------
-- Entries and weigh-ins
-- ---------------------------------------------------------------------------

-- The people running the event see every entry; a club sees its own.
drop policy if exists "read event athletes" on public.event_athletes;
create policy "read event athletes" on public.event_athletes for select to authenticated
  using (public.runs_event(event_id) or (club_id is not null and public.club_role(club_id) is not null));

-- Weigh-ins (weights and medicals): the people running the event, or a club for athletes it can see.
drop policy if exists "read weigh-ins" on public.weigh_ins;
create policy "read weigh-ins" on public.weigh_ins for select to authenticated
  using (
    public.can_read_bouts(event_id)
    and (public.runs_event(event_id) or athlete_id in (select a.id from public.athletes a))
  );

-- ---------------------------------------------------------------------------
-- Inviting people by email
-- ---------------------------------------------------------------------------

-- A club Owner (or site Admin) adds someone by their email. Owners' invites wait for a site Admin
-- (check_club_member makes sure of that); a site Admin's join straight away.
-- Returns the person's name (or email).
create or replace function public.invite_club_member(p_club_id uuid, p_email text, p_role text default 'coach')
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_user public.profiles;
  v_admin boolean := public.is_site_admin();
begin
  if not (v_admin or coalesce(public.club_role(p_club_id) = 'owner', false)) then
    raise exception 'Only the club''s Owners can invite people' using errcode = '42501';
  end if;
  if coalesce(p_role, 'coach') not in ('owner', 'coach') then
    raise exception 'Invite people as an Owner or a Coach' using errcode = '22023';
  end if;
  select * into v_user from public.profiles where lower(email) = lower(trim(p_email));
  if v_user.id is null then
    raise exception 'Nobody has signed in with % yet. Ask them to sign in once, then invite them.', lower(trim(p_email))
      using errcode = '23514';
  end if;
  if v_user.status <> 'active' then
    raise exception '% is disabled', lower(trim(p_email)) using errcode = '23514';
  end if;
  if exists (select 1 from public.club_members where club_id = p_club_id and user_id = v_user.id) then
    raise exception '% is already in the club or invited', lower(trim(p_email)) using errcode = '23505';
  end if;
  insert into public.club_members (club_id, user_id, role, status)
  values (p_club_id, v_user.id, coalesce(p_role, 'coach'), case when v_admin then 'active' else 'pending' end);
  return coalesce(nullif(trim(v_user.name), ''), v_user.email);
end;
$$;

revoke execute on function public.sees_everyone() from public, anon;
revoke execute on function public.runs_event(uuid) from public, anon;
revoke execute on function public.can_see_person(uuid) from public, anon;
revoke execute on function public.can_see_athlete(uuid, uuid, uuid) from public, anon;
revoke execute on function public.invite_club_member(uuid, text, text) from public, anon;
grant execute on function public.sees_everyone() to authenticated;
grant execute on function public.runs_event(uuid) to authenticated;
grant execute on function public.can_see_person(uuid) to authenticated;
grant execute on function public.can_see_athlete(uuid, uuid, uuid) to authenticated;
grant execute on function public.invite_club_member(uuid, text, text) to authenticated;
