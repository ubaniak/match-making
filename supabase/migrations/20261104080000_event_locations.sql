-- Migration 49: event locations on Google Maps, and a weigh-in location. Run after migration 48
-- (20261104070000_min_officials_chief_only.sql).
--
--   * The bout location keeps its name in events.venue and gains the address Google gives, the map
--     pin (latitude and longitude) and Google's place id.
--   * A separate weigh-in location (weigh_in_venue and friends). Empty means the weigh-ins are at
--     the bout location, which is the default for every event, new and existing.
--   * Only people who can edit the event change them: the existing update policy on events
--     (can_edit_event: site Admin, or the Owner while the event is Requested or Active).
--   * list_public_events() also returns both locations, so the public page can show the map.

alter table public.events
  add column if not exists venue_address text,
  add column if not exists venue_lat double precision,
  add column if not exists venue_lng double precision,
  add column if not exists venue_place_id text,
  add column if not exists weigh_in_venue text,
  add column if not exists weigh_in_address text,
  add column if not exists weigh_in_lat double precision,
  add column if not exists weigh_in_lng double precision,
  add column if not exists weigh_in_place_id text;

alter table public.events drop constraint if exists events_venue_pin_check;
alter table public.events add constraint events_venue_pin_check check (
  (venue_lat is null and venue_lng is null)
  or (venue_lat between -90 and 90 and venue_lng between -180 and 180)
);

alter table public.events drop constraint if exists events_weigh_in_pin_check;
alter table public.events add constraint events_weigh_in_pin_check check (
  (weigh_in_lat is null and weigh_in_lng is null)
  or (weigh_in_lat between -90 and 90 and weigh_in_lng between -180 and 180)
);

comment on column public.events.venue_address is 'Formatted address of the bout location, from Google Maps.';
comment on column public.events.venue_lat is 'Map pin for the bout location (latitude).';
comment on column public.events.venue_lng is 'Map pin for the bout location (longitude).';
comment on column public.events.venue_place_id is 'Google Maps place id of the bout location, if picked from the search.';
comment on column public.events.weigh_in_venue is
  'Name of the weigh-in location. Empty means the weigh-ins are at the bout location (events.venue).';

create or replace function public.list_public_events() returns jsonb
language sql stable security definer set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', e.id,
    'name', e.name,
    'venue', e.venue,
    'venue_address', e.venue_address,
    'venue_lat', e.venue_lat,
    'venue_lng', e.venue_lng,
    'venue_place_id', e.venue_place_id,
    'weigh_in_venue', e.weigh_in_venue,
    'weigh_in_address', e.weigh_in_address,
    'weigh_in_lat', e.weigh_in_lat,
    'weigh_in_lng', e.weigh_in_lng,
    'weigh_in_place_id', e.weigh_in_place_id,
    'start_date', e.start_date,
    'end_date', e.end_date,
    'timezone', e.timezone,
    'poster_path', e.poster_path,
    'days', coalesce((
      select jsonb_agg(jsonb_build_object(
        'day', d.day,
        'weigh_in_start', to_char(d.weigh_in_start, 'HH24:MI'),
        'weigh_in_end', to_char(d.weigh_in_end, 'HH24:MI'),
        'sessions', coalesce((
          select jsonb_agg(jsonb_build_object('starts_at', to_char(s.starts_at, 'HH24:MI'), 'label', s.label) order by s.starts_at)
          from public.event_bout_sessions s where s.event_id = d.event_id and s.day = d.day
        ), '[]')
      ) order by d.day)
      from public.event_days d where d.event_id = e.id
    ), '[]'),
    'bouts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', b.id,
        'day', b.day,
        'number', b.number,
        'session_starts_at', to_char(b.session_starts_at, 'HH24:MI'),
        'session_label', s.label,
        'red', jsonb_build_object('name', ra.name, 'club', rc.name, 'categories', public.public_categories(ra, e.start_date)),
        'blue', jsonb_build_object('name', ba.name, 'club', bc.name, 'categories', public.public_categories(ba, e.start_date))
      ) order by b.day, b.number)
      from (
        select lb.*, row_number() over (partition by lb.day order by lb.position, lb.made_at) as number
        from public.bouts lb
        where lb.event_id = e.id and lb.status <> 'cancelled'
      ) b
      join public.athletes ra on ra.id = b.red_athlete_id
      join public.athletes ba on ba.id = b.blue_athlete_id
      left join public.clubs rc on rc.id = b.red_club_id
      left join public.clubs bc on bc.id = b.blue_club_id
      left join public.event_bout_sessions s on s.event_id = b.event_id and s.day = b.day and s.starts_at = b.session_starts_at
      where b.status = 'approved' and e.show_public_bouts
    ), '[]')
  ) order by e.start_date, e.name), '[]')
  from public.events e
  where e.status = 'active' and e.end_date >= public.local_today(e.timezone)
$$;

grant execute on function public.list_public_events() to anon, authenticated;
