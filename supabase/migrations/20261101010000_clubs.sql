-- Stage 2 of plan/events.md: clubs.
--
--   * A club is its own record with its own athletes. It replaces the free-text athletes.club:
--     every club name already typed in becomes a club, and its athletes are linked to it.
--   * Site Admins create clubs and assign club owners.
--   * Club members are Owners or Coaches. Club owners can invite people, but each invite stays
--     pending until a site Admin approves it. One person can belong to many clubs.
--   * Club owners (and site Admins) add and edit the club's athletes. Coaches see them.
--   * An athlete is in one club at a time. To move one, a member of their club sends a transfer
--     request to the other club, whose owner accepts or declines. A site Admin can also move an
--     athlete directly. Everything (bout count, results, history) stays on the athlete record.
--   * No transfers while the athlete is entered in an Active event that isn't over; only a site
--     Admin can override that.

-- ---------------------------------------------------------------------------
-- Clubs and members
-- ---------------------------------------------------------------------------

create table public.clubs (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index clubs_name_unique on public.clubs (lower(trim(name)));

create table public.club_members (
  club_id uuid not null references public.clubs (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null check (role in ('owner', 'coach')),
  -- 'pending' invites from club owners wait for a site Admin.
  status text not null default 'active' check (status in ('active', 'pending')),
  invited_by uuid default auth.uid() references public.profiles (id) on delete set null,
  invited_at timestamptz not null default now(),
  approved_by uuid references public.profiles (id) on delete set null,
  approved_at timestamptz,
  primary key (club_id, user_id)
);

create index club_members_user_idx on public.club_members (user_id);

-- The signed-in user's role in a club ('owner', 'coach' or null). Pending invites don't count.
create function public.club_role(p_club_id uuid) returns text
language sql stable security definer set search_path = public
as $$
  select m.role from public.club_members m
  join public.profiles p on p.id = m.user_id and p.status = 'active'
  where m.club_id = p_club_id and m.user_id = auth.uid() and m.status = 'active'
$$;

-- Approving an invite records who approved it. Only site Admins approve.
create function public.check_club_member() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null or public.is_site_admin() then
    if new.status = 'active' and (tg_op = 'INSERT' or old.status = 'pending') then
      new.approved_by := auth.uid();
      new.approved_at := now();
    end if;
    return new;
  end if;
  -- Club owners can only add pending invites, and can't change existing members.
  if tg_op = 'INSERT' and new.status <> 'pending' then
    raise exception 'A site Admin has to approve new club members' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    raise exception 'Only a site Admin can approve or change club members' using errcode = '42501';
  end if;
  new.invited_by := auth.uid();
  return new;
end;
$$;

create trigger check_club_member
  before insert or update on public.club_members
  for each row execute function public.check_club_member();

-- ---------------------------------------------------------------------------
-- Athletes belong to a club
-- ---------------------------------------------------------------------------

alter table public.athletes add column club_id uuid references public.clubs (id);
create index athletes_club_idx on public.athletes (club_id);

-- Every club name already typed in becomes a club (names differing only in case or spacing merge).
insert into public.clubs (name, created_by)
select distinct on (lower(trim(club))) trim(club), null
from public.athletes
where club is not null and length(trim(club)) > 0
order by lower(trim(club)), trim(club);

update public.athletes a set club_id = c.id
from public.clubs c
where lower(trim(a.club)) = lower(trim(c.name));

-- The details check now needs a club record instead of a club name. Still NOT VALID, so
-- athletes saved before details were required are left alone until they're edited.
alter table public.athletes drop constraint athletes_details_required;
alter table public.athletes drop column club;
alter table public.athletes
  add constraint athletes_details_required check (
    date_of_birth is not null
    and gender is not null
    and weight_kg is not null
    and bouts is not null
    and club_id is not null
  ) not valid;

-- Is the athlete entered in an Active event that isn't over? Then they can't change clubs.
create function public.athlete_in_open_event(p_athlete_id uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.event_athletes ea
    join public.events e on e.id = ea.event_id
    where ea.athlete_id = p_athlete_id and e.status = 'active' and e.end_date >= current_date
  )
$$;

-- An athlete's club changes only through accept_transfer or move_athlete (or a site Admin).
create function public.check_athlete_club() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.club_id is distinct from old.club_id
     and current_setting('app.moving_athlete', true) is distinct from 'on'
     and auth.uid() is not null and not public.is_site_admin() then
    raise exception 'Athletes change clubs through a transfer request' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger check_athlete_club
  before update on public.athletes
  for each row execute function public.check_athlete_club();

-- ---------------------------------------------------------------------------
-- Transfers
-- ---------------------------------------------------------------------------

create table public.athlete_transfers (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.athletes (id) on delete cascade,
  from_club_id uuid references public.clubs (id) on delete set null,
  to_club_id uuid references public.clubs (id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'cancelled', 'moved')),
  note text check (note is null or length(note) <= 500),
  requested_by uuid default auth.uid() references public.profiles (id) on delete set null,
  requested_at timestamptz not null default now(),
  decided_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz,
  check (from_club_id is distinct from to_club_id)
);

-- One open request per athlete.
create unique index athlete_transfers_one_pending on public.athlete_transfers (athlete_id) where status = 'pending';
create index athlete_transfers_to_idx on public.athlete_transfers (to_club_id);
create index athlete_transfers_from_idx on public.athlete_transfers (from_club_id);

-- Moves the athlete, bypassing check_athlete_club. Callers check permissions first.
create function public.set_athlete_club(p_athlete_id uuid, p_club_id uuid) returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform set_config('app.moving_athlete', 'on', true);
  update public.athletes set club_id = p_club_id where id = p_athlete_id;
  perform set_config('app.moving_athlete', 'off', true);
end;
$$;

-- A member of the athlete's club (Owner or Coach), or a site Admin, asks another club to take them.
create function public.request_transfer(p_athlete_id uuid, p_to_club_id uuid, p_note text default null) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_from uuid;
  v_id uuid;
begin
  select club_id into v_from from public.athletes where id = p_athlete_id;
  if not found then
    raise exception 'That athlete no longer exists' using errcode = 'P0002';
  end if;
  if not (public.is_site_admin() or (v_from is not null and public.club_role(v_from) is not null)) then
    raise exception 'Only members of the athlete''s club can ask to transfer them' using errcode = '42501';
  end if;
  if p_to_club_id is null or not exists (select 1 from public.clubs where id = p_to_club_id) then
    raise exception 'Pick the club to transfer to' using errcode = '22023';
  end if;
  if p_to_club_id = v_from then
    raise exception 'The athlete is already in that club' using errcode = '22023';
  end if;
  if public.athlete_in_open_event(p_athlete_id) then
    raise exception 'This athlete is entered in an Active event, so they can''t transfer until it is Done' using errcode = '23514';
  end if;
  if exists (select 1 from public.athlete_transfers where athlete_id = p_athlete_id and status = 'pending') then
    raise exception 'This athlete already has a transfer request waiting' using errcode = '23505';
  end if;

  insert into public.athlete_transfers (athlete_id, from_club_id, to_club_id, note)
  values (p_athlete_id, v_from, p_to_club_id, nullif(trim(p_note), ''))
  returning id into v_id;
  return v_id;
end;
$$;

-- The receiving club's Owner (or a site Admin) accepts or declines. A site Admin can pass
-- p_override to accept even while the athlete is in an Active event.
create function public.decide_transfer(p_transfer_id uuid, p_accept boolean, p_override boolean default false) returns void
language plpgsql security definer set search_path = public
as $$
declare
  t public.athlete_transfers%rowtype;
begin
  select * into t from public.athlete_transfers where id = p_transfer_id for update;
  if not found then
    raise exception 'That transfer request no longer exists' using errcode = 'P0002';
  end if;
  if t.status <> 'pending' then
    raise exception 'That transfer request was already %', t.status using errcode = '22023';
  end if;
  if not coalesce(public.is_site_admin() or public.club_role(t.to_club_id) = 'owner', false) then
    raise exception 'Only the receiving club''s Owner can accept or decline' using errcode = '42501';
  end if;

  if p_accept then
    if t.to_club_id is null then
      raise exception 'The receiving club no longer exists' using errcode = '22023';
    end if;
    if public.athlete_in_open_event(t.athlete_id) and not (p_override and public.is_site_admin()) then
      raise exception 'This athlete is entered in an Active event, so they can''t transfer until it is Done' using errcode = '23514';
    end if;
    perform public.set_athlete_club(t.athlete_id, t.to_club_id);
  end if;

  update public.athlete_transfers
  set status = case when p_accept then 'accepted' else 'declined' end, decided_by = auth.uid(), decided_at = now()
  where id = p_transfer_id;
end;
$$;

-- The person who asked, an Owner of the sending club, or a site Admin withdraws a request.
create function public.cancel_transfer(p_transfer_id uuid) returns void
language plpgsql security definer set search_path = public
as $$
declare
  t public.athlete_transfers%rowtype;
begin
  select * into t from public.athlete_transfers where id = p_transfer_id for update;
  if not found or t.status <> 'pending' then
    raise exception 'That transfer request is no longer waiting' using errcode = '22023';
  end if;
  if not coalesce(public.is_site_admin() or t.requested_by = auth.uid()
                  or public.club_role(t.from_club_id) = 'owner', false) then
    raise exception 'Only whoever asked, or the club''s Owner, can withdraw this request' using errcode = '42501';
  end if;
  update public.athlete_transfers set status = 'cancelled', decided_by = auth.uid(), decided_at = now()
  where id = p_transfer_id;
end;
$$;

-- A site Admin moves an athlete straight away. p_override allows it during an Active event.
create function public.move_athlete(p_athlete_id uuid, p_club_id uuid, p_override boolean default false) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_from uuid;
begin
  if not public.is_site_admin() then
    raise exception 'Only a site Admin can move athletes between clubs' using errcode = '42501';
  end if;
  select club_id into v_from from public.athletes where id = p_athlete_id;
  if not found then
    raise exception 'That athlete no longer exists' using errcode = 'P0002';
  end if;
  if p_club_id is null or not exists (select 1 from public.clubs where id = p_club_id) then
    raise exception 'Pick the club to move to' using errcode = '22023';
  end if;
  if p_club_id = v_from then
    return;
  end if;
  if public.athlete_in_open_event(p_athlete_id) and not p_override then
    raise exception 'This athlete is entered in an Active event. Tick "Move anyway" to override.' using errcode = '23514';
  end if;

  update public.athlete_transfers set status = 'cancelled', decided_by = auth.uid(), decided_at = now()
  where athlete_id = p_athlete_id and status = 'pending';
  perform public.set_athlete_club(p_athlete_id, p_club_id);
  insert into public.athlete_transfers (athlete_id, from_club_id, to_club_id, status, decided_by, decided_at)
  values (p_athlete_id, v_from, p_club_id, 'moved', auth.uid(), now());
end;
$$;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.clubs enable row level security;
alter table public.club_members enable row level security;
alter table public.athlete_transfers enable row level security;

create policy "members read clubs" on public.clubs for select to authenticated
  using (public.has_permission('pages:read'));
create policy "site admins manage clubs" on public.clubs for all to authenticated
  using (public.is_site_admin()) with check (public.is_site_admin());

create policy "members read club members" on public.club_members for select to authenticated
  using (public.has_permission('pages:read'));
-- Site Admins add anyone; club owners send invites (made pending by check_club_member).
create policy "add club members" on public.club_members for insert to authenticated
  with check (public.is_site_admin() or public.club_role(club_id) = 'owner');
create policy "site admins change club members" on public.club_members for update to authenticated
  using (public.is_site_admin()) with check (public.is_site_admin());
create policy "remove club members" on public.club_members for delete to authenticated
  using (public.is_site_admin() or public.club_role(club_id) = 'owner');

-- Athletes: everyone with athletes:read still sees them. Club owners and site Admins add,
-- edit and remove them. Older rules for an athlete's own login are kept.
drop policy "add athletes" on public.athletes;
drop policy "edit athletes" on public.athletes;
drop policy "remove athletes" on public.athletes;
create policy "add athletes" on public.athletes for insert to authenticated
  with check (public.is_site_admin() or (club_id is not null and public.club_role(club_id) = 'owner'));
create policy "edit athletes" on public.athletes for update to authenticated
  using (public.is_site_admin() or public.club_role(club_id) = 'owner' or public.has_permission('athletes:write', user_id))
  with check (public.is_site_admin() or public.club_role(club_id) = 'owner' or public.has_permission('athletes:write', user_id)
              or current_setting('app.moving_athlete', true) = 'on');
create policy "remove athletes" on public.athletes for delete to authenticated
  using (public.is_site_admin() or public.club_role(club_id) = 'owner');

-- Transfers are written only through the functions above.
create policy "read transfers" on public.athlete_transfers for select to authenticated
  using (
    public.is_site_admin()
    or (from_club_id is not null and public.club_role(from_club_id) is not null)
    or (to_club_id is not null and public.club_role(to_club_id) is not null)
  );

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke execute on function public.request_transfer(uuid, uuid, text) from public, anon;
grant execute on function public.request_transfer(uuid, uuid, text) to authenticated;
revoke execute on function public.decide_transfer(uuid, boolean, boolean) from public, anon;
grant execute on function public.decide_transfer(uuid, boolean, boolean) to authenticated;
revoke execute on function public.cancel_transfer(uuid) from public, anon;
grant execute on function public.cancel_transfer(uuid) to authenticated;
revoke execute on function public.move_athlete(uuid, uuid, boolean) from public, anon;
grant execute on function public.move_athlete(uuid, uuid, boolean) to authenticated;
revoke execute on function public.set_athlete_club(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.check_club_member() from public, anon, authenticated;
revoke execute on function public.check_athlete_club() from public, anon, authenticated;
