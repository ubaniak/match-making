-- Migration 43 (Bhavek, 2026-11-04): "can you set it up so that the CO and deputy can set the min
-- number of officials. the min is 5"
--
--   * events.min_officials: how many accepted officials the event needs. Starts at 5.
--   * An Active event with fewer accepted officials than this shows red on Home and on the event's
--     Dashboard tab.
--   * The event's Chief Official and Deputy set it on the Officials tab. The event's Owner and site
--     Admins can too.
--
-- Run after migration 42.

alter table public.events
  add column min_officials integer not null default 5
  constraint events_min_officials_range check (min_officials between 1 and 100);

create or replace function public.set_min_officials(p_event_id uuid, p_min integer)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not (public.is_owner_or_admin(p_event_id) or public.event_official_role(p_event_id) in ('chief', 'deputy')) then
    raise exception 'Only the Chief Official, the Deputy, the event''s Owner or a site Admin can set the minimum number of officials'
      using errcode = '42501';
  end if;
  if p_min is null or p_min < 1 or p_min > 100 then
    raise exception 'The minimum number of officials must be between 1 and 100' using errcode = '22023';
  end if;
  update public.events set min_officials = p_min where id = p_event_id;
end;
$$;

revoke all on function public.set_min_officials(uuid, integer) from public;
grant execute on function public.set_min_officials(uuid, integer) to authenticated;
