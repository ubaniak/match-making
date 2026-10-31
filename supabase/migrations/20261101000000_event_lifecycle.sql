-- Stage 1 of plan/events.md: the event lifecycle.
--
--   * Events have a status: requested, active, done or cancelled.
--   * Only site Admins create events (name, dates, Owner). New events start as Requested.
--   * Site Admins approve (Requested -> Active), cancel, and mark events Done. Events also turn
--     Done on their own the day after their end date (pg_cron job below).
--   * The Owner edits the details, uploads an optional poster, and sets each day's times:
--     one weigh-in (start and end, at least 2 hours, ending at least 3 hours before that day's
--     first bout) and one or more bout sessions. save_event_times refuses times that break this.
--   * There is no event-level Admin any more: only site Admins have admin powers.
--     Event roles are now Owner, Coach and Viewer.
--   * Anyone, signed in or not, can list upcoming Active events with list_public_events().

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create function public.is_site_admin() returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(public.current_role_id() = 'admin', false)
$$;

-- ---------------------------------------------------------------------------
-- Status and poster
-- ---------------------------------------------------------------------------

alter table public.events
  add column status text not null default 'requested'
    check (status in ('requested', 'active', 'done', 'cancelled')),
  add column status_changed_at timestamptz,
  add column poster_path text;

-- Events made before statuses existed were already in use, so they count as approved.
update public.events set status = case when end_date < current_date then 'done' else 'active' end;

-- ---------------------------------------------------------------------------
-- No event-level Admin. Existing event Admins become Coaches so they keep their athletes.
-- ---------------------------------------------------------------------------

drop policy "members read events" on public.events;
drop policy "users create events" on public.events;
drop policy "admins edit events" on public.events;
drop policy "owner deletes events" on public.events;
drop policy "members read event days" on public.event_days;
drop policy "admins manage event days" on public.event_days;
drop policy "members read event members" on public.event_members;
drop policy "admins manage event members" on public.event_members;
drop policy "members read event athletes" on public.event_athletes;
drop policy "coaches add event athletes" on public.event_athletes;
drop policy "remove event athletes" on public.event_athletes;

update public.event_members set role = 'coach' where role = 'admin';
alter table public.event_members drop constraint event_members_role_check;
alter table public.event_members add constraint event_members_role_check check (role in ('owner', 'coach', 'viewer'));

-- The signed-in user's role on an event ('owner', 'coach', 'viewer' or null).
-- Site Admins are no longer reported as Owner; policies check is_site_admin() separately.
create or replace function public.event_role(p_event_id uuid) returns text
language sql stable security definer set search_path = public
as $$
  select m.role from public.event_members m
  join public.profiles p on p.id = m.user_id and p.status = 'active'
  where m.event_id = p_event_id and m.user_id = auth.uid()
$$;

-- Can the signed-in user change this event's details, times and poster?
-- Site Admins always can. The Owner can while the event is Requested or Active and not over.
create function public.can_edit_event(p_event_id uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select public.is_site_admin() or exists (
    select 1 from public.events e
    where e.id = p_event_id
      and e.status in ('requested', 'active')
      and e.end_date >= current_date
      and public.event_role(e.id) = 'owner'
  )
$$;

-- Only Active events that aren't over can take on new people and athletes.
create function public.event_is_open(p_event_id uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.events
    where id = p_event_id and status = 'active' and end_date >= current_date
  )
$$;

-- ---------------------------------------------------------------------------
-- Rules on events and members
-- ---------------------------------------------------------------------------

-- Only site Admins change an event's status. Changes made by the database itself
-- (the SQL editor, the nightly job) have no signed-in user and are allowed.
create or replace function public.touch_event() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  if tg_op = 'UPDATE' then
    if new.status is distinct from old.status then
      if auth.uid() is not null and not public.is_site_admin() then
        raise exception 'Only a site Admin can approve, cancel or close an event' using errcode = '42501';
      end if;
      new.status_changed_at := now();
    end if;
    delete from public.event_days
    where event_id = new.id and (day < new.start_date or day > new.end_date);
  end if;
  return new;
end;
$$;

-- Events no longer pick up their creator as Owner: create_event names the Owner.
drop trigger add_event_owner on public.events;
drop function public.add_event_owner();

-- Only site Admins give or take away ownership.
create or replace function public.check_event_member() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  -- Deleting the event takes its members with it.
  if tg_op = 'DELETE' and not exists (select 1 from public.events where id = old.event_id) then
    return old;
  end if;
  if ((tg_op <> 'INSERT' and old.role = 'owner') or (tg_op <> 'DELETE' and new.role = 'owner'))
     and auth.uid() is not null and not public.is_site_admin() then
    raise exception 'Only a site Admin can change who owns an event' using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;

-- Hand an event to another user. The old Owner stays on as a Viewer.
create or replace function public.transfer_event_ownership(p_event_id uuid, p_user_id uuid) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_site_admin() then
    raise exception 'Only a site Admin can change who owns an event' using errcode = '42501';
  end if;
  if not exists (select 1 from public.events where id = p_event_id) then
    raise exception 'That event no longer exists' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id and status = 'active') then
    raise exception 'That user can''t own events' using errcode = '23514';
  end if;

  update public.event_members set role = 'viewer'
  where event_id = p_event_id and role = 'owner' and user_id <> p_user_id;
  insert into public.event_members (event_id, user_id, role, added_by)
  values (p_event_id, p_user_id, 'owner', auth.uid())
  on conflict (event_id, user_id) do update set role = 'owner';
