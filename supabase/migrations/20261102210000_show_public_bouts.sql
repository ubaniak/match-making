-- Migration 28: the event's Owner (or a site Admin) chooses whether the public page shows the
-- approved bout list. Hidden by default. Run after migration 27.
--
--   * events.show_public_bouts: false for every event, new and existing, until switched on.
--   * Only people who can edit the event change it: the existing "owners edit events" update
--     policy (can_edit_event: site Admin, or the Owner while the event is Requested or Active).
--   * list_public_events() returns an empty 'bouts' list unless the switch is on, so a
--     signed-out visitor can't see the bouts by calling the function directly.

alter table public.events add column if not exists show_public_bouts boolean not null default false;

comment on column public.events.show_public_bouts is
  'Show the approved bout list on the public Upcoming events page. Owner or site Admin sets it.';

create or replace function public.list_public_events() returns jsonb
language sql stable security definer set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', e.id,
    'name', e.name,
    'venue', e.venue,
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
