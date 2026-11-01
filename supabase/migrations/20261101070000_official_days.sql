-- Migration 15 (Bhavek, 2026-11-01):
--   * The Chief Official and Deputy also see who accepted, declined or hasn't answered an
--     event's officials invitations. Inviting, re-inviting and removing stay with the Owner
--     and site Admins.
--   * On a multi-day event an official accepts for the days they can work: one day, some days
--     or the whole event. They can change their days until the event's first day. An official
--     records the weigh-in only on their own days (the CO and Deputy on every day).
--
-- Officials who already accepted are kept on every day of their event.

-- ---------------------------------------------------------------------------
-- Days
-- ---------------------------------------------------------------------------

alter table public.official_invitations add column days date[];

update public.official_invitations i
set days = (select array_agg(d::date order by d) from public.events e, generate_series(e.start_date, e.end_date, interval '1 day') d where e.id = i.event_id)
where i.status = 'accepted';

-- The days the signed-in user accepted to officiate (empty if none).
create function public.my_official_days(p_event_id uuid) returns date[]
language sql stable security definer set search_path = public
as $$
  select coalesce((
    select i.days from public.official_invitations i
    join public.officials o on o.id = i.official_id
    join public.profiles p on p.id = o.user_id and p.status = 'active'
    where i.event_id = p_event_id and i.status = 'accepted' and o.user_id = auth.uid()
  ), '{}')
$$;

-- ---------------------------------------------------------------------------
-- Who sees the lists
-- ---------------------------------------------------------------------------

-- Owner, site Admin, Chief Official or Deputy.
create function public.can_see_official_lists(p_event_id uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select public.is_owner_or_admin(p_event_id) or public.event_official_role(p_event_id) is not null
$$;

drop function public.list_event_invitations(uuid);
create function public.list_event_invitations(p_event_id uuid)
returns table (
  id uuid, official_id uuid, name text, email text, user_id uuid, status text, respond_by date,
  invited_at timestamptz, responded_at timestamptz, days date[]
)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.can_see_official_lists(p_event_id) then
    return;
  end if;
  return query
    select i.id, i.official_id, o.name, o.invite_email, o.user_id, i.status, i.respond_by, i.invited_at, i.responded_at, i.days
    from public.official_invitations i
    join public.officials o on o.id = i.official_id
    where i.event_id = p_event_id
    order by o.name;
end;
$$;

drop policy "read official invitations" on public.official_invitations;
create policy "read official invitations" on public.official_invitations for select to authenticated
  using (
    public.can_see_official_lists(event_id)
    or exists (select 1 from public.officials o where o.id = official_id and o.user_id = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- Answering with days
-- ---------------------------------------------------------------------------

drop function public.list_my_invitations();
create function public.list_my_invitations()
returns table (
  id uuid, event_id uuid, event_name text, venue text, start_date date, end_date date, timezone text,
  event_status text, status text, respond_by date, invited_at timestamptz, responded_at timestamptz, days date[]
)
language sql stable security definer set search_path = public
as $$
  select i.id, e.id, e.name, e.venue, e.start_date, e.end_date, e.timezone, e.status,
    i.status, i.respond_by, i.invited_at, i.responded_at, i.days
  from public.official_invitations i
  join public.officials o on o.id = i.official_id
  join public.events e on e.id = i.event_id
  where o.user_id = auth.uid()
  order by e.start_date desc, e.name
$$;

-- Accept (for p_days, or every day when null) or decline. Accepting again changes the days.
drop function public.respond_to_invitation(uuid, boolean);
create function public.respond_to_invitation(p_invitation_id uuid, p_accept boolean, p_days date[] default null) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_inv public.official_invitations;
  v_event public.events;
  v_user uuid;
  v_days date[];
begin
  select * into v_inv from public.official_invitations where id = p_invitation_id;
  if not found then
    raise exception 'That invitation has been cancelled' using errcode = 'P0002';
  end if;
  select user_id into v_user from public.officials where id = v_inv.official_id;
  if v_user is null or v_user <> auth.uid() then
    raise exception 'Only the invited official can answer this invitation' using errcode = '42501';
  end if;
  select * into v_event from public.events where id = v_inv.event_id;
  if v_event.status <> 'active' or public.local_today(v_event.timezone) >= v_event.start_date then
    raise exception 'Answers are locked once the event starts. Contact the event''s Owner.' using errcode = '22023';
  end if;
  if v_inv.status = 'pending' and v_inv.respond_by is not null
     and public.local_today(v_event.timezone) > v_inv.respond_by then
    raise exception 'The respond-by date has passed. Ask the event''s Owner to invite you again.' using errcode = '22023';
  end if;

  if p_accept then
    select array_agg(distinct d order by d) into v_days
    from unnest(coalesce(p_days, (
      select array_agg(g::date) from generate_series(v_event.start_date, v_event.end_date, interval '1 day') g
    ))) d;
    if v_days is null then
      raise exception 'Pick at least one day you can officiate' using errcode = '22023';
    end if;
    if exists (select 1 from unnest(v_days) d where d < v_event.start_date or d > v_event.end_date) then
      raise exception 'Pick days of the event' using errcode = '22023';
    end if;
  end if;

  update public.official_invitations
  set status = case when p_accept then 'accepted' else 'declined' end,
      days = case when p_accept then v_days else null end,
      responded_at = now()
  where id = p_invitation_id;

  if not p_accept then
    delete from public.event_officials where event_id = v_inv.event_id and user_id = v_user;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- The weigh-in: officials record it only on their own days
-- ---------------------------------------------------------------------------

drop function public.can_weigh_in(uuid);
create function public.can_weigh_in(p_event_id uuid, p_day date) returns boolean
language sql stable security definer set search_path = public
as $$
  select public.is_event_official(p_event_id) or p_day = any (public.my_official_days(p_event_id))
$$;

create or replace function public.record_weigh_in(
  p_event_id uuid, p_day date, p_athlete_id uuid, p_weight_kg numeric, p_medical text, p_note text default null
) returns void
language plpgsql security definer set search_path = public
as $$
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
  if p_medical = 'fail' then
    perform public.cancel_athlete_bouts(p_event_id, p_athlete_id, p_day, 'Failed the medical');
  elsif p_medical = 'absent' then
    perform public.cancel_athlete_bouts(p_event_id, p_athlete_id, p_day, 'Didn''t come to the weigh-in');
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke execute on function public.list_event_invitations(uuid) from public, anon;
grant execute on function public.list_event_invitations(uuid) to authenticated;
revoke execute on function public.list_my_invitations() from public, anon;
grant execute on function public.list_my_invitations() to authenticated;
revoke execute on function public.respond_to_invitation(uuid, boolean, date[]) from public, anon;
grant execute on function public.respond_to_invitation(uuid, boolean, date[]) to authenticated;
revoke execute on function public.my_official_days(uuid) from public, anon;
grant execute on function public.my_official_days(uuid) to authenticated;
