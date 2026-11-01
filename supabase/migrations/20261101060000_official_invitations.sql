-- Migration 14: inviting officials to events (plan/events.md, "Inviting officials").
--
--   * Once an event is Active, its Owner or a site Admin invites people from the Officials list.
--     An invitation can have an optional "respond by" date.
--   * The official accepts or declines, and can change their answer until the event's first day.
--     A pending invitation past its respond-by date can't be accepted until it is re-sent.
--   * The Owner re-invites, cancels invitations and removes officials. Only the Owner and site
--     Admins see the lists; an official sees their own invitations.
--   * The Chief Official and Deputy must be officials who accepted. Declining or being removed
--     takes them off those roles.
--   * Every official who accepted can record the weigh-in, and sees the event's entries and bouts.
--
-- Existing Chief Officials and Deputies are kept: each gets an Officials record (if they have
-- none) and an accepted invitation.

-- ---------------------------------------------------------------------------
-- Invitations
-- ---------------------------------------------------------------------------

create table public.official_invitations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  official_id uuid not null references public.officials (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  respond_by date,
  invited_by uuid default auth.uid() references public.profiles (id) on delete set null,
  invited_at timestamptz not null default now(),
  responded_at timestamptz,
  unique (event_id, official_id)
);

create index official_invitations_official on public.official_invitations (official_id);

-- Has the signed-in user accepted an invitation to officiate this event?
create function public.is_accepted_official(p_event_id uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.official_invitations i
    join public.officials o on o.id = i.official_id
    join public.profiles p on p.id = o.user_id and p.status = 'active'
    where i.event_id = p_event_id and i.status = 'accepted' and o.user_id = auth.uid()
  )
$$;

-- Is this user an official who accepted the event's invitation?
create function public.user_accepted_event(p_event_id uuid, p_user_id uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.official_invitations i
    join public.officials o on o.id = i.official_id
    where i.event_id = p_event_id and i.status = 'accepted' and o.user_id = p_user_id
  )
$$;

