-- Test data: two upcoming Active events, 5 clubs, 120 athletes.
--
-- Paste into the Supabase SQL Editor and run. Needs migrations 1-13 (it doesn't touch
-- officials, so 14-16 are optional). Remove everything again with test_events_cleanup.sql.
--
--   TEST One-Day Card    3000-01-01            20 athletes entered
--   TEST Multi-Day Open  3000-01-08 to 01-10   100 athletes entered
--
-- Everything is marked with a "TEST " name prefix. Both events are Active, in
-- America/Winnipeg, owned by the first site Admin, with all 5 clubs accepted.
-- Ages are by birth year as of 3000, so birth dates are in the 2950s-2990s. That spreads
-- athletes over every age group (Fun Box to Masters), both genders, a range of weights and
-- Novice/Open experience, and most have a close opponent from another club.

begin;

do $$
begin
  if exists (select 1 from public.events where name like 'TEST %')
     or exists (select 1 from public.clubs where name like 'TEST %') then
    raise exception 'Test data is already loaded. Run test_events_cleanup.sql first.';
  end if;
  if not exists (select 1 from public.profiles where role_id = 'admin') then
    raise exception 'No site Admin found to own the test events.';
  end if;
end;
$$;

-- Events, owned by the first site Admin
with owner as (
  select id from public.profiles where role_id = 'admin' order by created_at limit 1
), ev as (
  insert into public.events (name, venue, start_date, end_date, timezone, status, status_changed_at)
  values
    ('TEST One-Day Card', 'TEST Venue, Winnipeg', date '3000-01-01', date '3000-01-01', 'America/Winnipeg', 'active', now()),
    ('TEST Multi-Day Open', 'TEST Arena, Winnipeg', date '3000-01-08', date '3000-01-10', 'America/Winnipeg', 'active', now())
  returning id
)
insert into public.event_members (event_id, user_id, role, added_by)
select ev.id, owner.id, 'owner', owner.id from ev, owner;

-- Daily times: weigh-in 08:00-10:00, bouts from 13:00 (and 18:00 on the multi-day event)
insert into public.event_days (event_id, day, weigh_in_start, weigh_in_end)
select e.id, d::date, time '08:00', time '10:00'
from public.events e, generate_series(e.start_date, e.end_date, interval '1 day') d
where e.name in ('TEST One-Day Card', 'TEST Multi-Day Open');

insert into public.event_bout_sessions (event_id, day, starts_at, label)
select d.event_id, d.day, s.starts_at, s.label
from public.event_days d
join public.events e on e.id = d.event_id
cross join (values (time '13:00', 'Afternoon'), (time '18:00', 'Evening')) s(starts_at, label)
where e.name = 'TEST One-Day Card' and s.label = 'Afternoon'
   or e.name = 'TEST Multi-Day Open';

-- Clubs
insert into public.clubs (name, created_by)
select n, null from unnest(array[
  'TEST North End Boxing', 'TEST Riverside BC', 'TEST Prairie Fist',
  'TEST Lakeside Boxing Club', 'TEST Red River Athletics'
]) n;

-- Both events have all 5 clubs in
insert into public.event_clubs (event_id, club_id, status, requested_by, decided_at)
select e.id, c.id, 'accepted', null, now()
from public.events e, public.clubs c
where e.name in ('TEST One-Day Card', 'TEST Multi-Day Open') and c.name like 'TEST %';

-- Athletes (name, birth date, gender, weight kg, bouts, club, event)
create temporary table test_roster (
  name text, date_of_birth date, gender text, weight_kg numeric, bouts int, club text, ev text
) on commit drop;

