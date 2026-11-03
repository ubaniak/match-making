-- Migration 34: a failed weigh-in flags the bout for discussion instead of cancelling it.
--
-- Bhavek (2026-11-03): "Failed medical or weight mismatch should not automatically cancel the bout.
-- It should mark the bout for discussion, and the official in charge must cancel it. Also, allow
-- both opponents to weigh in and be processed if one fails."
--
--   * record_weigh_in no longer cancels bouts. A failed medical or a no-show sets
--     bouts.review_reason on the athlete's open bouts that day ("Needs discussion").
--   * flag_bout_for_review: whoever records the weigh-in flags a bout that no longer fits the
--     match rules after the new weight (the rules live in the app, app/src/matching.js).
--   * Only the Chief Official or Deputy (or a site Admin) settles a flagged bout: keep it
--     (clear_bout_review) or cancel it (cancel_bout). No result can be recorded while it's flagged.
--   * Re-matching a bout to a different boxer clears the flag (swapping corners doesn't).
--   * The Chief Official and Deputy get a "Discuss bout" to-do (action_key 'review:<bout id>'),
--     done when the bout is kept or cancelled.
--
-- Run after migration 33 (20261103010000_helper_demo_accounts.sql).

alter table public.bouts
  add column review_reason text check (review_reason is null or length(review_reason) <= 600),
  add column review_at timestamptz;

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'availability', 'invitation_answer', 'official_role',
  'bout_approval', 'bout_decision', 'bout_cancelled', 'bout_comment', 'bout_review',
  'join_request', 'join_answer', 'late_entry', 'late_entry_answer',
  'transfer', 'transfer_answer', 'member_request', 'member_answer',
  'event_role', 'event_status'
));

-- ---------------------------------------------------------------------------
-- Flagging (internal helpers)
-- ---------------------------------------------------------------------------

-- Adds a reason to a bout's flag, once.
create function public.add_review_reason(p_current text, p_reason text) returns text
language sql immutable
as $$
  select case
    when p_current is null then p_reason
    when position(p_reason in p_current) > 0 then p_current
    else left(p_current || ' ' || p_reason, 600)
  end
$$;

-- Flags an athlete's open bouts (no result, not cancelled) on a day.
create function public.flag_athlete_bouts(p_event_id uuid, p_athlete_id uuid, p_day date, p_reason text) returns void
language sql security definer set search_path = public
as $$
  update public.bouts
  set review_reason = public.add_review_reason(review_reason, p_reason), review_at = now()
  where event_id = p_event_id and day = p_day and status <> 'cancelled' and winner is null
    and p_athlete_id in (red_athlete_id, blue_athlete_id)
$$;

-- ---------------------------------------------------------------------------
-- Weigh-in: flag, don't cancel
-- ---------------------------------------------------------------------------

