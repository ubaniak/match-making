-- Stage 3 of plan/events.md: entries.
--
--   * The event Owner (or a site Admin) invites clubs to an Active event; an invited club is in.
--   * A club owner can ask to join an Active event for their club; the Owner or a site Admin
--     accepts or declines.
--   * Once a club is in, its club owners enter their own athletes straight away (no approval,
--     no category check) and can suggest an opponent by name and club.
--   * A club owner can withdraw an athlete at any time before the event is Done.
--   * Entry deadline (optional, set by the Owner): after it, entries are locked, and a club owner
--     can send the Owner a late-entry request for an athlete. Accepting it enters the athlete.
--   * Athletes are now entered only through clubs, so the event-level Coach role goes: event
--     Coaches become Viewers. Any club already has its entered athletes' clubs marked as in.
--   * Every signed-in user can see Active and Done events (so club owners can find them).
--     Entries are seen by the event's Owner, site Admins and members of clubs that are in.

-- ---------------------------------------------------------------------------
-- Event roles: Owner and Viewer
-- ---------------------------------------------------------------------------

drop policy "add event members" on public.event_members;
drop policy "change event members" on public.event_members;
drop policy "remove event members" on public.event_members;
drop policy "read event athletes" on public.event_athletes;
drop policy "add event athletes" on public.event_athletes;
drop policy "remove event athletes" on public.event_athletes;
drop policy "read events" on public.events;
drop policy "read event days" on public.event_days;
drop policy "read bout sessions" on public.event_bout_sessions;

update public.event_members set role = 'viewer' where role = 'coach';
alter table public.event_members drop constraint event_members_role_check;
alter table public.event_members add constraint event_members_role_check check (role in ('owner', 'viewer'));

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

alter table public.events add column entry_deadline timestamptz;

create table public.event_clubs (
  event_id uuid not null references public.events (id) on delete cascade,
  club_id uuid not null references public.clubs (id) on delete cascade,
  -- 'accepted' = the club is in (invited by the Owner, or its request accepted).
  status text not null check (status in ('requested', 'accepted', 'declined')),
  requested_by uuid default auth.uid() references public.profiles (id) on delete set null,
  requested_at timestamptz not null default now(),
  decided_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz,
  primary key (event_id, club_id)
);

create index event_clubs_club_idx on public.event_clubs (club_id);

-- Which club the athlete was entered for, and the opponent their club owner suggests.
alter table public.event_athletes
  add column club_id uuid references public.clubs (id) on delete set null,
  add column suggested_opponent_name text check (suggested_opponent_name is null or length(suggested_opponent_name) <= 100),
  add column suggested_opponent_club text check (suggested_opponent_club is null or length(suggested_opponent_club) <= 100);

update public.event_athletes ea set club_id = a.club_id from public.athletes a where a.id = ea.athlete_id;

-- Clubs whose athletes are already entered count as in.
insert into public.event_clubs (event_id, club_id, status, requested_by, decided_at)
select distinct ea.event_id, ea.club_id, 'accepted', null::uuid, now()
from public.event_athletes ea
where ea.club_id is not null
on conflict do nothing;

create table public.late_entry_requests (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  athlete_id uuid not null references public.athletes (id) on delete cascade,
  club_id uuid references public.clubs (id) on delete set null,
  note text check (note is null or length(note) <= 500),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  requested_by uuid default auth.uid() references public.profiles (id) on delete set null,
  requested_at timestamptz not null default now(),
  decided_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz
);

create unique index late_entry_one_pending on public.late_entry_requests (event_id, athlete_id) where status = 'pending';

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Is the signed-in user in a club that is in this event?
create function public.in_event_club(p_event_id uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.event_clubs ec
    where ec.event_id = p_event_id and ec.status = 'accepted' and public.club_role(ec.club_id) is not null
  )
$$;

