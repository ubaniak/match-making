-- Who creates and approves events (Bhavek, 2026-11-03):
--   * Event owners create events. Any signed-in User can request one; they become its Owner
--     and it starts Requested. Only a site Admin can make someone else the Owner.
--   * A Chief Official only approves or denies Requested events. They can't create events.
--     Chief Official is a new account role, set by the site Admin on the Users page. It also
--     works as an Official everywhere else.
--   * The site Admin can do anything: create, approve, deny, and override any decision
--     (reopen a denied or cancelled event, send an approved one back to Requested).
-- New status 'denied' for requests a Chief Official (or the site Admin) turns down.
-- Independent of the migrations in PRs #65, #70 and #71, so it can run before or after them.

-- ---------------------------------------------------------------------------
-- Roles and permissions
-- ---------------------------------------------------------------------------

insert into public.permissions (id, description)
values ('events:approve', 'Approve or deny requested events')
on conflict (id) do update set description = excluded.description;

update public.permissions set description = 'Request an event and become its Owner' where id = 'events:create';

insert into public.roles (id, name, description, is_system)
values ('chief_official', 'Chief Officials', 'Approve or deny requested events. Also an Official.', true)
on conflict (id) do nothing;

-- A Chief Official has everything an Official has, plus approving events.
insert into public.role_permissions (role_id, permission, scope)
select 'chief_official', permission, scope from public.role_permissions where role_id = 'official'
on conflict do nothing;
insert into public.role_permissions (role_id, permission, scope)
values ('chief_official', 'events:approve', 'any'), ('user', 'events:create', 'any')
on conflict do nothing;

create or replace function public.is_chief_official() returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(public.current_role_id() = 'chief_official', false)
$$;

create or replace function public.chief_official_ids() returns uuid[]
language sql stable security definer set search_path = public
as $$
  select coalesce(array_agg(id), '{}') from public.profiles where role_id = 'chief_official' and status = 'active'
$$;

-- ---------------------------------------------------------------------------
-- Events: the 'denied' status and who made the last decision
-- ---------------------------------------------------------------------------

alter table public.events drop constraint events_status_check;
alter table public.events add constraint events_status_check
  check (status in ('requested', 'active', 'done', 'cancelled', 'denied'));

alter table public.events
  add column if not exists status_changed_by uuid references public.profiles (id) on delete set null,
  add column if not exists status_note text check (char_length(status_note) <= 500);

-- Status changes: a site Admin can make any; a Chief Official can only approve or deny a
-- Requested event. Everyone else goes through neither.
create or replace function public.touch_event() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  if tg_op = 'UPDATE' then
    if new.status is distinct from old.status then
      if auth.uid() is not null and not public.is_site_admin()
         and not (public.is_chief_official() and old.status = 'requested' and new.status in ('active', 'denied')) then
        raise exception 'Only a Chief Official or a site Admin can approve or deny an event, and only a site Admin can cancel, close or reopen one'
          using errcode = '42501';
      end if;
      new.status_changed_at := now();
      new.status_changed_by := auth.uid();
    elsif new.status_note is distinct from old.status_note and auth.uid() is not null
          and not public.is_site_admin() and not public.is_chief_official() then
      raise exception 'Only a Chief Official or a site Admin can change the decision note' using errcode = '42501';
    end if;
    if new.timezone is distinct from old.timezone and auth.uid() is not null and not public.is_site_admin() then
      raise exception 'Only a site Admin can change an event''s time zone' using errcode = '42501';
    end if;
    delete from public.event_days
    where event_id = new.id and (day < new.start_date or day > new.end_date);
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Creating events
-- ---------------------------------------------------------------------------

