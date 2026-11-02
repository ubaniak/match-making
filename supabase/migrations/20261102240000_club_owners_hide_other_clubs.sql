-- Migration 31: club owners and coaches don't see other clubs (Bhavek 2026-11-02).
--
-- Before this, every signed-in user could read every club. Now:
-- * Site Admins, event Owners and officials still see every club (sees_everyone(), migration 30).
-- * Everyone else sees the clubs they belong to (or are invited to), plus, by name only where the
--   screens need it:
--     - the club in the other corner of a bout against their club,
--     - the other club on a transfer to or from their club.
-- * An event's club list (event_clubs) shows a club only its own place in the event; the people
--   running the event still see every club in it.
-- * Picking where to send a transfer uses transfer_club_options(), which returns only club names.
--
-- Runs after migration 30 (20261102230000_club_owners_see_own_people.sql).

create or replace function public.can_see_club(p_club_id uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    public.sees_everyone()
    or exists (select 1 from public.club_members m where m.club_id = p_club_id and m.user_id = auth.uid())
    or exists (
      select 1 from public.bouts b
      where (b.red_club_id = p_club_id and b.blue_club_id is not null and public.club_role(b.blue_club_id) is not null)
         or (b.blue_club_id = p_club_id and b.red_club_id is not null and public.club_role(b.red_club_id) is not null)
    )
    or exists (
      select 1 from public.athlete_transfers t
      where (t.from_club_id = p_club_id and t.to_club_id is not null and public.club_role(t.to_club_id) is not null)
         or (t.to_club_id = p_club_id and t.from_club_id is not null and public.club_role(t.from_club_id) is not null)
    ),
    false)
$$;

drop policy if exists "members read clubs" on public.clubs;
create policy "read clubs you belong to" on public.clubs for select to authenticated
  using (public.can_see_club(id));

drop policy if exists "read event clubs" on public.event_clubs;
create policy "read event clubs" on public.event_clubs for select to authenticated
  using (public.runs_event(event_id) or public.club_role(club_id) is not null);

-- Where a club member can send a transfer: every other club, names only.
create or replace function public.transfer_club_options()
returns table (id uuid, name text)
language sql stable security definer set search_path = public
as $$
  select c.id, c.name from public.clubs c
  where public.is_site_admin()
     or exists (select 1 from public.club_members m join public.profiles p on p.id = m.user_id and p.status = 'active'
                where m.user_id = auth.uid() and m.status = 'active')
  order by c.name
$$;

revoke execute on function public.can_see_club(uuid) from public, anon;
revoke execute on function public.transfer_club_options() from public, anon;
grant execute on function public.can_see_club(uuid) to authenticated;
grant execute on function public.transfer_club_options() to authenticated;