create function public.is_event_owner(p_event_id uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(public.event_role(p_event_id) = 'owner', false)
$$;

-- Who can see an event's details and times.
create function public.can_read_event(p_event_id uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select public.is_site_admin()
    or public.event_role(p_event_id) is not null
    or public.in_event_club(p_event_id)
    or exists (
      select 1 from public.events e
      where e.id = p_event_id and e.status in ('active', 'done') and public.has_permission('pages:read')
    )
$$;

-- Who can see an event's clubs and entries.
create function public.can_read_entries(p_event_id uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select public.is_site_admin() or public.is_event_owner(p_event_id) or public.in_event_club(p_event_id)
$$;

-- Are entries open right now (Active, not over, before any deadline)?
create function public.entries_open(p_event_id uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.events
    where id = p_event_id and status = 'active' and end_date >= current_date
      and (entry_deadline is null or now() <= entry_deadline)
  )
$$;

-- Puts an athlete on the event. Callers check permissions first.
create function public.add_entry(p_event_id uuid, p_athlete_id uuid, p_club_id uuid, p_name text, p_club text) returns void
language sql security definer set search_path = public
as $$
  insert into public.event_athletes (event_id, athlete_id, club_id, added_by, suggested_opponent_name, suggested_opponent_club)
  values (p_event_id, p_athlete_id, p_club_id, auth.uid(), nullif(trim(p_name), ''), nullif(trim(p_club), ''))
  on conflict (event_id, athlete_id) do nothing
$$;

-- ---------------------------------------------------------------------------
-- Clubs joining events
-- ---------------------------------------------------------------------------

-- The Owner (or a site Admin) brings a club in. Also accepts a waiting request from it.
create function public.invite_club(p_event_id uuid, p_club_id uuid) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not coalesce(public.is_site_admin() or public.is_event_owner(p_event_id), false) then
    raise exception 'Only the event''s Owner or a site Admin can invite clubs' using errcode = '42501';
  end if;
  if not public.event_is_open(p_event_id) then
    raise exception 'Clubs can be invited once the event is Active' using errcode = '22023';
  end if;
  if not exists (select 1 from public.clubs where id = p_club_id) then
    raise exception 'That club no longer exists' using errcode = 'P0002';
  end if;
  insert into public.event_clubs (event_id, club_id, status, decided_by, decided_at)
  values (p_event_id, p_club_id, 'accepted', auth.uid(), now())
  on conflict (event_id, club_id) do update set status = 'accepted', decided_by = auth.uid(), decided_at = now();
end;
$$;

-- A club owner asks for their club to join an Active event.
create function public.request_to_join(p_event_id uuid, p_club_id uuid) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_status text;
begin
  if not coalesce(public.is_site_admin() or public.club_role(p_club_id) = 'owner', false) then
    raise exception 'Only the club''s Owners can ask to join for it' using errcode = '42501';
  end if;
  if not public.event_is_open(p_event_id) then
    raise exception 'Clubs can join once the event is Active' using errcode = '22023';
  end if;
  select status into v_status from public.event_clubs where event_id = p_event_id and club_id = p_club_id;
  if v_status = 'accepted' then
    raise exception 'That club is already in this event' using errcode = '23505';
  end if;
  if v_status = 'requested' then
    return;
  end if;
  insert into public.event_clubs (event_id, club_id, status)
  values (p_event_id, p_club_id, 'requested')
  on conflict (event_id, club_id) do update
    set status = 'requested', requested_by = auth.uid(), requested_at = now(), decided_by = null, decided_at = null;
end;
$$;

create function public.decide_join_request(p_event_id uuid, p_club_id uuid, p_accept boolean) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not coalesce(public.is_site_admin() or public.is_event_owner(p_event_id), false) then
    raise exception 'Only the event''s Owner or a site Admin can answer join requests' using errcode = '42501';
  end if;
  update public.event_clubs
  set status = case when p_accept then 'accepted' else 'declined' end, decided_by = auth.uid(), decided_at = now()
  where event_id = p_event_id and club_id = p_club_id and status = 'requested';
  if not found then
    raise exception 'That request is no longer waiting' using errcode = '22023';
  end if;
end;
$$;

-- The Owner or a site Admin takes a club out; its athletes are withdrawn with it.
-- A club owner can also withdraw their own club (or their waiting request).
create function public.remove_event_club(p_event_id uuid, p_club_id uuid) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not coalesce(public.is_site_admin() or public.is_event_owner(p_event_id) or public.club_role(p_club_id) = 'owner', false) then
    raise exception 'Only the event''s Owner, the club''s Owners or a site Admin can do that' using errcode = '42501';
  end if;
  if not exists (select 1 from public.events where id = p_event_id and status in ('requested', 'active') and end_date >= current_date)
     and not public.is_site_admin() then
    raise exception 'This event can no longer be changed' using errcode = '22023';
  end if;
  delete from public.event_athletes where event_id = p_event_id and club_id = p_club_id;
  update public.late_entry_requests set status = 'cancelled', decided_by = auth.uid(), decided_at = now()
  where event_id = p_event_id and club_id = p_club_id and status = 'pending';
  delete from public.event_clubs where event_id = p_event_id and club_id = p_club_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Entering and withdrawing athletes
-- ---------------------------------------------------------------------------

-- Checks shared by entries and late-entry requests. Returns the athlete's club.
create function public.check_entry(p_event_id uuid, p_athlete_id uuid) returns uuid
language plpgsql stable security definer set search_path = public
as $$
declare
  v_club uuid;
begin
  select club_id into v_club from public.athletes where id = p_athlete_id;
  if not found then
    raise exception 'That athlete no longer exists' using errcode = 'P0002';
  end if;
  if v_club is null then
    raise exception 'That athlete isn''t in a club' using errcode = '22023';
  end if;
  if not coalesce(public.is_site_admin() or public.club_role(v_club) = 'owner', false) then
    raise exception 'Only the athlete''s club Owners can enter them' using errcode = '42501';
  end if;
  if not public.event_is_open(p_event_id) then
    raise exception 'Athletes can be entered once the event is Active, and until it is over' using errcode = '22023';
  end if;
  if not exists (select 1 from public.event_clubs where event_id = p_event_id and club_id = v_club and status = 'accepted') then
    raise exception 'The athlete''s club isn''t in this event yet' using errcode = '22023';
  end if;
  if exists (select 1 from public.event_athletes where event_id = p_event_id and athlete_id = p_athlete_id) then
    raise exception 'That athlete is already entered' using errcode = '23505';
  end if;
  return v_club;
end;
$$;

-- A club owner enters one of their athletes. Site Admins can enter after the deadline.
create function public.enter_athlete(
  p_event_id uuid, p_athlete_id uuid, p_opponent_name text default null, p_opponent_club text default null
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_club uuid := public.check_entry(p_event_id, p_athlete_id);
begin
  if not public.entries_open(p_event_id) and not public.is_site_admin() then
    raise exception 'The entry deadline has passed. Send the Owner a late-entry request instead.' using errcode = '22023';
  end if;
  perform public.add_entry(p_event_id, p_athlete_id, v_club, p_opponent_name, p_opponent_club);
end;
$$;

-- The athlete's club owner (or a site Admin) changes the suggested opponent.
create function public.suggest_opponent(p_event_id uuid, p_athlete_id uuid, p_name text, p_club text) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_club uuid;
begin
  select club_id into v_club from public.event_athletes where event_id = p_event_id and athlete_id = p_athlete_id;
  if not found then
    raise exception 'That athlete isn''t entered' using errcode = 'P0002';
  end if;
  if not coalesce(public.is_site_admin() or public.club_role(v_club) = 'owner', false) then
    raise exception 'Only the athlete''s club Owners can suggest an opponent' using errcode = '42501';
  end if;
  update public.event_athletes
  set suggested_opponent_name = nullif(trim(p_name), ''), suggested_opponent_club = nullif(trim(p_club), '')
  where event_id = p_event_id and athlete_id = p_athlete_id;
end;
$$;

-- A club owner (or a site Admin) withdraws an athlete, any time before the event is Done.
create function public.withdraw_athlete(p_event_id uuid, p_athlete_id uuid) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_club uuid;
begin
  select club_id into v_club from public.event_athletes where event_id = p_event_id and athlete_id = p_athlete_id;
  if not found then
    raise exception 'That athlete isn''t entered' using errcode = 'P0002';
  end if;
  if not coalesce(public.is_site_admin() or public.club_role(v_club) = 'owner', false) then
    raise exception 'Only the athlete''s club Owners can withdraw them' using errcode = '42501';
  end if;
  if not public.is_site_admin()
     and not exists (select 1 from public.events where id = p_event_id and status in ('requested', 'active') and end_date >= current_date) then
    raise exception 'This event is over, so its entries can''t change' using errcode = '22023';
  end if;
  delete from public.event_athletes where event_id = p_event_id and athlete_id = p_athlete_id;
end;
$$;

-- After the deadline: a club owner asks the Owner to let an athlete in.
create function public.request_late_entry(p_event_id uuid, p_athlete_id uuid, p_note text default null) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_club uuid := public.check_entry(p_event_id, p_athlete_id);
  v_id uuid;
begin
  if public.entries_open(p_event_id) then
    raise exception 'Entries are still open, so enter the athlete directly' using errcode = '22023';
  end if;
  if exists (select 1 from public.late_entry_requests where event_id = p_event_id and athlete_id = p_athlete_id and status = 'pending') then
    raise exception 'There is already a late-entry request waiting for that athlete' using errcode = '23505';
  end if;
  insert into public.late_entry_requests (event_id, athlete_id, club_id, note)
  values (p_event_id, p_athlete_id, v_club, nullif(trim(p_note), ''))
  returning id into v_id;
  return v_id;
end;
$$;

create function public.decide_late_entry(p_request_id uuid, p_accept boolean) returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.late_entry_requests%rowtype;
begin
  select * into r from public.late_entry_requests where id = p_request_id for update;
  if not found or r.status <> 'pending' then
    raise exception 'That request is no longer waiting' using errcode = '22023';
  end if;
  if not coalesce(public.is_site_admin() or public.is_event_owner(r.event_id), false) then
    raise exception 'Only the event''s Owner or a site Admin can answer late-entry requests' using errcode = '42501';
  end if;
  if p_accept then
    if not public.event_is_open(r.event_id) then
      raise exception 'This event is no longer taking entries' using errcode = '22023';
    end if;
    perform public.add_entry(r.event_id, r.athlete_id, r.club_id, null, null);
  end if;
  update public.late_entry_requests
  set status = case when p_accept then 'accepted' else 'declined' end, decided_by = auth.uid(), decided_at = now()
  where id = p_request_id;
end;
$$;

create function public.cancel_late_entry(p_request_id uuid) returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.late_entry_requests%rowtype;
begin
  select * into r from public.late_entry_requests where id = p_request_id for update;
  if not found or r.status <> 'pending' then
    raise exception 'That request is no longer waiting' using errcode = '22023';
  end if;
  if not coalesce(public.is_site_admin() or r.requested_by = auth.uid() or public.club_role(r.club_id) = 'owner', false) then
    raise exception 'Only the club''s Owners can withdraw this request' using errcode = '42501';
  end if;
  update public.late_entry_requests set status = 'cancelled', decided_by = auth.uid(), decided_at = now()
  where id = p_request_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.event_clubs enable row level security;
alter table public.late_entry_requests enable row level security;

create policy "read events" on public.events for select to authenticated
  using (public.can_read_event(id));
create policy "read event days" on public.event_days for select to authenticated
  using (public.can_read_event(event_id));
create policy "read bout sessions" on public.event_bout_sessions for select to authenticated
  using (public.can_read_event(event_id));

-- The Owner adds Viewers once the event is Active. Site Admins set the Owner at any time.
create policy "add event members" on public.event_members for insert to authenticated
  with check (
    (public.is_site_admin() and role = 'owner')
    or (role = 'viewer' and public.event_is_open(event_id) and (public.is_site_admin() or public.is_event_owner(event_id)))
  );
create policy "change event members" on public.event_members for update to authenticated
  using (public.is_site_admin()) with check (public.is_site_admin());
create policy "remove event members" on public.event_members for delete to authenticated
  using (public.is_site_admin() or (public.is_event_owner(event_id) and public.can_edit_event(event_id)));

-- Entries change only through the functions above.
create policy "read event athletes" on public.event_athletes for select to authenticated
  using (public.can_read_entries(event_id));

-- A club's own members always see their club's place in the event (including requests).
create policy "read event clubs" on public.event_clubs for select to authenticated
  using (public.can_read_entries(event_id) or public.club_role(club_id) is not null);

create policy "read late entries" on public.late_entry_requests for select to authenticated
  using (public.is_site_admin() or public.is_event_owner(event_id) or public.club_role(club_id) is not null);

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke execute on function public.add_entry(uuid, uuid, uuid, text, text) from public, anon, authenticated;
revoke execute on function public.check_entry(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.invite_club(uuid, uuid) from public, anon;
grant execute on function public.invite_club(uuid, uuid) to authenticated;
revoke execute on function public.request_to_join(uuid, uuid) from public, anon;
grant execute on function public.request_to_join(uuid, uuid) to authenticated;
revoke execute on function public.decide_join_request(uuid, uuid, boolean) from public, anon;
grant execute on function public.decide_join_request(uuid, uuid, boolean) to authenticated;
revoke execute on function public.remove_event_club(uuid, uuid) from public, anon;
grant execute on function public.remove_event_club(uuid, uuid) to authenticated;
revoke execute on function public.enter_athlete(uuid, uuid, text, text) from public, anon;
grant execute on function public.enter_athlete(uuid, uuid, text, text) to authenticated;
revoke execute on function public.suggest_opponent(uuid, uuid, text, text) from public, anon;
grant execute on function public.suggest_opponent(uuid, uuid, text, text) to authenticated;
revoke execute on function public.withdraw_athlete(uuid, uuid) from public, anon;
grant execute on function public.withdraw_athlete(uuid, uuid) to authenticated;
revoke execute on function public.request_late_entry(uuid, uuid, text) from public, anon;
grant execute on function public.request_late_entry(uuid, uuid, text) to authenticated;
revoke execute on function public.decide_late_entry(uuid, boolean) from public, anon;
grant execute on function public.decide_late_entry(uuid, boolean) to authenticated;
revoke execute on function public.cancel_late_entry(uuid) from public, anon;
grant execute on function public.cancel_late_entry(uuid) to authenticated;