-- Security definer so Users can insert; the checks below are the gate.
create or replace function public.create_event(
  p_name text,
  p_venue text,
  p_start_date date,
  p_end_date date,
  p_owner_id uuid,
  p_timezone text default 'America/Winnipeg'
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_id uuid;
  v_owner uuid := p_owner_id;
begin
  if auth.uid() is null or not public.has_permission('events:create') then
    raise exception 'Only event owners and site Admins can create events' using errcode = '42501';
  end if;
  if not public.is_site_admin() then
    if p_owner_id is not null and p_owner_id <> auth.uid() then
      raise exception 'Only a site Admin can create an event for someone else' using errcode = '42501';
    end if;
    v_owner := auth.uid();
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'Give the event a name' using errcode = '22023';
  end if;
  if v_owner is null or not exists (select 1 from public.profiles where id = v_owner and status = 'active') then
    raise exception 'Pick an Owner who has signed in at least once' using errcode = '23514';
  end if;
  if not public.is_valid_timezone(p_timezone) then
    raise exception 'Pick a time zone for the event' using errcode = '22023';
  end if;

  insert into public.events (name, venue, start_date, end_date, timezone)
  values (trim(p_name), nullif(trim(p_venue), ''), p_start_date, p_end_date, p_timezone)
  returning id into v_id;
  insert into public.event_members (event_id, user_id, role, added_by)
  values (v_id, v_owner, 'owner', auth.uid());
  return v_id;
end;
$$;

-- The person who creates an event becomes its Owner. The member trigger only lets a site Admin
-- set Owners, except for this: the creator's own Owner row on an event made in the same
-- transaction (so nobody can claim an existing event this way).
create or replace function public.check_event_member() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  -- Deleting the event takes its members with it.
  if tg_op = 'DELETE' and not exists (select 1 from public.events where id = old.event_id) then
    return old;
  end if;
  if tg_op = 'INSERT' and new.role = 'owner' and new.user_id = auth.uid()
     and exists (select 1 from public.events e where e.id = new.event_id and e.xmin = pg_current_xact_id()::xid)
     and not exists (select 1 from public.event_members m where m.event_id = new.event_id and m.role = 'owner') then
    return new;
  end if;
  if ((tg_op <> 'INSERT' and old.role = 'owner') or (tg_op <> 'DELETE' and new.role = 'owner'))
     and auth.uid() is not null and not public.is_site_admin() then
    raise exception 'Only a site Admin can change who owns an event' using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;

-- ---------------------------------------------------------------------------
-- Approving, denying and overriding
-- ---------------------------------------------------------------------------

drop function public.set_event_status(uuid, text);

-- p_note: optional reason, shown to the Owner (most useful when denying).
create function public.set_event_status(p_event_id uuid, p_status text, p_note text default null) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_old text;
  v_admin boolean := public.is_site_admin();
begin
  if not v_admin and not public.is_chief_official() then
    raise exception 'Only a Chief Official or a site Admin can approve or deny an event' using errcode = '42501';
  end if;
  if p_status not in ('requested', 'active', 'done', 'cancelled', 'denied') then
    raise exception 'That isn''t an event status' using errcode = '22023';
  end if;
  select status into v_old from public.events where id = p_event_id for update;
  if not found then
    raise exception 'That event no longer exists' using errcode = 'P0002';
  end if;
  if v_old = p_status then
    return;
  end if;
  if not v_admin and not (v_old = 'requested' and p_status in ('active', 'denied')) then
    raise exception 'A Chief Official can only approve or deny a Requested event. Ask a site Admin to change it.'
      using errcode = '42501';
  end if;
  update public.events
  set status = p_status, status_note = nullif(trim(p_note), '')
  where id = p_event_id;
end;
$$;

revoke execute on function public.set_event_status(uuid, text, text) from public, anon;
grant execute on function public.set_event_status(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Chief Officials see every event (they have to see requests to judge them) and
-- the people on them.
-- ---------------------------------------------------------------------------

create or replace function public.can_read_event(p_event_id uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select public.is_site_admin()
    or public.is_chief_official()
    or public.event_role(p_event_id) is not null
    or public.event_official_role(p_event_id) is not null
    or public.is_accepted_official(p_event_id)
    or public.in_event_club(p_event_id)
    or exists (
      select 1 from public.events e
      where e.id = p_event_id and e.status in ('active', 'done') and public.has_permission('pages:read')
    )
$$;

drop policy "read event members" on public.event_members;
create policy "read event members" on public.event_members for select to authenticated
  using (public.is_site_admin() or public.is_chief_official() or public.event_role(event_id) is not null);

create or replace function public.sees_everyone() returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    public.is_site_admin()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.status = 'active' and (
        p.role_id in ('official', 'chief_official')
        or exists (select 1 from public.event_members m where m.user_id = p.id and m.role = 'owner')
        or exists (select 1 from public.event_officials o where o.user_id = p.id)
        or exists (select 1 from public.officials o where o.user_id = p.id)
      )
    ),
    false)
$$;

-- ---------------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------------

-- A to-do for every Chief Official (the site Admins when there are none) to approve or deny.
create or replace function public.add_event_request_todo(p_event public.events) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_people uuid[] := public.chief_official_ids();
begin
  if cardinality(v_people) = 0 then
    v_people := public.site_admin_ids();
  end if;
  perform public.add_notification(
    v_people, 'event_status', 'Approve or deny event: ' || p_event.name,
    to_char(p_event.start_date, 'Dy DD Mon YYYY')
      || coalesce(' · ' || p_event.venue, '')
      || coalesce(' · requested by ' || public.person_name(auth.uid()), ''),
    p_event.id, null, null, null, 'event_request:' || p_event.id);
end;
$$;

create or replace function public.notify_event_requested() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.status = 'requested' then
    perform public.add_event_request_todo(new);
  end if;
  return new;
end;
$$;

drop trigger if exists events_notify_requested on public.events;
create trigger events_notify_requested
  after insert on public.events
  for each row execute function public.notify_event_requested();

create or replace function public.notify_event_status() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if old.status = 'requested' then
    perform public.resolve_notifications('event_request:' || new.id);
  end if;
  -- Events closing on their own after the end date aren't news.
  if new.status in ('active', 'cancelled', 'denied', 'requested') then
    perform public.add_notification(
      public.event_owner_ids(new.id), 'event_status',
      new.name || case new.status
        when 'active' then ' was approved'
        when 'denied' then ' was denied'
        when 'requested' then ' is waiting for approval again'
        else ' was cancelled' end,
      coalesce(new.status_note, case new.status
        when 'active' then 'It is on the public page, and you can invite clubs and officials.'
        when 'denied' then 'Ask a site Admin if you think this is a mistake.'
        when 'requested' then 'A Chief Official will approve or deny it.' end),
      new.id);
  end if;
  if new.status = 'requested' then
    perform public.add_event_request_todo(new);
  end if;
  return new;
end;
$$;

-- Requests already waiting become to-dos for the Chief Officials (or site Admins).
select public.add_event_request_todo(e) from public.events e
where e.status = 'requested'
  and not exists (select 1 from public.notifications n where n.action_key = 'event_request:' || e.id and n.done_at is null);

revoke execute on function public.is_chief_official() from public, anon;
grant execute on function public.is_chief_official() to authenticated;
revoke execute on function public.chief_official_ids() from public, anon, authenticated;
revoke execute on function public.add_event_request_todo(public.events) from public, anon, authenticated;
