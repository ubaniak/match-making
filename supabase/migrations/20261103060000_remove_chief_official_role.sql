-- Takes back out the Chief Official account role that 20261103050000 added (Bhavek, 2026-11-03:
-- he meant each event's CO and Deputy, who approve bouts, not a site-wide role for events).
-- Events: Users still request them; only the site Admin approves, denies, cancels, closes or
-- reopens. Run after 20261103050000_event_requests_and_approvals.sql.

-- Anyone given the role goes back to Official.
update public.profiles set role_id = 'official' where role_id = 'chief_official';
update public.invites set role_id = 'official' where role_id = 'chief_official';

-- ---------------------------------------------------------------------------
-- Status changes: site Admin only
-- ---------------------------------------------------------------------------

create or replace function public.touch_event() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  if tg_op = 'UPDATE' then
    if new.status is distinct from old.status then
      if auth.uid() is not null and not public.is_site_admin() then
        raise exception 'Only a site Admin can approve, deny, cancel or close an event' using errcode = '42501';
      end if;
      new.status_changed_at := now();
      new.status_changed_by := auth.uid();
    elsif new.status_note is distinct from old.status_note and auth.uid() is not null and not public.is_site_admin() then
      raise exception 'Only a site Admin can change the decision note' using errcode = '42501';
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

-- Any status to any other: approve, deny, cancel, close, or undo one of those.
-- p_note: optional reason, shown to the Owner (most useful when denying).
create or replace function public.set_event_status(p_event_id uuid, p_status text, p_note text default null) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_old text;
begin
  if not public.is_site_admin() then
    raise exception 'Only a site Admin can approve, deny, cancel or close an event' using errcode = '42501';
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
  update public.events
  set status = p_status, status_note = nullif(trim(p_note), '')
  where id = p_event_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Who sees events and people: back to how it was before 20261103050000
-- ---------------------------------------------------------------------------

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

drop policy "read event members" on public.event_members;
create policy "read event members" on public.event_members for select to authenticated
  using (public.is_site_admin() or public.event_role(event_id) is not null);

create or replace function public.sees_everyone() returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    public.is_site_admin()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.status = 'active' and (
        p.role_id = 'official'
        or exists (select 1 from public.event_members m where m.user_id = p.id and m.role = 'owner')
        or exists (select 1 from public.event_officials o where o.user_id = p.id)
        or exists (select 1 from public.officials o where o.user_id = p.id)
      )
    ),
    false)
$$;

-- ---------------------------------------------------------------------------
-- Approval to-dos go to the site Admins
-- ---------------------------------------------------------------------------

create or replace function public.add_event_request_todo(p_event public.events) returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform public.add_notification(
    public.site_admin_ids(), 'event_status', 'Approve or deny event: ' || p_event.name,
    to_char(p_event.start_date, 'Dy DD Mon YYYY')
      || coalesce(' · ' || p_event.venue, '')
      || coalesce(' · requested by ' || public.person_name(auth.uid()), ''),
    p_event.id, null, null, null, 'event_request:' || p_event.id);
end;
$$;

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
        when 'requested' then 'A site Admin will approve or deny it.' end),
      new.id);
  end if;
  if new.status = 'requested' then
    perform public.add_event_request_todo(new);
  end if;
  return new;
end;
$$;

-- Open approval to-dos that went to anyone but a site Admin are closed; Admins get their own.
update public.notifications n set done_at = now(), read_at = coalesce(read_at, now())
where n.done_at is null and n.action_key like 'event_request:%'
  and not exists (select 1 from public.profiles p where p.id = n.user_id and p.role_id = 'admin');
select public.add_event_request_todo(e) from public.events e
where e.status = 'requested'
  and not exists (
    select 1 from public.notifications n join public.profiles p on p.id = n.user_id and p.role_id = 'admin'
    where n.action_key = 'event_request:' || e.id and n.done_at is null);

-- ---------------------------------------------------------------------------
-- Drop the role
-- ---------------------------------------------------------------------------

drop function if exists public.is_chief_official();
drop function if exists public.chief_official_ids();
delete from public.role_permissions where role_id = 'chief_official' or permission = 'events:approve';
delete from public.roles where id = 'chief_official';
delete from public.permissions where id = 'events:approve';
