-- Migration 11: "today" means today in Winnipeg, not in UTC.
--
-- Postgres on Supabase runs in UTC, so current_date flips to tomorrow at 7 PM Winnipeg time
-- (6 PM in winter). Events then vanished from the public page, stopped taking entries and
-- were closed early on the evening of their own last day.
--
-- Every function that compares dates with current_date now runs with the Winnipeg time zone.
-- A SET clause on a function applies on every call, whatever the connection's own setting.
-- If a later migration replaces one of these functions, it must keep
-- `set timezone = 'America/Winnipeg'`, because create or replace drops it.

alter function public.can_edit_event(uuid) set timezone = 'America/Winnipeg';
alter function public.event_is_open(uuid) set timezone = 'America/Winnipeg';
alter function public.close_finished_events() set timezone = 'America/Winnipeg';
alter function public.list_public_events() set timezone = 'America/Winnipeg';
alter function public.athlete_in_open_event(uuid) set timezone = 'America/Winnipeg';
alter function public.entries_open(uuid) set timezone = 'America/Winnipeg';
alter function public.remove_event_club(uuid, uuid) set timezone = 'America/Winnipeg';
alter function public.withdraw_athlete(uuid, uuid) set timezone = 'America/Winnipeg';

-- Also make Winnipeg the database default, so new code and SQL editor queries agree.
do $$
begin
  execute format('alter database %I set timezone to %L', current_database(), 'America/Winnipeg');
exception when insufficient_privilege then
  raise notice 'Could not change the database time zone; the functions above still use Winnipeg time.';
end $$;

-- The nightly Done job ran at 08:05 UTC; 08:05 UTC is 2:05 or 3:05 AM in Winnipeg, which is
-- already after midnight there all year, so its schedule stays as it is.