end;
$$;

-- ---------------------------------------------------------------------------
-- Creating events and changing their status (site Admins only)
-- ---------------------------------------------------------------------------

delete from public.role_permissions where permission = 'events:create';
update public.permissions set description = 'Create events (site Admins only)' where id = 'events:create';
drop function public.save_event(uuid, text, text, date, date, jsonb, uuid);

-- Create a Requested event owned by p_owner_id. Returns the new event's id.
create function public.create_event(
  p_name text,
  p_venue text,
  p_start_date date,
  p_end_date date,
  p_owner_id uuid
) returns uuid
language plpgsql security invoker set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.is_site_admin() then
    raise exception 'Only a site Admin can create events' using errcode = '42501';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'Give the event a name' using errcode = '22023';
  end if;
  if p_owner_id is null or not exists (select 1 from public.profiles where id = p_owner_id and status = 'active') then
    raise exception 'Pick an Owner who has signed in at least once' using errcode = '23514';
  end if;

  insert into public.events (name, venue, start_date, end_date)
  values (trim(p_name), nullif(trim(p_venue), ''), p_start_date, p_end_date)
  returning id into v_id;
  insert into public.event_members (event_id, user_id, role, added_by)
  values (v_id, p_owner_id, 'owner', auth.uid());
  return v_id;
end;
$$;

-- Approve (requested -> active), cancel (requested/active -> cancelled) or close
-- (requested/active -> done) an event.
create function public.set_event_status(p_event_id uuid, p_status text) returns void
language plpgsql security invoker set search_path = public
as $$
declare
  v_old text;
begin
  if not public.is_site_admin() then
    raise exception 'Only a site Admin can approve, cancel or close an event' using errcode = '42501';
  end if;
  select status into v_old from public.events where id = p_event_id for update;
  if not found then
    raise exception 'That event no longer exists' using errcode = 'P0002';
  end if;
  if v_old = p_status then
    return;
  end if;
  if v_old in ('done', 'cancelled') then
    raise exception 'This event is already %', initcap(v_old) using errcode = '22023';
  end if;
  if p_status not in ('active', 'done', 'cancelled') or (p_status = 'active' and v_old <> 'requested') then
    raise exception 'An event can''t go from % to %', initcap(v_old), initcap(p_status) using errcode = '22023';
  end if;
  update public.events set status = p_status where id = p_event_id;
end;
$$;

-- Events turn Done the day after their end date.
create function public.close_finished_events() returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_count integer;
begin
  update public.events set status = 'done'
  where status in ('requested', 'active') and end_date < current_date;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

select public.close_finished_events();

-- Run it every morning at 08:05 UTC (early morning across Canada). Needs pg_cron, which
-- Supabase includes; if it can't be turned on, the app still shows past events as Done.
do $$
begin
  create extension if not exists pg_cron;
  perform cron.schedule('close-finished-events', '5 8 * * *', 'select public.close_finished_events()');
exception when others then
  raise notice 'Could not schedule the nightly Done job (%). Turn on pg_cron under Database > Extensions, then run: select cron.schedule(''close-finished-events'', ''5 8 * * *'', ''select public.close_finished_events()'');', sqlerrm;
end;
$$;

-- ---------------------------------------------------------------------------
-- Day times: one weigh-in per day (start and end) and one or more bout sessions
-- ---------------------------------------------------------------------------

alter table public.event_days rename column weigh_in_time to weigh_in_start;
alter table public.event_days add column weigh_in_end time;
-- Old schedules only had a weigh-in start; give them the shortest allowed weigh-in.
update public.event_days set weigh_in_end = weigh_in_start + interval '2 hours';
alter table public.event_days alter column weigh_in_end set not null;
alter table public.event_days add constraint event_days_weigh_in_length
  check (weigh_in_end - weigh_in_start >= interval '2 hours') not valid;

