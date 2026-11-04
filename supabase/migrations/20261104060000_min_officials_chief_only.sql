-- Migration 47 (Bhavek, 2026-11-04): "the site CO picks the min number of officials"
--
-- Only the event's Chief Officials (both seats; the second is stored as 'deputy') can change
-- events.min_officials. The event's Owner and site Admins still see it but can no longer change it.
--
-- Run after migration 46.

create or replace function public.set_min_officials(p_event_id uuid, p_min integer)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if coalesce(public.event_official_role(p_event_id), '') not in ('chief', 'deputy') then
    raise exception 'Only the event''s Chief Official can set the minimum number of officials'
      using errcode = '42501';
  end if;
  if p_min is null or p_min < 1 or p_min > 100 then
    raise exception 'The minimum number of officials must be between 1 and 100' using errcode = '22023';
  end if;
  update public.events set min_officials = p_min where id = p_event_id;
end;
$$;