insert into test_roster values
  ('TEST Dylan Wright', date '2982-11-24', 'male', 80.1, 9, 'TEST North End Boxing', 'one'),
  ('TEST Felix Brown', date '2982-12-07', 'male', 78.5, 8, 'TEST Riverside BC', 'one'),
  ('TEST Owen Cox', date '2965-07-10', 'male', 67.2, 65, 'TEST North End Boxing', 'one'),
  ('TEST Nathan Harris', date '2969-07-08', 'male', 62.1, 59, 'TEST Lakeside Boxing Club', 'one'),
  ('TEST Jamal Stewart', date '2969-03-05', 'male', 63.1, 58, 'TEST Red River Athletics', 'one'),
  ('TEST Mateo Cox', date '2964-10-19', 'male', 73.4, 10, 'TEST Red River Athletics', 'one'),
  ('TEST Aiden Hill', date '2963-11-21', 'male', 71.8, 10, 'TEST North End Boxing', 'one'),
  ('TEST Zoe White', date '2961-02-03', 'female', 56.7, 80, 'TEST Prairie Fist', 'one'),
  ('TEST Ella Stewart', date '2961-10-18', 'female', 56.8, 79, 'TEST Riverside BC', 'one'),
  ('TEST Ava Carter', date '2975-10-21', 'female', 53.7, 0, 'TEST Red River Athletics', 'one'),
  ('TEST Ella Taylor', date '2974-10-18', 'female', 51.5, 0, 'TEST North End Boxing', 'one'),
  ('TEST Andre Morris', date '2987-12-24', 'male', 67.2, 6, 'TEST Prairie Fist', 'one'),
  ('TEST Raj Gray', date '2987-09-01', 'male', 68.9, 4, 'TEST Prairie Fist', 'one'),
  ('TEST Felix Clark', date '2988-11-05', 'male', 32.2, 5, 'TEST Lakeside Boxing Club', 'one'),
  ('TEST Connor Foster', date '2988-07-15', 'male', 32.1, 7, 'TEST Red River Athletics', 'one'),
  ('TEST Kwame Brooks', date '2978-07-23', 'male', 87.0, 1, 'TEST Lakeside Boxing Club', 'one'),
  ('TEST Liam Tremblay', date '2977-07-05', 'male', 85.1, 3, 'TEST Riverside BC', 'one'),
  ('TEST Isla Collins', date '2963-10-16', 'female', 46.2, 5, 'TEST Prairie Fist', 'one'),
  ('TEST Naomi Roberts', date '2964-05-12', 'female', 46.4, 4, 'TEST Lakeside Boxing Club', 'one'),
  ('TEST Aiden Roberts', date '2985-04-23', 'male', 62.9, 13, 'TEST Lakeside Boxing Club', 'one'),
  ('TEST Kai Johnson', date '2987-01-08', 'male', 69.8, 12, 'TEST North End Boxing', 'multi'),
  ('TEST Raj Scott', date '2987-09-01', 'male', 68.2, 11, 'TEST Riverside BC', 'multi'),
  ('TEST Naomi Murphy', date '2955-02-02', 'female', 78.3, 45, 'TEST North End Boxing', 'multi'),
  ('TEST Marcus Wright', date '2953-03-28', 'male', 85.1, 68, 'TEST Lakeside Boxing Club', 'multi'),
  ('TEST Diego Edwards', date '2954-03-16', 'male', 87.2, 65, 'TEST Red River Athletics', 'multi'),
  ('TEST Jamal Roy', date '2977-04-26', 'male', 89.0, 27, 'TEST Prairie Fist', 'multi'),
  ('TEST Diego Ward', date '2991-09-17', 'male', 25.7, 0, 'TEST Riverside BC', 'multi'),
  ('TEST Jamal Adams', date '2992-05-02', 'male', 24.2, 0, 'TEST Prairie Fist', 'multi'),
  ('TEST Hannah Rogers', date '2989-10-02', 'female', 50.7, 3, 'TEST Riverside BC', 'multi'),
  ('TEST Sofia Gagnon', date '2989-06-26', 'female', 48.4, 5, 'TEST Red River Athletics', 'multi'),
  ('TEST Cole Walker', date '2982-01-12', 'male', 73.3, 2, 'TEST North End Boxing', 'multi'),
  ('TEST Mason Thomas', date '2982-03-28', 'male', 71.1, 0, 'TEST Riverside BC', 'multi'),
  ('TEST Raj Parker', date '2983-07-09', 'male', 73.4, 10, 'TEST Prairie Fist', 'multi'),
  ('TEST Eli Peterson', date '2982-01-02', 'male', 71.8, 8, 'TEST North End Boxing', 'multi'),
  ('TEST Lucas Baker', date '2979-04-22', 'male', 86.3, 17, 'TEST Red River Athletics', 'multi'),
  ('TEST Logan Gray', date '2980-12-13', 'male', 85.8, 17, 'TEST North End Boxing', 'multi'),
  ('TEST Chloe Adams', date '2983-10-24', 'female', 63.4, 22, 'TEST Riverside BC', 'multi'),
  ('TEST Emma Edwards', date '2983-03-25', 'female', 62.6, 25, 'TEST Prairie Fist', 'multi'),
  ('TEST Liam Clark', date '2987-04-17', 'male', 41.7, 13, 'TEST Lakeside Boxing Club', 'multi'),
  ('TEST Emma Evans', date '2980-04-26', 'female', 66.3, 10, 'TEST Red River Athletics', 'multi'),
  ('TEST Priya Patel', date '2981-06-17', 'female', 65.7, 10, 'TEST North End Boxing', 'multi'),
  ('TEST Hunter Bailey', date '2986-07-15', 'male', 60.0, 2, 'TEST Prairie Fist', 'multi'),
  ('TEST Wyatt Brooks', date '2986-10-03', 'male', 62.1, 1, 'TEST Riverside BC', 'multi'),
  ('TEST Maya Hall', date '2983-05-14', 'female', 65.2, 20, 'TEST Lakeside Boxing Club', 'multi'),
  ('TEST Maya Morris', date '2983-11-10', 'female', 66.7, 23, 'TEST Red River Athletics', 'multi'),
  ('TEST Owen Roy', date '2989-10-25', 'male', 54.3, 1, 'TEST North End Boxing', 'multi'),
  ('TEST Leo Brooks', date '2972-06-21', 'male', 78.5, 49, 'TEST Riverside BC', 'multi'),
  ('TEST Mateo Patel', date '2972-07-07', 'male', 77.3, 48, 'TEST Red River Athletics', 'multi'),
  ('TEST Aiden Morris', date '2948-03-20', 'male', 71.4, 47, 'TEST Red River Athletics', 'multi'),
  ('TEST Liam Phillips', date '2948-04-12', 'male', 69.1, 48, 'TEST Lakeside Boxing Club', 'multi'),
  ('TEST Logan Lewis', date '2984-11-02', 'male', 76.7, 6, 'TEST North End Boxing', 'multi'),
  ('TEST Arjun Mitchell', date '2971-12-20', 'male', 78.0, 6, 'TEST Riverside BC', 'multi'),
  ('TEST Lucas Roy', date '2987-07-04', 'male', 64.1, 6, 'TEST Prairie Fist', 'multi'),
  ('TEST Kwame Gray', date '2987-09-12', 'male', 63.3, 8, 'TEST Lakeside Boxing Club', 'multi'),
  ('TEST Tyler Morris', date '2992-04-01', 'male', 39.7, 0, 'TEST Red River Athletics', 'multi'),
  ('TEST Sean Young', date '2991-01-24', 'male', 42.2, 2, 'TEST Red River Athletics', 'multi'),
  ('TEST Wyatt Sanders', date '2983-06-03', 'male', 91.1, 3, 'TEST Riverside BC', 'multi'),
  ('TEST Mateo Lewis', date '2983-12-23', 'male', 90.7, 1, 'TEST Riverside BC', 'multi'),
  ('TEST Mateo Walker', date '2986-03-01', 'male', 50.1, 5, 'TEST Lakeside Boxing Club', 'multi'),
  ('TEST Kai Evans', date '2987-02-20', 'male', 52.3, 6, 'TEST Red River Athletics', 'multi'),
  ('TEST Logan Scott', date '2983-02-07', 'male', 58.1, 27, 'TEST Lakeside Boxing Club', 'multi'),
  ('TEST Sean Cox', date '2983-05-06', 'male', 56.8, 25, 'TEST Riverside BC', 'multi'),
  ('TEST Tariq Gagnon', date '2975-03-28', 'male', 72.4, 28, 'TEST Prairie Fist', 'multi'),
  ('TEST Nathan Murphy', date '2975-05-14', 'male', 71.2, 31, 'TEST Lakeside Boxing Club', 'multi'),
  ('TEST Nora Gagnon', date '2984-08-04', 'female', 68.6, 12, 'TEST Red River Athletics', 'multi'),
  ('TEST Sofia Ross', date '2976-03-08', 'female', 56.7, 0, 'TEST Riverside BC', 'multi'),
  ('TEST Mia Anderson', date '2976-04-12', 'female', 57.4, 1, 'TEST Lakeside Boxing Club', 'multi'),
  ('TEST Mason Cox', date '2949-01-24', 'male', 74.0, 2, 'TEST Prairie Fist', 'multi'),
  ('TEST Caleb Harris', date '2987-08-21', 'male', 49.2, 10, 'TEST Lakeside Boxing Club', 'multi'),
  ('TEST Andre Bailey', date '2986-02-28', 'male', 48.4, 9, 'TEST Red River Athletics', 'multi'),
  ('TEST Noah Howard', date '2986-07-13', 'male', 53.4, 0, 'TEST North End Boxing', 'multi'),
  ('TEST Kwame Campbell', date '2986-11-01', 'male', 51.4, 2, 'TEST Riverside BC', 'multi'),
  ('TEST Omar White', date '2988-09-27', 'male', 39.5, 10, 'TEST North End Boxing', 'multi'),
  ('TEST Tariq Patel', date '2988-12-09', 'male', 41.0, 10, 'TEST Lakeside Boxing Club', 'multi'),
  ('TEST Marcus Singh', date '2978-12-15', 'male', 63.0, 8, 'TEST Red River Athletics', 'multi'),
  ('TEST Emma Myers', date '2989-06-28', 'female', 46.0, 5, 'TEST North End Boxing', 'multi'),
  ('TEST Zoe Mitchell', date '2989-06-08', 'female', 47.4, 3, 'TEST Riverside BC', 'multi'),
  ('TEST Sofia Nguyen', date '2983-05-16', 'female', 66.1, 18, 'TEST Prairie Fist', 'multi'),
  ('TEST Mia Parker', date '2983-08-03', 'female', 64.1, 18, 'TEST Lakeside Boxing Club', 'multi'),
  ('TEST Ruby Clark', date '2984-04-14', 'female', 62.7, 1, 'TEST Red River Athletics', 'multi'),
  ('TEST Hannah Roy', date '2984-03-27', 'female', 62.8, 3, 'TEST Red River Athletics', 'multi'),
  ('TEST Hannah Lewis', date '2984-08-22', 'female', 69.3, 5, 'TEST North End Boxing', 'multi'),
  ('TEST Olivia Carter', date '2984-08-22', 'female', 67.2, 4, 'TEST Prairie Fist', 'multi'),
  ('TEST Kai Collins', date '2967-10-03', 'male', 78.2, 28, 'TEST Lakeside Boxing Club', 'multi'),
  ('TEST Hunter James', date '2968-09-17', 'male', 78.5, 30, 'TEST Red River Athletics', 'multi'),
  ('TEST Priya Hughes', date '2961-06-07', 'female', 71.0, 6, 'TEST North End Boxing', 'multi'),
  ('TEST Diego Scott', date '2984-11-02', 'male', 66.9, 0, 'TEST Riverside BC', 'multi'),
  ('TEST Wyatt Hall', date '2984-08-27', 'male', 67.3, 0, 'TEST Prairie Fist', 'multi'),
  ('TEST Kwame Taylor', date '2976-06-09', 'male', 76.1, 7, 'TEST Lakeside Boxing Club', 'multi'),
  ('TEST Raj Anderson', date '2977-09-04', 'male', 74.7, 5, 'TEST Red River Athletics', 'multi'),
  ('TEST Andre Singh', date '2989-10-12', 'male', 34.9, 8, 'TEST North End Boxing', 'multi'),
  ('TEST Noah Tremblay', date '2988-06-14', 'male', 36.6, 7, 'TEST Riverside BC', 'multi'),
  ('TEST Tyler Gray', date '2986-05-01', 'male', 48.7, 5, 'TEST Prairie Fist', 'multi'),
  ('TEST Isaac Ward', date '2986-08-22', 'male', 50.8, 7, 'TEST Lakeside Boxing Club', 'multi'),
  ('TEST Malik Clark', date '2984-08-23', 'male', 57.5, 12, 'TEST Red River Athletics', 'multi'),
  ('TEST Hunter Hall', date '2984-05-23', 'male', 55.2, 13, 'TEST North End Boxing', 'multi'),
  ('TEST Ruby Hall', date '2986-03-17', 'female', 46.1, 9, 'TEST Riverside BC', 'multi'),
  ('TEST Ruby Anderson', date '2984-12-19', 'female', 56.8, 21, 'TEST Prairie Fist', 'multi'),
  ('TEST Hassan Walker', date '2986-12-12', 'male', 67.3, 19, 'TEST Red River Athletics', 'multi'),
  ('TEST Caleb Stewart', date '2988-05-04', 'male', 42.6, 0, 'TEST Red River Athletics', 'multi'),
  ('TEST Diego Morris', date '2976-01-17', 'male', 100.2, 54, 'TEST North End Boxing', 'multi'),
  ('TEST Chloe Harris', date '2983-03-24', 'female', 70.9, 26, 'TEST Lakeside Boxing Club', 'multi'),
  ('TEST Priya Wood', date '2983-07-22', 'female', 70.8, 24, 'TEST Prairie Fist', 'multi'),
  ('TEST Hannah Hughes', date '2982-08-23', 'female', 66.4, 5, 'TEST Riverside BC', 'multi'),
  ('TEST Isla Adams', date '2982-11-01', 'female', 66.0, 5, 'TEST Red River Athletics', 'multi'),
  ('TEST Andre Phillips', date '2983-10-03', 'male', 88.6, 15, 'TEST North End Boxing', 'multi'),
  ('TEST Diego Rogers', date '2982-09-28', 'male', 87.6, 12, 'TEST Riverside BC', 'multi'),
  ('TEST Ethan Ross', date '2990-08-13', 'male', 28.4, 0, 'TEST Riverside BC', 'multi'),
  ('TEST Noah Harris', date '2990-11-24', 'male', 28.9, 0, 'TEST Lakeside Boxing Club', 'multi'),
  ('TEST Raj Collins', date '2987-11-28', 'male', 48.7, 10, 'TEST Lakeside Boxing Club', 'multi'),
  ('TEST Noah Parker', date '2987-07-23', 'male', 47.6, 10, 'TEST North End Boxing', 'multi'),
  ('TEST Mateo Wood', date '2965-11-03', 'male', 64.2, 74, 'TEST Riverside BC', 'multi'),
  ('TEST Cole Murphy', date '2966-08-08', 'male', 64.7, 76, 'TEST Prairie Fist', 'multi'),
  ('TEST Wyatt Watson', date '2983-11-11', 'male', 63.1, 18, 'TEST Red River Athletics', 'multi'),
  ('TEST Olivia Turner', date '2982-08-28', 'female', 46.8, 10, 'TEST Prairie Fist', 'multi'),
  ('TEST Zoe Gray', date '2983-09-22', 'female', 45.8, 10, 'TEST North End Boxing', 'multi'),
  ('TEST Owen Harris', date '2971-12-06', 'male', 65.7, 71, 'TEST Riverside BC', 'multi'),
  ('TEST Andre Edwards', date '2971-09-15', 'male', 68.0, 74, 'TEST North End Boxing', 'multi'),
  ('TEST Marcus Kelly', date '2982-08-10', 'male', 78.2, 10, 'TEST Lakeside Boxing Club', 'multi'),
  ('TEST Nora Roy', date '2991-10-08', 'female', 37.2, 0, 'TEST Red River Athletics', 'multi');

insert into public.athletes (name, date_of_birth, gender, weight_kg, bouts, club_id)
select r.name, r.date_of_birth, r.gender, r.weight_kg, r.bouts, c.id
from test_roster r join public.clubs c on c.name = r.club;

-- Enter them
insert into public.event_athletes (event_id, athlete_id, club_id, added_by)
select e.id, a.id, a.club_id, null
from test_roster r
join public.athletes a on a.name = r.name
join public.events e on e.name = case r.ev when 'one' then 'TEST One-Day Card' else 'TEST Multi-Day Open' end;

-- Quick check: expect 20 and 100
select e.name, count(*) as athletes
from public.event_athletes ea join public.events e on e.id = ea.event_id
where e.name like 'TEST %'
group by e.name;

commit;
