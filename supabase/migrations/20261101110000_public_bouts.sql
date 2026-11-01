-- Migration 19: the public Upcoming events page lists each event's approved bouts.
--
--   * list_public_events() gains a 'bouts' array per event: only bouts whose status is
--     'approved' (both corners and an official said yes), in card order, by day.
--   * Each corner shows the boxer's name, club and categories (age group, gender,
--     Novice/Open). Never weight, birthdate or anything else about the athlete.
--   * Bout numbers match the full card for that day (cancelled bouts don't count), so a
--     number can jump where an unapproved bout sits between approved ones.
--   * The bouts and athletes tables stay closed to signed-out visitors; this security
--     definer function is the only way in, and it returns approved bouts only.

-- Age group by calendar year of birth, as app/src/categories.js does.
create or replace function public.public_age_group(p_dob date, p_event_date date) returns text
language sql immutable set search_path = public
as $$
  select case
    when p_dob is null then null
    when a < 6 then 'Too young'
    when a <= 10 then 'Fun Box'
    when a <= 12 then 'U13'
    when a <= 14 then 'U15'
    when a <= 16 then 'U17'
    when a <= 18 then 'U19'
    when a <= 39 then 'Elite'
    else 'Masters'
  end
  from (select extract(year from p_event_date)::int - extract(year from p_dob)::int as a) x
$$;

create or replace function public.public_categories(p_athlete public.athletes, p_event_date date) returns text
language sql stable set search_path = public
as $$
  select nullif(concat_ws(' · ',
    public.public_age_group(p_athlete.date_of_birth, p_event_date),
    case p_athlete.gender when 'male' then 'Male' when 'female' then 'Female' end,
    case when p_athlete.bouts is null then null when p_athlete.bouts <= 10 then 'Novice' else 'Open' end
  ), '')
$$;

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
      where b.status = 'approved'
    ), '[]')
  ) order by e.start_date, e.name), '[]')
  from public.events e
  where e.status = 'active' and e.end_date >= public.local_today(e.timezone)
$$;

grant execute on function public.list_public_events() to anon, authenticated;