create table public.event_bout_sessions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null,
  day date not null,
  starts_at time not null,
  label text check (label is null or length(label) <= 40),
  foreign key (event_id, day) references public.event_days (event_id, day) on delete cascade on update cascade,
  unique (event_id, day, starts_at)
);

insert into public.event_bout_sessions (event_id, day, starts_at)
select event_id, day, bouts_time from public.event_days;
alter table public.event_days drop column bouts_time;

-- Replace an event's day times. p_days is a JSON array, one entry per day that has bouts:
--   {"day": "YYYY-MM-DD", "weigh_in_start": "HH:MM", "weigh_in_end": "HH:MM",
--    "sessions": [{"starts_at": "HH:MM", "label": "Evening"}, ...]}
-- Days left out have no bouts. Times that break the weigh-in rules are refused.
create function public.save_event_times(p_event_id uuid, p_days jsonb) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_event public.events%rowtype;
  v_entry jsonb;
  v_day date;
  v_label text;
  v_start time;
  v_end time;
  v_first time;
  v_seen date[] := '{}';
begin
  select * into v_event from public.events where id = p_event_id;
  if not found then
    raise exception 'That event no longer exists' using errcode = 'P0002';
  end if;
  if not public.can_edit_event(p_event_id) then
    raise exception 'Only the event''s Owner or a site Admin can change its times, and only while it is Requested or Active'
      using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_days, '[]')) <> 'array' then
    raise exception 'Day times must be a list' using errcode = '22023';
  end if;

  for v_entry in select * from jsonb_array_elements(coalesce(p_days, '[]')) loop
    v_day := (v_entry ->> 'day')::date;
    v_label := to_char(v_day, 'Dy DD Mon');
    if v_day is null or v_day < v_event.start_date or v_day > v_event.end_date then
      raise exception '% is not one of the event''s days', coalesce(v_label, 'A day') using errcode = '22023';
    end if;
    if v_day = any (v_seen) then
      raise exception '% is listed twice', v_label using errcode = '22023';
    end if;
    v_seen := v_seen || v_day;

    v_start := nullif(v_entry ->> 'weigh_in_start', '')::time;
    v_end := nullif(v_entry ->> 'weigh_in_end', '')::time;
    if v_start is null or v_end is null then
      raise exception 'Give the weigh-in on % a start and an end time', v_label using errcode = '22023';
    end if;
    if v_end - v_start < interval '2 hours' then
      raise exception 'The weigh-in on % must last at least 2 hours', v_label using errcode = '22023';
    end if;

    if jsonb_typeof(v_entry -> 'sessions') <> 'array' or jsonb_array_length(v_entry -> 'sessions') = 0 then
      raise exception 'Add at least one bout session on %', v_label using errcode = '22023';
    end if;
    if exists (select 1 from jsonb_array_elements(v_entry -> 'sessions') s where nullif(s ->> 'starts_at', '') is null) then
      raise exception 'Every bout session on % needs a start time', v_label using errcode = '22023';
    end if;
    if (select count(distinct (s ->> 'starts_at')::time) from jsonb_array_elements(v_entry -> 'sessions') s)
       <> jsonb_array_length(v_entry -> 'sessions') then
      raise exception 'Two bout sessions on % start at the same time', v_label using errcode = '22023';
    end if;
    select min((s ->> 'starts_at')::time) into v_first from jsonb_array_elements(v_entry -> 'sessions') s;
    if v_first - v_end < interval '3 hours' then
      raise exception 'The weigh-in on % must end at least 3 hours before the first bout (%)', v_label, to_char(v_first, 'HH24:MI')
        using errcode = '22023';
    end if;
  end loop;

  delete from public.event_days where event_id = p_event_id;
  insert into public.event_days (event_id, day, weigh_in_start, weigh_in_end)
  select p_event_id, (d ->> 'day')::date, (d ->> 'weigh_in_start')::time, (d ->> 'weigh_in_end')::time
  from jsonb_array_elements(coalesce(p_days, '[]')) d;
  insert into public.event_bout_sessions (event_id, day, starts_at, label)
  select p_event_id, (d ->> 'day')::date, (s ->> 'starts_at')::time, nullif(trim(s ->> 'label'), '')
  from jsonb_array_elements(coalesce(p_days, '[]')) d, jsonb_array_elements(d -> 'sessions') s;

  update public.events set updated_at = now() where id = p_event_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Public page: upcoming Active events, no sign-in. Only public details, never people.
-- ---------------------------------------------------------------------------

