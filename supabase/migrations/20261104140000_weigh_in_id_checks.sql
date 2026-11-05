-- Migration 55: the weigh-in also checks each athlete's date of birth and experience.
--
-- Bhavek (2026-11-04): "During weigh ins the co needs to validate the athletes dob and experience
-- as well as weight."
--
--   * weigh_ins.dob_check and weigh_ins.experience_check: 'verified' (matches the record),
--     'corrected' (the record was wrong and the official typed the right value) or 'unverified'
--     (couldn't be checked, for example no ID). Both are required when the medical is a pass.
--   * A correction fixes the athlete's record (athletes.date_of_birth / athletes.bouts), and the
--     weigh-in keeps the old value in dob_before / bouts_before so everyone can see what changed.
--   * "Couldn't check" marks the athlete's bouts that day "Needs discussion" (like a failed
--     medical). The app also flags a bout when a correction changes the athlete's age group or
--     Novice/Open, or breaks the match rules (the rules live in app/src/matching.js).
--   * Who can record it is unchanged: the CO and Deputy every day, other officials on the days
--     they accepted.
--
-- Run after migration 54 (20261104130000_event_location_required.sql, PR #101).

alter table public.weigh_ins
  add column dob_check text check (dob_check in ('verified', 'corrected', 'unverified')),
  add column dob_before date,
  add column experience_check text check (experience_check in ('verified', 'corrected', 'unverified')),
  add column bouts_before integer check (bouts_before is null or bouts_before >= 0);

drop function public.record_weigh_in(uuid, date, uuid, numeric, text, text);

create function public.record_weigh_in(
  p_event_id uuid, p_day date, p_athlete_id uuid, p_weight_kg numeric, p_medical text, p_note text default null,
  p_dob_check text default null, p_dob date default null, p_experience_check text default null, p_bouts integer default null
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_name text;
  v_athlete public.athletes;
  v_dob_before date;
  v_bouts_before integer;
begin
  if not public.can_weigh_in(p_event_id, p_day) then
    raise exception 'Only the event''s officials record the weigh-in, on the days they officiate' using errcode = '42501';
  end if;
  if not public.card_open(p_event_id) then
    raise exception 'The weigh-in can be recorded only while the event is Active' using errcode = '22023';
  end if;
  if not exists (select 1 from public.event_athletes where event_id = p_event_id and athlete_id = p_athlete_id) then
    raise exception 'That athlete isn''t entered in the event' using errcode = '23514';
  end if;
  if not exists (select 1 from public.events where id = p_event_id and p_day between start_date and end_date) then
    raise exception 'Pick a day of the event' using errcode = '22023';
  end if;
  if p_medical not in ('pass', 'fail', 'absent') then
    raise exception 'The medical is a pass, a fail or a no-show' using errcode = '22023';
  end if;
  if p_medical = 'pass' and p_weight_kg is null then
    raise exception 'Enter the athlete''s weight' using errcode = '22023';
  end if;
  if p_medical = 'absent' then
    -- Nobody to check.
    p_dob_check := null;
    p_experience_check := null;
  end if;
  if p_dob_check is not null and p_dob_check not in ('verified', 'corrected', 'unverified')
     or p_experience_check is not null and p_experience_check not in ('verified', 'corrected', 'unverified') then
    raise exception 'Each check is checked, corrected or couldn''t check' using errcode = '22023';
  end if;
  if p_medical = 'pass' and (p_dob_check is null or p_experience_check is null) then
    raise exception 'Check the athlete''s date of birth and experience' using errcode = '22023';
  end if;
  if p_dob_check = 'corrected' and (p_dob is null or p_dob > current_date or p_dob < date '1920-01-01') then
    raise exception 'Enter the athlete''s correct date of birth' using errcode = '22023';
  end if;
  if p_experience_check = 'corrected' and (p_bouts is null or p_bouts < 0 or p_bouts > 1000) then
    raise exception 'Enter the athlete''s correct number of bouts' using errcode = '22023';
  end if;

  select * into v_athlete from public.athletes where id = p_athlete_id for update;
  select dob_before, bouts_before into v_dob_before, v_bouts_before
  from public.weigh_ins where event_id = p_event_id and day = p_day and athlete_id = p_athlete_id;

  -- A correction fixes the record. Saving the same correction again keeps the first "before" value.
  if p_dob_check = 'corrected' then
    if v_athlete.date_of_birth is distinct from p_dob then
      v_dob_before := v_athlete.date_of_birth;
      update public.athletes set date_of_birth = p_dob where id = p_athlete_id;
    end if;
  else
    v_dob_before := null;
  end if;
  if p_experience_check = 'corrected' then
    if v_athlete.bouts is distinct from p_bouts then
      v_bouts_before := v_athlete.bouts;
      update public.athletes set bouts = p_bouts where id = p_athlete_id;
    end if;
  else
    v_bouts_before := null;
  end if;

  insert into public.weigh_ins (event_id, day, athlete_id, weight_kg, medical, note, dob_check, dob_before, experience_check, bouts_before)
  values (p_event_id, p_day, p_athlete_id, p_weight_kg, p_medical, nullif(trim(p_note), ''), p_dob_check, v_dob_before, p_experience_check, v_bouts_before)
  on conflict (event_id, day, athlete_id) do update
    set weight_kg = excluded.weight_kg, medical = excluded.medical, note = excluded.note,
        dob_check = excluded.dob_check, dob_before = excluded.dob_before,
        experience_check = excluded.experience_check, bouts_before = excluded.bouts_before,
        recorded_by = auth.uid(), recorded_at = now();

  v_name := coalesce(public.athlete_name(p_athlete_id), 'A boxer');
  if p_medical = 'fail' then
    perform public.flag_athlete_bouts(p_event_id, p_athlete_id, p_day, v_name || ' failed the medical.');
  elsif p_medical = 'absent' then
    perform public.flag_athlete_bouts(p_event_id, p_athlete_id, p_day, v_name || ' didn''t come to the weigh-in.');
  end if;
  if p_dob_check = 'unverified' then
    perform public.flag_athlete_bouts(p_event_id, p_athlete_id, p_day, v_name || '''s date of birth couldn''t be checked.');
  end if;
  if p_experience_check = 'unverified' then
    perform public.flag_athlete_bouts(p_event_id, p_athlete_id, p_day, v_name || '''s experience couldn''t be checked.');
  end if;
end;
$$;

revoke execute on function public.record_weigh_in(uuid, date, uuid, numeric, text, text, text, date, text, integer) from public, anon;
grant execute on function public.record_weigh_in(uuid, date, uuid, numeric, text, text, text, date, text, integer) to authenticated;
