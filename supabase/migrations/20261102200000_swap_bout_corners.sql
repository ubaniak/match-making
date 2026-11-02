-- Migration 27: swap the red and blue corners of an existing bout.
--
-- The same two boxers keep boxing each other, so the bout keeps its approval and its card spot;
-- only who is in red and who is in blue changes. (Since migration 26 only the official approval
-- counts, so nothing else needs moving.)
-- The same people who can re-match a bout can swap it: the Owner until that day's weigh-in starts,
-- then only the Chief Official or Deputy. Not allowed once the bout has a result or is cancelled.
--
-- Run after migration 26 (20261102140000_officials_approve_bouts.sql).

create or replace function public.swap_bout_corners(p_bout_id uuid) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_bout public.bouts;
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
end;
$$;

revoke execute on function public.swap_bout_corners(uuid) from public, anon;
grant execute on function public.swap_bout_corners(uuid) to authenticated;