create function public.list_public_events() returns jsonb
language sql stable security definer set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', e.id,
    'name', e.name,
    'venue', e.venue,
    'start_date', e.start_date,
    'end_date', e.end_date,
    'poster_path', e.poster_path,
    'days', coalesce((
      select jsonb_agg(jsonb_build_object(
        'day', d.day,
        'weigh_in_start', to_char(d.weigh_in_start, 'HH24:MI'),
        'weigh_in_end', to_char(d.weigh_in_end, 'HH24:MI'),
        'sessions', coalesce((
          select jsonb_agg(jsonb_build_object('starts_at', to_char(s.starts_at, 'HH24:MI'), 'label', s.label) order by s.starts_at)
          from public.event_bout_sessions s where s.event_id = d.event_id and s.day = d.day
        ), '[]')
      ) order by d.day)
      from public.event_days d where d.event_id = e.id
    ), '[]')
  ) order by e.start_date, e.name), '[]')
  from public.events e
  where e.status = 'active' and e.end_date >= current_date
$$;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.event_bout_sessions enable row level security;

create policy "read events" on public.events for select to authenticated
  using (public.is_site_admin() or public.event_role(id) is not null);
create policy "site admins create events" on public.events for insert to authenticated
  with check (public.is_site_admin());
create policy "owners edit events" on public.events for update to authenticated
  using (public.can_edit_event(id))
  with check (public.can_edit_event(id));
create policy "site admins delete events" on public.events for delete to authenticated
  using (public.is_site_admin());

-- Times are written only through save_event_times.
create policy "read event days" on public.event_days for select to authenticated
  using (public.is_site_admin() or public.event_role(event_id) is not null);
create policy "read bout sessions" on public.event_bout_sessions for select to authenticated
  using (public.is_site_admin() or public.event_role(event_id) is not null);

create policy "read event members" on public.event_members for select to authenticated
  using (public.is_site_admin() or public.event_role(event_id) is not null);
-- Site Admins set the Owner at any time. People are added only once the event is Active.
create policy "add event members" on public.event_members for insert to authenticated
  with check (
    (public.is_site_admin() and role = 'owner')
    or (public.event_is_open(event_id) and (public.is_site_admin() or public.event_role(event_id) = 'owner'))
  );
create policy "change event members" on public.event_members for update to authenticated
  using (public.is_site_admin() or (public.event_role(event_id) = 'owner' and public.can_edit_event(event_id)))
  with check (public.is_site_admin() or (public.event_role(event_id) = 'owner' and public.can_edit_event(event_id)));
create policy "remove event members" on public.event_members for delete to authenticated
  using (public.is_site_admin() or (public.event_role(event_id) = 'owner' and public.can_edit_event(event_id)));

create policy "read event athletes" on public.event_athletes for select to authenticated
  using (public.is_site_admin() or public.event_role(event_id) is not null);
create policy "add event athletes" on public.event_athletes for insert to authenticated
  with check (
    public.event_is_open(event_id) and added_by = auth.uid()
    and (public.is_site_admin() or public.event_role(event_id) in ('owner', 'coach'))
  );
create policy "remove event athletes" on public.event_athletes for delete to authenticated
  using (
    public.is_site_admin()
    or (public.event_role(event_id) = 'owner' and public.can_edit_event(event_id))
    or (public.event_role(event_id) = 'coach' and added_by = auth.uid() and public.event_is_open(event_id))
  );

-- ---------------------------------------------------------------------------
-- Posters: a public Storage bucket. Files live under "<event id>/...".
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('event-posters', 'event-posters', true, 5242880, array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
on conflict (id) do nothing;

-- Can the signed-in user manage the poster file at this path?
create function public.can_edit_poster(p_name text) returns boolean
language plpgsql stable security definer set search_path = public
as $$
begin
  return public.can_edit_event(split_part(p_name, '/', 1)::uuid);
exception when invalid_text_representation then
  return false;
end;
$$;

create policy "event posters: editors read" on storage.objects for select to authenticated
  using (bucket_id = 'event-posters' and public.can_edit_poster(name));
create policy "event posters: editors upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'event-posters' and public.can_edit_poster(name));
create policy "event posters: editors replace" on storage.objects for update to authenticated
  using (bucket_id = 'event-posters' and public.can_edit_poster(name));
create policy "event posters: editors delete" on storage.objects for delete to authenticated
  using (bucket_id = 'event-posters' and public.can_edit_poster(name));

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke execute on function public.create_event(text, text, date, date, uuid) from public, anon;
grant execute on function public.create_event(text, text, date, date, uuid) to authenticated;
revoke execute on function public.set_event_status(uuid, text) from public, anon;
grant execute on function public.set_event_status(uuid, text) to authenticated;
revoke execute on function public.save_event_times(uuid, jsonb) from public, anon;
grant execute on function public.save_event_times(uuid, jsonb) to authenticated;
grant execute on function public.list_public_events() to anon, authenticated;
revoke execute on function public.close_finished_events() from public, anon, authenticated;
