-- Sparring bouts need no weigh-in (Bhavek, 2026-11-05). A failed medical, a no-show or an ID check
-- that couldn't be done no longer marks a Sparring bout "Needs discussion"; only Scored and
-- Developmental bouts are flagged. The app also stops listing athletes who box only in Sparring
-- bouts on the Weigh-ins tab. Run after 20261105020000_club_requests.sql, before deploying.

create or replace function public.flag_athlete_bouts(p_event_id uuid, p_athlete_id uuid, p_day date, p_reason text) returns void
language sql security definer set search_path = public
as $$
  update public.bouts
  set review_reason = public.add_review_reason(review_reason, p_reason), review_at = now()
  where event_id = p_event_id and day = p_day and status <> 'cancelled' and winner is null
    and bout_type <> 'sparring'
    and p_athlete_id in (red_athlete_id, blue_athlete_id)
$$;
revoke execute on function public.flag_athlete_bouts(uuid, uuid, date, text) from public, anon, authenticated;

-- Clear weigh-in flags already on open Sparring bouts.
update public.bouts
set review_reason = null, review_at = null
where bout_type = 'sparring' and review_reason is not null and winner is null and status <> 'cancelled';
