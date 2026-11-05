-- Migration 60: new clubs need a site Admin's approval.
--
-- Bhavek (2026-11-05): if someone wants to invite a club that isn't in the app yet, they can't add
-- it themselves. They send a request (club name and its owner's name and email, both required) and a site Admin approves it.
--
--   * create_event_club (an event Owner making a club on the spot, migration 23) is now for site
--     Admins only. Everyone else picks from the clubs already in the app.
--   * request_club: anyone signed in asks for a new club, with a contact name and email and an
--     optional note. When asked from an event they run, the club is invited to that event once
--     it is approved. Every site Admin gets a to-do.
--   * decide_club_request (site Admin): approve (the club is made, the contact becomes its Owner,
--     and it is invited to the event it was asked for) or deny with a reason. The person who asked
--     is told either way.
--   * withdraw_club_request: the person who asked takes back a request still waiting.
--
-- Run after migration 59 (20261105010000_invite_email_details.sql), before deploying the app.

-- ---------------------------------------------------------------------------
-- Requests
-- ---------------------------------------------------------------------------

create table public.club_requests (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  contact_name text not null check (length(trim(contact_name)) > 0),
  contact_email text not null check (contact_email = lower(contact_email)),
  note text,
  -- The event it was asked from: the new club is invited to it on approval.
  event_id uuid references public.events (id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied', 'withdrawn')),
  requested_by uuid references public.profiles (id) on delete set null default auth.uid(),
  requested_at timestamptz not null default now(),
  decided_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  -- The club made on approval.
  club_id uuid references public.clubs (id) on delete set null
);

-- One open request per club name.
create unique index club_requests_one_open_name on public.club_requests (lower(trim(name))) where status = 'pending';
create index club_requests_requested_by_idx on public.club_requests (requested_by, requested_at desc);

alter table public.club_requests enable row level security;

-- Site Admins see every request; everyone else sees their own. Changes go through the functions
-- below; a site Admin may also delete a request.
create policy "read own or all club requests" on public.club_requests for select to authenticated
  using (public.is_site_admin() or requested_by = auth.uid());
create policy "site admins delete club requests" on public.club_requests for delete to authenticated
  using (public.is_site_admin());
grant select, delete on public.club_requests to authenticated;

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'availability', 'invitation_answer', 'official_role',
  'bout_approval', 'bout_decision', 'bout_cancelled', 'bout_comment', 'bout_review',
  'join_request', 'join_answer', 'late_entry', 'late_entry_answer',
  'transfer', 'transfer_answer', 'member_request', 'member_answer',
  'event_role', 'event_status',
  'club_invite', 'club_invite_answer',
  'official_plan', 'bout_conflict',
  'club_request', 'club_request_answer'
));

-- ---------------------------------------------------------------------------
-- Only site Admins make clubs on an event
-- ---------------------------------------------------------------------------

create or replace function public.create_event_club(p_event_id uuid, p_name text, p_owner_ids uuid[]) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_club uuid;
  v_owner uuid;
begin
  if not coalesce(public.is_site_admin(), false) then
    raise exception 'Only a site Admin can add a new club. Use "Request a new club" instead.' using errcode = '42501';
  end if;
  if not public.event_is_open(p_event_id) then
    raise exception 'Clubs can be added once the event is Active' using errcode = '22023';
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

-- ---------------------------------------------------------------------------
-- Asking for a new club
-- ---------------------------------------------------------------------------

create function public.request_club(
  p_name text, p_contact_name text, p_contact_email text,
  p_note text default null, p_event_id uuid default null
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_name text := trim(coalesce(p_name, ''));
  v_contact text := trim(coalesce(p_contact_name, ''));
  v_email text := lower(trim(coalesce(p_contact_email, '')));
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_id uuid;
  v_existing text;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and status = 'active') then
    raise exception 'Sign in to ask for a new club' using errcode = '42501';
  end if;
  if p_event_id is not null and not public.can_manage_event_clubs(p_event_id) then
    raise exception 'Only the event''s Owner can ask for a club for this event, while it is Active' using errcode = '42501';
  end if;
  if v_name = '' then
    raise exception 'Give the club a name' using errcode = '22023';
  end if;
  if v_contact = '' then
    raise exception 'Give the club owner''s name' using errcode = '22023';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Give the club owner''s email address (it must look like name@example.com)' using errcode = '22023';
  end if;
  select name into v_existing from public.clubs where lower(trim(name)) = lower(v_name);
  if v_existing is not null then
    raise exception '% is already in the app. Invite it instead.', v_existing using errcode = '23505';
  end if;
  begin
    insert into public.club_requests (name, contact_name, contact_email, note, event_id, requested_by)
    values (v_name, v_contact, v_email, v_note, p_event_id, auth.uid())
    returning id into v_id;
  exception when unique_violation then
    raise exception 'Someone has already asked for %. A site Admin will look at it soon.', v_name using errcode = '23505';
  end;

  perform public.add_notification(
    public.site_admin_ids(), 'club_request',
    coalesce(public.person_name(auth.uid()), 'Someone') || ' asked for a new club: ' || v_name,
    'Owner: ' || v_contact || ' (' || v_email || ')'
      || coalesce('. For ' || public.event_name(p_event_id), '')
      || coalesce('. ' || v_note, ''),
    null, null, null, null, 'club-request:' || v_id);
  return v_id;