create or replace function public.record_weigh_in(
  p_event_id uuid, p_day date, p_athlete_id uuid, p_weight_kg numeric, p_medical text, p_note text default null
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_name text;
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
  insert into public.weigh_ins (event_id, day, athlete_id, weight_kg, medical, note)
  values (p_event_id, p_day, p_athlete_id, p_weight_kg, p_medical, nullif(trim(p_note), ''))
  on conflict (event_id, day, athlete_id) do update
    set weight_kg = excluded.weight_kg, medical = excluded.medical, note = excluded.note,
        recorded_by = auth.uid(), recorded_at = now();
  v_name := coalesce(public.athlete_name(p_athlete_id), 'A boxer');
  if p_medical = 'fail' then
    perform public.flag_athlete_bouts(p_event_id, p_athlete_id, p_day, v_name || ' failed the medical.');
  elsif p_medical = 'absent' then
    perform public.flag_athlete_bouts(p_event_id, p_athlete_id, p_day, v_name || ' didn''t come to the weigh-in.');
  end if;
end;
$$;

-- Whoever records the weigh-in flags a bout that no longer fits after it.
create function public.flag_bout_for_review(p_bout_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_bout public.bouts;
begin
  select * into v_bout from public.bouts where id = p_bout_id for update;
  if not found then
    raise exception 'That bout no longer exists' using errcode = 'P0002';
  end if;
  if not public.can_weigh_in(v_bout.event_id, v_bout.day) then
    raise exception 'Only the event''s officials flag bouts at the weigh-in' using errcode = '42501';
  end if;
  if nullif(trim(p_reason), '') is null then
    raise exception 'Say why this bout needs discussing' using errcode = '22023';
  end if;
  if v_bout.status = 'cancelled' or v_bout.winner is not null then
    return;
  end if;
  update public.bouts
  set review_reason = public.add_review_reason(review_reason, left(trim(p_reason), 300)), review_at = now()
  where id = p_bout_id;
end;
$$;

-- The Chief Official or Deputy keeps a flagged bout on the card.
create function public.clear_bout_review(p_bout_id uuid) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_bout public.bouts;
begin
  select * into v_bout from public.bouts where id = p_bout_id for update;
  if not found then
    raise exception 'That bout no longer exists' using errcode = 'P0002';
  end if;
  if not public.is_event_official(v_bout.event_id) then
    raise exception 'Only the Chief Official or Deputy decides on a bout that needs discussing' using errcode = '42501';
  end if;
  update public.bouts set review_reason = null, review_at = null where id = p_bout_id;
end;
$$;

-- Only the Chief Official or Deputy cancels a flagged bout.
create or replace function public.cancel_bout(p_bout_id uuid, p_reason text default null) returns void
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
    raise exception 'Only the event''s Owner (before the weigh-in) or officials can cancel bouts' using errcode = '42501';
  end if;
  if v_bout.review_reason is not null and not public.is_event_official(v_bout.event_id) then
    raise exception 'Only the Chief Official or Deputy cancels a bout that needs discussing' using errcode = '42501';
  end if;
  if v_bout.winner is not null then
    raise exception 'This bout has a result, so it can''t be cancelled' using errcode = '22023';
  end if;
  update public.bouts set status = 'cancelled', cancel_reason = nullif(trim(p_reason), ''), cancelled_at = now()
  where id = p_bout_id;
end;
$$;

-- No result on a bout that still needs discussing.
create or replace function public.record_result(p_bout_id uuid, p_winner text, p_method text, p_note text default null) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_bout public.bouts;
begin
  select * into v_bout from public.bouts where id = p_bout_id for update;
  if not found then
    raise exception 'That bout no longer exists' using errcode = 'P0002';
  end if;
  if not public.is_event_official(v_bout.event_id) then
    raise exception 'Only the Chief Official or Deputy records results' using errcode = '42501';
  end if;
  if not public.card_open(v_bout.event_id) and not public.is_site_admin() then
    raise exception 'Results can be recorded only while the event is Active' using errcode = '22023';
  end if;
  if v_bout.status <> 'approved' then
    raise exception 'Only approved bouts get a result' using errcode = '22023';
  end if;
  if v_bout.review_reason is not null then
    raise exception 'This bout needs discussing first: keep it or cancel it' using errcode = '22023';
  end if;
  if p_winner not in ('red', 'blue') or p_method not in ('points', 'rsc', 'ko', 'walkover', 'dq', 'abd') then
    raise exception 'Pick the winner and how they won' using errcode = '22023';
  end if;
  if v_bout.winner is null then
    update public.athletes set bouts = coalesce(bouts, 0) + 1 where id in (v_bout.red_athlete_id, v_bout.blue_athlete_id);
  end if;
  update public.bouts
  set winner = p_winner, method = p_method, result_note = nullif(trim(p_note), ''), result_by = auth.uid(), result_at = now()
  where id = p_bout_id;
end;
$$;

-- Re-matched to a different boxer: the flag no longer applies. (Swapping corners keeps it.)
create function public.clear_review_on_rematch() returns trigger
language plpgsql
as $$
begin
  if (new.red_athlete_id, new.blue_athlete_id) is distinct from (old.red_athlete_id, old.blue_athlete_id)
     and (new.red_athlete_id, new.blue_athlete_id) is distinct from (old.blue_athlete_id, old.red_athlete_id) then
    new.review_reason := null;
    new.review_at := null;
  end if;
  return new;
end;
$$;

create trigger bouts_clear_review_on_rematch
  before update of red_athlete_id, blue_athlete_id on public.bouts
  for each row execute function public.clear_review_on_rematch();

-- ---------------------------------------------------------------------------
-- Notifications: a "Discuss bout" to-do for the Chief Official and Deputy
-- ---------------------------------------------------------------------------

create function public.notify_bout_review() returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_key text := 'review:' || new.id;
begin
  if new.status = 'cancelled' or new.winner is not null or new.review_reason is null then
    perform public.resolve_notifications(v_key);
  elsif new.review_reason is distinct from old.review_reason then
    -- A new reason replaces the open to-do, so nobody ends up with two.
    delete from public.notifications where action_key = v_key and done_at is null;
    perform public.add_notification(
      public.event_official_ids(new.event_id), 'bout_review', 'Discuss bout: ' || public.bout_label(new),
      public.bout_where(new) || ' · ' || new.review_reason, new.event_id, null, new.id, 'bouts', v_key);
  end if;
  return new;
end;
$$;

create trigger bouts_notify_review
  after update on public.bouts
  for each row when (old.review_reason is distinct from new.review_reason or old.status is distinct from new.status)
  execute function public.notify_bout_review();

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke execute on function public.flag_athlete_bouts(uuid, uuid, date, text) from public, anon, authenticated;
revoke execute on function public.clear_review_on_rematch() from public, anon, authenticated;
revoke execute on function public.notify_bout_review() from public, anon, authenticated;
revoke execute on function public.flag_bout_for_review(uuid, text) from public, anon;
grant execute on function public.flag_bout_for_review(uuid, text) to authenticated;
revoke execute on function public.clear_bout_review(uuid) from public, anon;
grant execute on function public.clear_bout_review(uuid) to authenticated;
