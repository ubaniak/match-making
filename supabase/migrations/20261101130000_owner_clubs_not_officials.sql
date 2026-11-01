-- Migration 21 (Bhavek, 2026-11-01): "an event owner can add clubs and add club owners, they do
-- not invite officials."
--
--   * Only site Admins invite officials, cancel or resend invitations, remove officials and pick
--     the Chief Official and Deputy. The event Owner still sees the lists.
--   * While the event is Active, its Owner can create a new club (it joins the event straight
--     away) and add or remove the owners of any club in the event. These owners are active at
--     once, with no site Admin approval. A club always keeps at least one owner.

-- ---------------------------------------------------------------------------
-- Officials: site Admins only
-- ---------------------------------------------------------------------------

create or replace function public.list_invitable_officials(p_event_id uuid)
returns table (id uuid, name text, email text, signed_in boolean)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_site_admin() then
    raise exception 'Only a site Admin can invite officials' using errcode = '42501';
  end if;
  return query
    select o.id, o.name, o.invite_email, o.user_id is not null
    from public.officials o
    where o.invite_email is not null
    order by o.name;
end;
$$;

create or replace function public.invite_officials(p_event_id uuid, p_official_ids uuid[], p_respond_by date default null)
returns setof uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_event public.events;
  v_official uuid;
  v_id uuid;
begin
  if not public.is_site_admin() then
    raise exception 'Only a site Admin can invite officials' using errcode = '42501';
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

create or replace function public.cancel_invitation(p_invitation_id uuid) returns void
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
  if not public.is_site_admin() then
    raise exception 'Only a site Admin can remove officials' using errcode = '42501';
  end if;
  select user_id into v_user from public.officials where id = v_inv.official_id;
  delete from public.official_invitations where id = p_invitation_id;
  if v_user is not null then
    delete from public.event_officials where event_id = v_inv.event_id and user_id = v_user;
  end if;
end;
$$;

create or replace function public.official_invitation_email(p_invitation_id uuid)
returns table (
  official_name text, email text, event_name text, venue text, start_date date, end_date date, respond_by date
)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_site_admin() then
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

create or replace function public.set_event_official(p_event_id uuid, p_role text, p_user_id uuid) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_site_admin() then
    raise exception 'Only a site Admin can choose the Chief Official and Deputy' using errcode = '42501';
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

-- ---------------------------------------------------------------------------
-- Clubs: the event Owner creates clubs and adds club owners
-- ---------------------------------------------------------------------------

-- Club member changes made by the functions below skip site Admin approval. put_club_owner
-- marks its own transaction in this table, which nobody else can write to (a session setting
-- would not do, because anyone can change their own settings).
create table public.club_owner_grants (
  txid bigint primary key
);
alter table public.club_owner_grants enable row level security;
revoke all on public.club_owner_grants from public, anon, authenticated;

create or replace function public.check_club_member() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null or public.is_site_admin() 
     or exists (select 1 from public.club_owner_grants where txid = txid_current()) then
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

-- The event's Owner (or a site Admin) while the event is Active and not over.
create function public.can_manage_event_clubs(p_event_id uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select public.event_is_open(p_event_id) and public.is_owner_or_admin(p_event_id)
$$;

-- Add (or promote to) an active club owner.
create function public.put_club_owner(p_club_id uuid, p_user_id uuid) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles where id = p_user_id and status = 'active') then
    raise exception 'Pick someone who has signed in at least once' using errcode = '23514';
  end if;
  insert into public.club_owner_grants (txid) values (txid_current()) on conflict do nothing;
  insert into public.club_members (club_id, user_id, role, status)
  values (p_club_id, p_user_id, 'owner', 'active')
  on conflict (club_id, user_id) do update set role = 'owner', status = 'active';
  delete from public.club_owner_grants where txid = txid_current();
end;
$$;

-- Create a club with its owners and put it in the event. Returns the club's id.
create function public.create_event_club(p_event_id uuid, p_name text, p_owner_ids uuid[]) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_club uuid;
  v_owner uuid;
begin
  if not public.can_manage_event_clubs(p_event_id) then
    raise exception 'Only the event''s Owner or a site Admin can add clubs, while the event is Active' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_name, ''))) = 0 then
    raise exception 'Give the club a name' using errcode = '22023';
  end if;
  if coalesce(array_length(p_owner_ids, 1), 0) = 0 then
    raise exception 'Choose at least one club owner' using errcode = '22023';
  end if;
  begin
    insert into public.clubs (name) values (trim(p_name)) returning id into v_club;
  exception when unique_violation then
    raise exception 'There is already a club with that name. Invite it instead.' using errcode = '23505';
  end;
  foreach v_owner in array p_owner_ids loop
    perform public.put_club_owner(v_club, v_owner);
  end loop;
  insert into public.event_clubs (event_id, club_id, status) values (p_event_id, v_club, 'accepted');
  return v_club;
end;
$$;

-- Add an owner to a club that is in the event.
create function public.add_event_club_owner(p_event_id uuid, p_club_id uuid, p_user_id uuid) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.can_manage_event_clubs(p_event_id) then
    raise exception 'Only the event''s Owner or a site Admin can add club owners, while the event is Active' using errcode = '42501';
  end if;
  if not exists (select 1 from public.event_clubs where event_id = p_event_id and club_id = p_club_id and status = 'accepted') then
    raise exception 'That club isn''t in this event' using errcode = '23514';
  end if;
  perform public.put_club_owner(p_club_id, p_user_id);
end;
$$;

-- Remove an owner from a club that is in the event (they leave the club). Keeps one owner.
create function public.remove_event_club_owner(p_event_id uuid, p_club_id uuid, p_user_id uuid) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.can_manage_event_clubs(p_event_id) then
    raise exception 'Only the event''s Owner or a site Admin can remove club owners, while the event is Active' using errcode = '42501';
  end if;
  if not exists (select 1 from public.event_clubs where event_id = p_event_id and club_id = p_club_id and status = 'accepted') then
    raise exception 'That club isn''t in this event' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.club_members
    where club_id = p_club_id and role = 'owner' and status = 'active' and user_id <> p_user_id
  ) then
    raise exception 'A club needs at least one owner. Add another owner first.' using errcode = '23514';
  end if;
  delete from public.club_members where club_id = p_club_id and user_id = p_user_id and role = 'owner';
end;
$$;

revoke execute on function public.put_club_owner(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.can_manage_event_clubs(uuid) from public, anon;
grant execute on function public.can_manage_event_clubs(uuid) to authenticated;
revoke execute on function public.create_event_club(uuid, text, uuid[]) from public, anon;
grant execute on function public.create_event_club(uuid, text, uuid[]) to authenticated;
revoke execute on function public.add_event_club_owner(uuid, uuid, uuid) from public, anon;
grant execute on function public.add_event_club_owner(uuid, uuid, uuid) to authenticated;
revoke execute on function public.remove_event_club_owner(uuid, uuid, uuid) from public, anon;
grant execute on function public.remove_event_club_owner(uuid, uuid, uuid) to authenticated;