end;
$$;

-- The person who asked takes back a request that is still waiting.
create function public.withdraw_club_request(p_request_id uuid) returns void
language plpgsql security definer set search_path = public
as $$
begin
  update public.club_requests set status = 'withdrawn', decided_by = auth.uid(), decided_at = now()
  where id = p_request_id and status = 'pending'
    and (requested_by = auth.uid() or coalesce(public.is_site_admin(), false));
  if not found then
    raise exception 'That request isn''t waiting any more' using errcode = 'P0002';
  end if;
  perform public.resolve_notifications('club-request:' || p_request_id);
end;
$$;

-- A site Admin approves (optionally fixing the name) or denies a request. Returns
-- { club_id, email, new_account } so the page can send a welcome email to a new contact.
create function public.decide_club_request(
  p_request_id uuid, p_approve boolean, p_name text default null, p_note text default null
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  r public.club_requests;
  v_name text;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_club uuid;
  v_user public.profiles;
  v_new boolean := false;
  v_invited boolean := false;
begin
  if not coalesce(public.is_site_admin(), false) then
    raise exception 'Only a site Admin can approve new clubs' using errcode = '42501';
  end if;
  select * into r from public.club_requests where id = p_request_id for update;
  if r.id is null or r.status <> 'pending' then
    raise exception 'That request isn''t waiting any more' using errcode = 'P0002';
  end if;

  if not coalesce(p_approve, false) then
    update public.club_requests
    set status = 'denied', decided_by = auth.uid(), decided_at = now(), decision_note = v_note
    where id = r.id;
    perform public.resolve_notifications('club-request:' || r.id);
    perform public.add_notification(
      array[r.requested_by], 'club_request_answer',
      'Your request for ' || r.name || ' was declined',
      v_note, r.event_id, null, null, case when r.event_id is not null then 'clubs' end, null);
    return jsonb_build_object('club_id', null, 'email', r.contact_email, 'new_account', false);
  end if;

  v_name := coalesce(nullif(trim(coalesce(p_name, '')), ''), r.name);
  begin
    insert into public.clubs (name) values (v_name) returning id into v_club;
  exception when unique_violation then
    raise exception 'There is already a club called %. Deny this request, or give the club another name.', v_name using errcode = '23505';
  end;

  -- The contact becomes the club's Owner: now if they have an account, else when they first sign in.
  select * into v_user from public.profiles where email = r.contact_email;
  if v_user.id is not null and v_user.status = 'active' then
    perform public.put_club_owner(v_club, v_user.id);
  elsif v_user.id is not null then
    raise exception '% is disabled. Turn their account back on first.', r.contact_email using errcode = '23514';
  else
    insert into public.invites (email, name, role_id, invited_by)
    values (r.contact_email, r.contact_name, 'member', auth.uid())
    on conflict (email) do nothing;
    insert into public.club_member_invites (club_id, email, role, status)
    values (v_club, r.contact_email, 'owner', 'active')
    on conflict (club_id, email) do nothing;
    v_new := true;
  end if;

  -- Invite it to the event it was asked for (its Owner accepts, as for any invited club).
  if r.event_id is not null and public.event_is_open(r.event_id) then
    insert into public.event_clubs (event_id, club_id, status, requested_by, requested_at)
    values (r.event_id, v_club, 'invited', r.requested_by, now())
    on conflict (event_id, club_id) do nothing;
    v_invited := true;
  end if;

  update public.club_requests
  set status = 'approved', name = v_name, club_id = v_club, decided_by = auth.uid(), decided_at = now(), decision_note = v_note
  where id = r.id;
  perform public.resolve_notifications('club-request:' || r.id);
  perform public.add_notification(
    array[r.requested_by], 'club_request_answer',
    v_name || ' was approved',
    case when v_invited
      then 'It is invited to ' || public.event_name(r.event_id) || ' and is in once ' || r.contact_name || ' accepts.'
      else r.contact_name || ' is its Owner.' end
      || coalesce(' ' || v_note, ''),
    case when v_invited then r.event_id end, v_club, null, case when v_invited then 'clubs' end, null);
  return jsonb_build_object('club_id', v_club, 'email', r.contact_email, 'new_account', v_new);
end;
$$;

revoke execute on function public.create_event_club(uuid, text, uuid[]) from public, anon;
grant execute on function public.create_event_club(uuid, text, uuid[]) to authenticated;
revoke execute on function public.request_club(text, text, text, text, uuid) from public, anon;
grant execute on function public.request_club(text, text, text, text, uuid) to authenticated;
revoke execute on function public.withdraw_club_request(uuid) from public, anon;
grant execute on function public.withdraw_club_request(uuid) to authenticated;
revoke execute on function public.decide_club_request(uuid, boolean, text, text) from public, anon;
grant execute on function public.decide_club_request(uuid, boolean, text, text) to authenticated;
