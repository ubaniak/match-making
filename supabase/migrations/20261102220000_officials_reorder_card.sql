-- Migration 29: the Chief Official and Deputy can set the running order too, and saving the order
-- numbers the whole day.
--
-- Bhavek chose 2026-11-02: the event's Owner, Chief Official and Deputy (and the site Admin) can
-- reorder the card at any time while the event is Active, including after the weigh-in starts.
-- The app lets them drag bouts by a handle, use "Move to" or the up/down arrows; each calls this.
--
-- Before, only the bouts sent were numbered, so a bout added by someone else a moment earlier
-- could end up sharing a number. Now every bout that day is renumbered: the ones sent, in the order
-- sent, then any others (including cancelled ones) in their old order.
--
-- The order never touches a bout's approval or sends a notification.
--
-- Run after migration 28 (20261102210000_show_public_bouts.sql).

create or replace function public.set_card_order(p_event_id uuid, p_day date, p_order jsonb) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not coalesce(public.is_site_admin() or public.is_event_owner(p_event_id) or public.is_event_official(p_event_id), false) then
    raise exception 'Only the event''s Owner, Chief Official or Deputy sets the order of the card' using errcode = '42501';
  end if;
  if not public.card_open(p_event_id) then
    raise exception 'The card can change only while the event is Active' using errcode = '22023';
  end if;
  if jsonb_typeof(p_order) is distinct from 'array' then
    raise exception 'The order must be a list of bouts' using errcode = '22023';
  end if;

  with sent as (
    select distinct on (id) id, session_starts_at, n
    from (
      select (item ->> 'id')::uuid as id, nullif(item ->> 'session', '')::time as session_starts_at, n
      from jsonb_array_elements(p_order) with ordinality as t(item, n)
    ) items
    order by id, n
  ),
  numbered as (
    select b.id, s.id is not null as was_sent, s.session_starts_at,
      row_number() over (order by s.n nulls last, b.position, b.made_at) as position
    from public.bouts b
    left join sent s on s.id = b.id
    where b.event_id = p_event_id and b.day = p_day
  )
  update public.bouts b
  set position = numbered.position,
    session_starts_at = case when numbered.was_sent then numbered.session_starts_at else b.session_starts_at end
  from numbered
  where b.id = numbered.id;
end;
$$;

revoke execute on function public.set_card_order(uuid, date, jsonb) from public, anon;
grant execute on function public.set_card_order(uuid, date, jsonb) to authenticated;
