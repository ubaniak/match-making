-- Bhavek, 2026-11-12: "if I am a club and viewing bouts for an event, i should only see the bouts
-- that I am a part of, I should not see comments or discussion warnings from other bouts".
--
-- Before: anyone in a club entered in the event could read every bout row of that event (with its
-- status, "Needs discussion" reason, rule warnings, override reason, cancel reason and approval
-- notes). Only the comments were limited to the bout's own clubs.
--
-- Now a bout and its approvals are readable by:
--   * the people who run the event: site Admin, Owner, Chief Official/Deputy, accepted officials
--     (runs_event), exactly as before; and
--   * members of the club in the red or blue corner. Nobody else in the event's clubs.
-- Comments keep their own rule (in_bout), which already only lets the bout's corners read them.
--
-- The public list of approved bouts (list_public_events, the Show public bouts switch) is not
-- changed. Weigh-ins were already limited to athletes the club can see (migration 30).
--
-- Run after 20261112000000 (if that is in). Run it BEFORE deploying the app.

-- Can the signed-in user read this bout?
create or replace function public.can_read_bout(p_event_id uuid, p_red_club_id uuid, p_blue_club_id uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    public.runs_event(p_event_id)
    or public.club_role(p_red_club_id) is not null
    or public.club_role(p_blue_club_id) is not null,
    false)
$$;

-- Same, by bout id (for the tables hanging off a bout).
create or replace function public.can_read_bout_id(p_bout_id uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.bouts b
    where b.id = p_bout_id and public.can_read_bout(b.event_id, b.red_club_id, b.blue_club_id)
  )
$$;

drop policy if exists "read bouts" on public.bouts;
create policy "read bouts" on public.bouts for select to authenticated
  using (public.can_read_bout(event_id, red_club_id, blue_club_id));

drop policy if exists "read bout approvals" on public.bout_approvals;
create policy "read bout approvals" on public.bout_approvals for select to authenticated
  using (public.can_read_bout_id(bout_id));

-- Comments stay as they were (in_bout: the bout's corners, Owner, CO/Deputy, site Admin).

-- A club now sees only some of the day's bouts, so the app can't count its place on the card.
-- card_number is the bout's place among the day's bouts that aren't cancelled (like the public
-- list), read as a computed field: bouts?select=*,card_number. Null for a cancelled bout.
create or replace function public.card_number(b public.bouts) returns bigint
language sql stable security definer set search_path = public
as $$
  select case when b.status = 'cancelled' then null else (
    select count(*) from public.bouts o
    where o.event_id = b.event_id and o.day = b.day and o.status <> 'cancelled'
      and (o.position, o.made_at, o.id) <= (b.position, b.made_at, b.id)
  ) end
$$;

revoke execute on function public.card_number(public.bouts) from public, anon;
grant execute on function public.card_number(public.bouts) to authenticated;

revoke execute on function public.can_read_bout(uuid, uuid, uuid) from public, anon;
revoke execute on function public.can_read_bout_id(uuid) from public, anon;
grant execute on function public.can_read_bout(uuid, uuid, uuid) to authenticated;
grant execute on function public.can_read_bout_id(uuid) to authenticated;
