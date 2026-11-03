-- Clear test data failed with "violates foreign key constraint athletes_club_id_fkey" when
-- someone had added an athlete without "TEST " in their name to a TEST club while testing.
-- Clearing deleted the TEST athletes, then tried to delete the club while that athlete was
-- still in it.
--
-- Now an athlete in a TEST club counts as test data too, unless they are entered in, or
-- have a bout at, an event that isn't a TEST event. Those athletes are kept, and so is
-- their club, so no real bout history is ever lost. The result says how many clubs were kept.
create or replace function public.clear_test_roster() returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_events int;
  v_athletes int;
  v_clubs int;
  v_kept int;
begin
  if auth.uid() is not null and not public.is_site_admin() then
    raise exception 'Only a site Admin can clear test data' using errcode = '42501';
  end if;
  -- Events first: that removes their entries and bouts, so the athletes can then be deleted.
  delete from public.events where name like 'TEST %';
  get diagnostics v_events = row_count;

  -- After the TEST events are gone, any entry or bout left is at a real event.
  delete from public.athletes a
  where a.name like 'TEST %'
     or (a.club_id in (select id from public.clubs where name like 'TEST %')
         and not exists (select 1 from public.event_athletes ea where ea.athlete_id = a.id)
         and not exists (select 1 from public.bouts b where a.id in (b.red_athlete_id, b.blue_athlete_id)));
  get diagnostics v_athletes = row_count;

  delete from public.clubs c
  where c.name like 'TEST %'
    and not exists (select 1 from public.athletes a where a.club_id = c.id);
  get diagnostics v_clubs = row_count;

  select count(*) into v_kept from public.clubs where name like 'TEST %';
  return jsonb_build_object('events', v_events, 'clubs', v_clubs, 'athletes', v_athletes, 'kept_clubs', v_kept);
end;
$$;

revoke execute on function public.clear_test_roster() from public, anon, authenticated;
