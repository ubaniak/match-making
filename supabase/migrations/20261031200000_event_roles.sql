-- Coaches stop being a kind of account. Everyone who signs in is a User, and what they can do
-- on an event comes from their role on that event: Owner, Admin, Coach or Viewer.
--
--   Owner   one per event. Everything below, plus delete the event and hand ownership to someone else.
--   Admin   edit the event's details and times, add and remove members (not the Owner), add and remove athletes.
--   Coach   view the event, add athletes, and remove the athletes they added.
--   Viewer  view the event.
--
-- An event is only visible to its members and to site Admins (users:manage), who can do everything.
-- Any User can create an event and becomes its Owner.

-- ---------------------------------------------------------------------------
-- Users replace Coaches as the everyday account role
-- ---------------------------------------------------------------------------

insert into public.roles (id, name, description, is_system)
values ('user', 'Users', 'Signed-in members. What they can do on an event depends on their role there.', true);

insert into public.role_permissions (role_id, permission, scope)
select 'user', permission, scope from public.role_permissions where role_id = 'coach';

update public.profiles set role_id = 'user' where role_id = 'coach';
update public.invites set role_id = 'user' where role_id = 'coach';
delete from public.roles where id = 'coach';

-- Event access now comes from membership, not from account-level permissions.
delete from public.permissions where id in ('events:read', 'events:manage');
update public.permissions set description = 'Create an event (and become its Owner)' where id = 'events:create';
insert into public.role_permissions (role_id, permission, scope) values ('user', 'events:create', 'any');

-- Users need to see each other to add people to events and to see who looks after an athlete.
drop policy "members read coach profiles" on public.profiles;
create policy "members read user profiles" on public.profiles for select to authenticated
  using (public.has_permission('pages:read'));

-- ---------------------------------------------------------------------------
-- Event members
-- ---------------------------------------------------------------------------

create table public.event_members (
  event_id uuid not null references public.events (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'coach', 'viewer')),
  added_by uuid default auth.uid() references public.profiles (id) on delete set null,
  added_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

create unique index event_members_one_owner on public.event_members (event_id) where role = 'owner';
create index event_members_user_idx on public.event_members (user_id);

-- Existing events keep their coach, now as Owner.
insert into public.event_members (event_id, user_id, role, added_by)
select id, owner_id, 'owner', owner_id from public.events;

drop trigger check_event on public.events;
drop function public.check_event();
drop policy "edit events" on public.events;
drop policy "read events" on public.events;
drop policy "create events" on public.events;
drop policy "delete events" on public.events;
drop policy "read event days" on public.event_days;
drop policy "manage event days" on public.event_days;
drop policy "read event athletes" on public.event_athletes;
drop policy "add event athletes" on public.event_athletes;
drop policy "remove event athletes" on public.event_athletes;
drop function public.save_event(uuid, text, text, date, date, uuid, jsonb);
drop function public.event_owner(uuid);
alter table public.events drop column owner_id;

-- The signed-in user's role on an event: 'owner', 'admin', 'coach', 'viewer', or null.
-- Site Admins count as Owner everywhere.
create function public.event_role(p_event_id uuid) returns text
language sql stable security definer set search_path = public
as $$
  select case
    when public.has_permission('users:manage') then 'owner'
    else (
      select m.role from public.event_members m
      join public.profiles p on p.id = m.user_id and p.status = 'active'
      where m.event_id = p_event_id and m.user_id = auth.uid()
    )
  end
$$;

-- ---------------------------------------------------------------------------
-- Rules
-- ---------------------------------------------------------------------------

create function public.touch_event() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  if tg_op = 'UPDATE' then
    delete from public.event_days
    where event_id = new.id and (day < new.start_date or day > new.end_date);
  end if;
  return new;
end;
$$;

create trigger touch_event
  before insert or update on public.events
  for each row execute function public.touch_event();

-- Whoever creates an event owns it.
create function public.add_event_owner() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is not null then
    insert into public.event_members (event_id, user_id, role, added_by)
    values (new.id, auth.uid(), 'owner', auth.uid());
  end if;
  return new;
end;
$$;

create trigger add_event_owner
  after insert on public.events
  for each row execute function public.add_event_owner();

-- Admins manage Coaches, Viewers and other Admins. Only the Owner (or a site Admin) can
-- give or take away ownership, and that goes through transfer_event_ownership.
create function public.check_event_member() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if current_setting('app.transferring_ownership', true) = 'on' then
    return coalesce(new, old);
  end if;
  -- Deleting the event takes its members with it.
  if tg_op = 'DELETE' and not exists (select 1 from public.events where id = old.event_id) then
    return old;
  end if;
  if (tg_op <> 'INSERT' and old.role = 'owner') or (tg_op <> 'DELETE' and new.role = 'owner') then
    -- The creating insert from add_event_owner is the one exception.
    if not (tg_op = 'INSERT' and new.user_id = auth.uid()
            and not exists (select 1 from public.event_members where event_id = new.event_id)) then
      raise exception 'Use "Make owner" to change who owns an event' using errcode = '42501';
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

