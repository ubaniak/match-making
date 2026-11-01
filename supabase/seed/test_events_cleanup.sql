-- Removes everything test_events.sql added: the TEST events (with their days, entries,
-- bouts, weigh-ins and members), the TEST athletes, and the TEST clubs.
-- Paste into the Supabase SQL Editor and run.

begin;

-- Events first: deleting them removes entries and bouts, so the athletes can then be deleted.
delete from public.events where name like 'TEST %';

delete from public.athletes where name like 'TEST %';

delete from public.clubs where name like 'TEST %';

commit;
