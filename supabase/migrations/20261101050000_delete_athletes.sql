-- Migration 13: deleting athletes.
--
-- Club Owners and site Admins could already delete athletes (the "remove athletes" policy),
-- but the app had no button for it. Now it does, with two guards so nothing is lost:
--   * an athlete entered in an Active event can't be deleted (withdraw them first, or wait
--     until the event is Done);
--   * an athlete with a recorded result stays on record, because deleting them would delete
--     their bouts and their opponents' results too.

create function public.check_athlete_delete() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if public.athlete_in_open_event(old.id) then
    raise exception 'This athlete is entered in an Active event. Withdraw them first, or wait until the event is Done.' using errcode = '23514';
  end if;
  if exists (
    select 1 from public.bouts
    where winner is not null and old.id in (red_athlete_id, blue_athlete_id)
  ) then
    raise exception 'This athlete has bout results on record, so they can''t be deleted.' using errcode = '23514';
  end if;
  return old;
end;
$$;

create trigger check_athlete_delete before delete on public.athletes
  for each row execute function public.check_athlete_delete();