create trigger check_event_member
  before insert or update or delete on public.event_members
  for each row execute function public.check_event_member();

-- Hand an event to another user. The old Owner stays on as an Admin.
create function public.transfer_event_ownership(p_event_id uuid, p_user_id uuid) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if public.event_role(p_event_id) is distinct from 'owner' then
    raise exception 'Only the event''s Owner can hand it over' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id and status = 'active') then
    raise exception 'That user can''t own events' using errcode = '23514';
  end if;

  perform set_config('app.transferring_ownership', 'on', true);
  update public.event_members set role = 'admin' where event_id = p_event_id and role = 'owner';
  insert into public.event_members (event_id, user_id, role, added_by)
  values (p_event_id, p_user_id, 'owner', auth.uid())
  on conflict (event_id, user_id) do update set role = 'owner';
  perform set_config('app.transferring_ownership', 'off', true);
end;
$$;

-- Create or update an event and its daily schedule in one go. Runs as the caller, so RLS applies.
-- p_days is a JSON array of {"day": "YYYY-MM-DD", "weigh_in_time": "HH:MM", "bouts_time": "HH:MM"},
-- with exactly one entry for each day from start to end.
create function public.save_event(
  p_id uuid,
  p_name text,
  p_venue text,
  p_start_date date,
  p_end_date date,
  p_days jsonb
) returns uuid
language plpgsql security invoker set search_path = public
as $$
declare
  v_id uuid := p_id;
  day_count int;
begin
  select count(distinct (d ->> 'day')::date) into day_count
  from jsonb_array_elements(p_days) d
  where (d ->> 'day')::date between p_start_date and p_end_date
    and nullif(d ->> 'weigh_in_time', '') is not null
    and nullif(d ->> 'bouts_time', '') is not null;
  if day_count <> (p_end_date - p_start_date + 1) or jsonb_array_length(p_days) <> day_count then
    raise exception 'Every day of the event needs a weigh-in time and a bout time' using errcode = '22023';
  end if;

  if v_id is null then
    -- Pick the id first: the new row isn't visible to its creator until the owner row exists.
    v_id := gen_random_uuid();
    insert into public.events (id, name, venue, start_date, end_date)
    values (v_id, trim(p_name), nullif(trim(p_venue), ''), p_start_date, p_end_date);
  else
    update public.events
    set name = trim(p_name), venue = nullif(trim(p_venue), ''), start_date = p_start_date, end_date = p_end_date
    where id = v_id;
    if not found then
      raise exception 'You can''t edit that event' using errcode = '42501';
    end if;
  end if;

  delete from public.event_days where event_id = v_id;
  insert into public.event_days (event_id, day, weigh_in_time, bouts_time)
  select v_id, (d ->> 'day')::date, (d ->> 'weigh_in_time')::time, (d ->> 'bouts_time')::time
  from jsonb_array_elements(p_days) d;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.event_members enable row level security;

create policy "members read events" on public.events for select to authenticated
  using (public.event_role(id) is not null);
create policy "users create events" on public.events for insert to authenticated
  with check (public.has_permission('events:create'));
create policy "admins edit events" on public.events for update to authenticated
  using (public.event_role(id) in ('owner', 'admin'))
  with check (public.event_role(id) in ('owner', 'admin'));
create policy "owner deletes events" on public.events for delete to authenticated
  using (public.event_role(id) = 'owner');

create policy "members read event days" on public.event_days for select to authenticated
  using (public.event_role(event_id) is not null);
create policy "admins manage event days" on public.event_days for all to authenticated
  using (public.event_role(event_id) in ('owner', 'admin'))
  with check (public.event_role(event_id) in ('owner', 'admin'));

create policy "members read event members" on public.event_members for select to authenticated
  using (public.event_role(event_id) is not null);
create policy "admins manage event members" on public.event_members for all to authenticated
  using (public.event_role(event_id) in ('owner', 'admin'))
  with check (public.event_role(event_id) in ('owner', 'admin'));

create policy "members read event athletes" on public.event_athletes for select to authenticated
  using (public.event_role(event_id) is not null);
create policy "coaches add event athletes" on public.event_athletes for insert to authenticated
  with check (public.event_role(event_id) in ('owner', 'admin', 'coach') and added_by = auth.uid());
create policy "remove event athletes" on public.event_athletes for delete to authenticated
  using (
    public.event_role(event_id) in ('owner', 'admin')
    or (public.event_role(event_id) = 'coach' and added_by = auth.uid())
  );

revoke execute on function public.save_event(uuid, text, text, date, date, jsonb) from public, anon;
grant execute on function public.save_event(uuid, text, text, date, date, jsonb) to authenticated;
revoke execute on function public.transfer_event_ownership(uuid, uuid) from public, anon;
grant execute on function public.transfer_event_ownership(uuid, uuid) to authenticated;
revoke execute on function public.touch_event() from public, anon, authenticated;
revoke execute on function public.add_event_owner() from public, anon, authenticated;
revoke execute on function public.check_event_member() from public, anon, authenticated;