-- Owner or site Admin, whatever the event's status (for reading the lists).
create function public.is_owner_or_admin(p_event_id uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(public.is_site_admin() or public.is_event_owner(p_event_id), false)
$$;

-- Accepted officials see the event, its entries and its bouts.
create or replace function public.can_read_event(p_event_id uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select public.is_site_admin()
    or public.event_role(p_event_id) is not null
    or public.event_official_role(p_event_id) is not null
    or public.is_accepted_official(p_event_id)
    or public.in_event_club(p_event_id)
    or exists (
      select 1 from public.events e
      where e.id = p_event_id and e.status in ('active', 'done') and public.has_permission('pages:read')
    )
$$;

create or replace function public.can_read_entries(p_event_id uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select public.is_site_admin() or public.is_event_owner(p_event_id) or public.in_event_club(p_event_id)
    or public.event_official_role(p_event_id) is not null
    or public.is_accepted_official(p_event_id)
$$;

-- Who records the weigh-in: the CO, the Deputy, any accepted official, or a site Admin.
create function public.can_weigh_in(p_event_id uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select public.is_event_official(p_event_id) or public.is_accepted_official(p_event_id)
$$;

-- ---------------------------------------------------------------------------
-- Functions
-- ---------------------------------------------------------------------------

-- Officials the Owner can invite: everyone on the Officials list with an email.
create function public.list_invitable_officials(p_event_id uuid)
returns table (id uuid, name text, email text, signed_in boolean)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_owner_or_admin(p_event_id) then
    raise exception 'Only the event''s Owner or a site Admin can invite officials' using errcode = '42501';
  end if;
  return query
    select o.id, o.name, o.invite_email, o.user_id is not null
    from public.officials o
    where o.invite_email is not null
    order by o.name;
end;
$$;

-- The event's invitations, for its Owner and site Admins.
create function public.list_event_invitations(p_event_id uuid)
returns table (
  id uuid, official_id uuid, name text, email text, user_id uuid, status text, respond_by date,
  invited_at timestamptz, responded_at timestamptz
)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_owner_or_admin(p_event_id) then
    return;
  end if;
  return query
    select i.id, i.official_id, o.name, o.invite_email, o.user_id, i.status, i.respond_by, i.invited_at, i.responded_at
    from public.official_invitations i
    join public.officials o on o.id = i.official_id
    where i.event_id = p_event_id
    order by o.name;
end;
$$;

-- The signed-in user's own invitations, newest events first.
create function public.list_my_invitations()
returns table (
  id uuid, event_id uuid, event_name text, venue text, start_date date, end_date date, timezone text,
  event_status text, status text, respond_by date, invited_at timestamptz, responded_at timestamptz
)
language sql stable security definer set search_path = public
as $$
  select i.id, e.id, e.name, e.venue, e.start_date, e.end_date, e.timezone, e.status,
    i.status, i.respond_by, i.invited_at, i.responded_at
  from public.official_invitations i
  join public.officials o on o.id = i.official_id
  join public.events e on e.id = i.event_id
  where o.user_id = auth.uid()
  order by e.start_date desc, e.name
$$;

-- Invite (or re-invite) officials. Returns the invitations that were sent, for emailing.
-- Officials who already accepted are left alone.
create function public.invite_officials(p_event_id uuid, p_official_ids uuid[], p_respond_by date default null)
returns setof uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_event public.events;
  v_official uuid;
  v_id uuid;
begin
  if not public.is_owner_or_admin(p_event_id) then
    raise exception 'Only the event''s Owner or a site Admin can invite officials' using errcode = '42501';
  end if;
  if not public.event_is_open(p_event_id) then
    raise exception 'Officials can be invited once the event is Active, and until it is over' using errcode = '22023';
  end if;
  select * into v_event from public.events where id = p_event_id;
  if p_respond_by is not null and p_respond_by < public.local_today(v_event.timezone) then
    raise exception 'The respond-by date has already passed' using errcode = '22023';
  end if;
  if p_respond_by is not null and p_respond_by > v_event.end_date then
    raise exception 'The respond-by date must be on or before the event''s last day' using errcode = '22023';
  end if;
  if coalesce(array_length(p_official_ids, 1), 0) = 0 then
    raise exception 'Choose at least one official' using errcode = '22023';
  end if;

  foreach v_official in array p_official_ids loop
    if not exists (select 1 from public.officials where id = v_official and invite_email is not null) then
      raise exception 'Only officials with an email can be invited' using errcode = '23514';
    end if;
    insert into public.official_invitations (event_id, official_id, respond_by)
    values (p_event_id, v_official, p_respond_by)
    on conflict (event_id, official_id) do update
      set status = 'pending', respond_by = excluded.respond_by, invited_by = auth.uid(),
          invited_at = now(), responded_at = null
      where official_invitations.status <> 'accepted'
    returning id into v_id;
    if v_id is not null then
      return next v_id;
    end if;
    v_id := null;
  end loop;
end;
$$;

-- The official accepts or declines. They can change their answer until the event's first day.
create function public.respond_to_invitation(p_invitation_id uuid, p_accept boolean) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_inv public.official_invitations;
  v_event public.events;
  v_user uuid;
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

  update public.official_invitations
  set status = case when p_accept then 'accepted' else 'declined' end, responded_at = now()
  where id = p_invitation_id;

  if not p_accept then
    delete from public.event_officials where event_id = v_inv.event_id and user_id = v_user;
  end if;
end;
$$;

-- Cancel an invitation, or remove an official who accepted. They stop being CO or Deputy.
create function public.cancel_invitation(p_invitation_id uuid) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_inv public.official_invitations;
  v_user uuid;
begin
  select * into v_inv from public.official_invitations where id = p_invitation_id;
  if not found then
    return;
  end if;
  if not coalesce(public.can_edit_event(v_inv.event_id), false) then
    raise exception 'Only the event''s Owner or a site Admin can remove officials' using errcode = '42501';
  end if;
  select user_id into v_user from public.officials where id = v_inv.official_id;
  delete from public.official_invitations where id = p_invitation_id;
  if v_user is not null then
    delete from public.event_officials where event_id = v_inv.event_id and user_id = v_user;
  end if;
end;
$$;

-- What the invitation email needs. Owner or site Admin only.
create function public.official_invitation_email(p_invitation_id uuid)
returns table (
  official_name text, email text, event_name text, venue text, start_date date, end_date date, respond_by date
)
language plpgsql stable security definer set search_path = public
as $$
declare
  v_event uuid;
begin
  select event_id into v_event from public.official_invitations where id = p_invitation_id;
  if v_event is null or not public.is_owner_or_admin(v_event) then
    return;
  end if;
  return query
    select o.name, o.invite_email, e.name, e.venue, e.start_date, e.end_date, i.respond_by
    from public.official_invitations i
    join public.officials o on o.id = i.official_id
    join public.events e on e.id = i.event_id
    where i.id = p_invitation_id;
end;
$$;

-- The CO and Deputy are now picked from the officials who accepted.
create or replace function public.set_event_official(p_event_id uuid, p_role text, p_user_id uuid) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not coalesce(public.can_edit_event(p_event_id), false) then
    raise exception 'Only the event''s Owner or a site Admin can choose its officials' using errcode = '42501';
  end if;
  if p_role not in ('chief', 'deputy') then
    raise exception 'Officials are a Chief Official or a Deputy' using errcode = '22023';
  end if;
  if p_user_id is null then
    delete from public.event_officials where event_id = p_event_id and role = p_role;
    return;
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id and status = 'active') then
    raise exception 'Pick someone who has signed in at least once' using errcode = '23514';
  end if;
  if not public.user_accepted_event(p_event_id, p_user_id) then
    raise exception 'Pick an official who has accepted the invitation to this event' using errcode = '23514';
  end if;
  if exists (select 1 from public.event_officials where event_id = p_event_id and user_id = p_user_id and role <> p_role) then
    raise exception 'The Chief Official and the Deputy must be different people' using errcode = '23505';
  end if;
  insert into public.event_officials (event_id, role, user_id) values (p_event_id, p_role, p_user_id)
  on conflict (event_id, role) do update set user_id = excluded.user_id, added_by = auth.uid(), added_at = now();
end;
$$;

-- Same as migration 12, but any accepted official can record the weigh-in.
create or replace function public.record_weigh_in(
  p_event_id uuid, p_day date, p_athlete_id uuid, p_weight_kg numeric, p_medical text, p_note text default null
) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.can_weigh_in(p_event_id) then
    raise exception 'Only the event''s officials record the weigh-in' using errcode = '42501';
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
-- Keep existing Chief Officials and Deputies
-- ---------------------------------------------------------------------------

insert into public.officials (name, invite_email, user_id)
select distinct on (p.id) coalesce(nullif(trim(p.name), ''), p.email), lower(p.email), p.id
from public.event_officials eo
join public.profiles p on p.id = eo.user_id
where p.email is not null
  and not exists (select 1 from public.officials o where o.user_id = p.id);

insert into public.official_invitations (event_id, official_id, status, invited_by, responded_at)
select eo.event_id, o.id, 'accepted', eo.added_by, now()
from public.event_officials eo
join public.officials o on o.user_id = eo.user_id
on conflict (event_id, official_id) do update set status = 'accepted', responded_at = now();

-- ---------------------------------------------------------------------------
-- Row-level security: reads only; every change goes through the functions above.
-- ---------------------------------------------------------------------------

alter table public.official_invitations enable row level security;

create policy "read official invitations" on public.official_invitations for select to authenticated
  using (
    public.is_owner_or_admin(event_id)
    or exists (select 1 from public.officials o where o.id = official_id and o.user_id = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke execute on function public.user_accepted_event(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.list_invitable_officials(uuid) from public, anon;
grant execute on function public.list_invitable_officials(uuid) to authenticated;
revoke execute on function public.list_event_invitations(uuid) from public, anon;
grant execute on function public.list_event_invitations(uuid) to authenticated;
revoke execute on function public.list_my_invitations() from public, anon;
grant execute on function public.list_my_invitations() to authenticated;
revoke execute on function public.invite_officials(uuid, uuid[], date) from public, anon;
grant execute on function public.invite_officials(uuid, uuid[], date) to authenticated;
revoke execute on function public.respond_to_invitation(uuid, boolean) from public, anon;
grant execute on function public.respond_to_invitation(uuid, boolean) to authenticated;
revoke execute on function public.cancel_invitation(uuid) from public, anon;
grant execute on function public.cancel_invitation(uuid) to authenticated;
revoke execute on function public.official_invitation_email(uuid) from public, anon;
grant execute on function public.official_invitation_email(uuid) to authenticated;
