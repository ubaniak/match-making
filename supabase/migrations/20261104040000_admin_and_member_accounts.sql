-- Migration 45 (Bhavek, 2026-11-04, "Option B: Admin + Member"): a simpler role model.
-- Run after migration 44 (20261104030000_view_as.sql). Safe to run once.
--
--   * Two account types: Admin (the site Admin) and Member (everyone else). The User, Official,
--     Athlete and Public account types go. Every other role sits on a club or an event:
--       - club:  Owner, Coach
--       - event: Owner, Chief Official, official
--   * Being an official means being on the Officials list (level, BC number, phone), not an account
--     type. Officials can now request events like everyone else.
--   * Athletes don't sign in. Saving an athlete's email no longer lets that email sign in.
--   * People who were Public (signed in but given no access) become Members who are Disabled, so
--     nobody gains access by this change. A site Admin can switch them to Active on Admin > Users.
--   * The event Viewer role goes. When an event changes Owner, the old Owner simply steps off.
--   * The Deputy becomes a second Chief Official with exactly the same powers. The site Admin picks
--     the first; the site Admin or a Chief Official picks the second.
--   * Club Owners can invite an email that has no account yet. That email can then sign in, and the
--     invitation turns into a club membership when they do. It still waits for site Admin approval,
--     as before.

-- ---------------------------------------------------------------------------
-- Accounts: Admin or Member
-- ---------------------------------------------------------------------------

insert into public.roles (id, name, description, is_system)
values ('member', 'Members', 'Everyone who signs in and isn''t a site Admin. What they can do comes from their roles on clubs and events.', true)
on conflict (id) do nothing;

-- Members get what Users and Officials had between them (Users' scope wins where both had one).
insert into public.role_permissions (role_id, permission, scope)
select 'member', permission, scope from public.role_permissions where role_id = 'user'
on conflict do nothing;
insert into public.role_permissions (role_id, permission, scope)
select 'member', permission, scope from public.role_permissions where role_id = 'official'
on conflict do nothing;

-- Athletes don't sign in: forget the sign-in invites that athlete emails made.
delete from public.invites where role_id = 'athlete';

-- Public meant "no access yet". Keep them out: Disabled until a site Admin says otherwise.
update public.profiles set status = 'disabled' where role_id = 'public' and status = 'active';

update public.profiles set role_id = 'member' where role_id in ('user', 'official', 'athlete', 'public');
update public.invites set role_id = 'member' where role_id in ('user', 'official', 'athlete', 'public');

-- Older code (test data, demo accounts, links from the Officials list) still names the old account
-- types. Whatever it writes becomes a Member.
create function public.normalize_account_role() returns trigger
language plpgsql
as $$
begin
  if new.role_id in ('user', 'official', 'athlete', 'public', 'coach') then
    new.role_id := 'member';
  end if;
  return new;
end;
$$;

create trigger normalize_account_role before insert or update of role_id on public.profiles
  for each row execute function public.normalize_account_role();
create trigger normalize_account_role before insert or update of role_id on public.invites
  for each row execute function public.normalize_account_role();

alter table public.profiles alter column role_id set default 'member';

delete from public.role_permissions where role_id in ('user', 'official', 'athlete', 'public');
delete from public.roles where id in ('user', 'official', 'athlete', 'public');

-- Saving an athlete no longer creates a sign-in invite or links an account.
create or replace function public.link_athlete_email() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  new.invite_email := nullif(lower(trim(new.invite_email)), '');
  new.updated_at := now();
  new.updated_by := auth.uid();

  if tg_op = 'UPDATE' and not public.has_permission('users:manage') then
    if new.coach_id is distinct from old.coach_id or new.user_id is distinct from old.user_id then
      raise exception 'Only Admins can change an athlete''s coach or login' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

-- Who sees every person, athlete and club: the site Admin, anyone who owns an event, and anyone on
-- the Officials list or holding a Chief Official seat. (Before, the Official account type also did.)
create or replace function public.sees_everyone() returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    public.is_site_admin()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.status = 'active' and (
        exists (select 1 from public.event_members m where m.user_id = p.id and m.role = 'owner')
        or exists (select 1 from public.event_officials o where o.user_id = p.id)
        or exists (select 1 from public.officials o where o.user_id = p.id)
      )
    ),
    false)
$$;

-- ---------------------------------------------------------------------------
-- Events: no more Viewers
-- ---------------------------------------------------------------------------

delete from public.event_members where role = 'viewer';
alter table public.event_members drop constraint event_members_role_check;
alter table public.event_members add constraint event_members_role_check check (role = 'owner');

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

  delete from public.event_members
  where event_id = p_event_id and role = 'owner' and user_id <> p_user_id;
  insert into public.event_members (event_id, user_id, role, added_by)
  values (p_event_id, p_user_id, 'owner', auth.uid())
  on conflict (event_id, user_id) do update set role = 'owner';
end;
$$;

-- ---------------------------------------------------------------------------
-- Two equal Chief Officials (the second seat is still stored as 'deputy')
-- ---------------------------------------------------------------------------

create or replace function public.is_event_chief(p_event_id uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.event_officials
    where event_id = p_event_id and role in ('chief', 'deputy') and user_id = auth.uid()
  )
$$;

create or replace function public.set_event_official(p_event_id uuid, p_role text, p_user_id uuid) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if p_role not in ('chief', 'deputy') then
    raise exception 'Pick the first or second Chief Official' using errcode = '22023';
  end if;
  if p_role = 'chief' and not public.is_site_admin() then
    raise exception 'Only a site Admin can choose the first Chief Official' using errcode = '42501';
  end if;
  if p_role = 'deputy' and not public.can_invite_officials(p_event_id) then
    raise exception 'Only a site Admin or a Chief Official of this event can choose the second Chief Official' using errcode = '42501';
  end if;
  if not public.is_site_admin() and not public.event_is_open(p_event_id) then
    raise exception 'Chief Officials can be changed while the event is Active' using errcode = '22023';
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
    raise exception 'The two Chief Officials must be different people' using errcode = '23505';
  end if;
  insert into public.event_officials (event_id, role, user_id) values (p_event_id, p_role, p_user_id)
  on conflict (event_id, role) do update set user_id = excluded.user_id, added_by = auth.uid(), added_at = now();
end;
$$;

create or replace function public.notify_event_official() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and old.user_id = new.user_id then
    return new;
  end if;
  perform public.add_notification(
    array[new.user_id], 'official_role',
    'You are a Chief Official for ' || public.event_name(new.event_id),
    null, new.event_id, null, null, 'officials');
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Club Owners invite by email, account or not
-- ---------------------------------------------------------------------------

-- An invitation to a club for an email that has no account yet. It becomes a club_members row
-- (with the same status) when that email first signs in.
create table public.club_member_invites (
  club_id uuid not null references public.clubs (id) on delete cascade,
  email text not null check (email = lower(email)),
  role text not null check (role in ('owner', 'coach')),
  status text not null check (status in ('pending', 'active')),
  invited_by uuid references public.profiles (id) on delete set null default auth.uid(),
  invited_at timestamptz not null default now(),
  primary key (club_id, email)
);

alter table public.club_member_invites enable row level security;
create policy "club owners read email invites" on public.club_member_invites for select to authenticated
  using (public.is_site_admin() or public.club_role(club_id) = 'owner');
create policy "club owners cancel email invites" on public.club_member_invites for delete to authenticated
  using (public.is_site_admin() or public.club_role(club_id) = 'owner');
grant select, delete on public.club_member_invites to authenticated;

-- Returns { name, new_account } so the page can send a welcome email to someone new. (It used to
-- return just the name, so it is dropped and made again.)
drop function public.invite_club_member(uuid, text, text);
create function public.invite_club_member(p_club_id uuid, p_email text, p_role text default 'coach') returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_user public.profiles;
  v_admin boolean := public.is_site_admin();
begin
  if not (v_admin or coalesce(public.club_role(p_club_id) = 'owner', false)) then
    raise exception 'Only the club''s Owners can invite people' using errcode = '42501';
  end if;
  if coalesce(p_role, 'coach') not in ('owner', 'coach') then
    raise exception 'Invite people as an Owner or a Coach' using errcode = '22023';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'That email address doesn''t look right' using errcode = '22023';
  end if;
  select * into v_user from public.profiles where email = v_email;

  if v_user.id is null then
    -- No account yet: let the email sign in, and hold the club place until they do.
    if exists (select 1 from public.club_member_invites where club_id = p_club_id and email = v_email) then
      raise exception '% is already invited', v_email using errcode = '23505';
    end if;
    insert into public.invites (email, role_id, invited_by)
    values (v_email, 'member', auth.uid())
    on conflict (email) do nothing;
    insert into public.club_member_invites (club_id, email, role, status)
    values (p_club_id, v_email, coalesce(p_role, 'coach'), case when v_admin then 'active' else 'pending' end);
    return jsonb_build_object('name', v_email, 'new_account', true);
  end if;

  if v_user.status <> 'active' then
    raise exception '% is disabled', v_email using errcode = '23514';
  end if;
  if exists (select 1 from public.club_members where club_id = p_club_id and user_id = v_user.id) then
    raise exception '% is already in the club or invited', v_email using errcode = '23505';
  end if;
  insert into public.club_members (club_id, user_id, role, status)
  values (p_club_id, v_user.id, coalesce(p_role, 'coach'), case when v_admin then 'active' else 'pending' end);
  return jsonb_build_object('name', coalesce(nullif(trim(v_user.name), ''), v_user.email), 'new_account', false);
end;
$$;

revoke execute on function public.invite_club_member(uuid, text, text) from public, anon;
grant execute on function public.invite_club_member(uuid, text, text) to authenticated;

-- First sign-in: make the profile, link the Officials list, and turn club email invites into
-- club memberships. Athletes are no longer linked (they don't sign in).
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  invite public.invites;
  new_email text := lower(new.email);
begin
  select * into invite from public.invites where email = new_email;

  insert into public.profiles (id, email, name, role_id)
  values (new.id, new_email, invite.name, coalesce(invite.role_id, 'member'));

  update public.officials set user_id = new.id
  where invite_email = new_email and user_id is null;

  insert into public.club_members (club_id, user_id, role, status, invited_by, invited_at)
  select club_id, new.id, role, status, invited_by, invited_at
  from public.club_member_invites where email = new_email
  on conflict (club_id, user_id) do nothing;
  delete from public.club_member_invites where email = new_email;

  delete from public.invites where email = new_email;
  return new;
end;
$$;

-- The welcome email can also be sent by a club Owner who just invited this email.
create or replace function public.welcome_email_details(p_email text)
returns table (name text, role_name text)
language plpgsql stable security definer set search_path = public
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
begin
  if not public.is_site_admin()
     and not exists (
       select 1 from public.official_invitations i
       join public.officials o on o.id = i.official_id
       where o.invite_email = v_email and public.can_add_officials(i.event_id))
     and not exists (
       select 1 from public.club_member_invites c
       where c.email = v_email and public.club_role(c.club_id) = 'owner') then
    return;
  end if;
  return query
    select coalesce(p.name, inv.name), r.name
    from (select 1) one
    left join public.profiles p on p.email = v_email
    left join public.invites inv on inv.email = v_email
    join public.roles r on r.id = coalesce(p.role_id, inv.role_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Test data helpers: no Viewers, Members only
-- ---------------------------------------------------------------------------

create or replace function public.add_helper_demo_accounts()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_one uuid := (select id from public.events where name = 'TEST One-Day Card' limit 1);
  v_multi uuid := (select id from public.events where name = 'TEST Multi-Day Open' limit 1);
  v_owner1 uuid;
  v_owner2 uuid;
  v_off1 uuid;
  v_off2 uuid;
  v_made int := 0;
  r record;
begin
  if v_one is null or v_multi is null then
    return 0;
  end if;

  for r in
    select * from (values
      ('owner1@demo.test', 'TEST Event Owner 1', 'member'),
      ('owner2@demo.test', 'TEST Event Owner 2', 'member'),
      ('official1@demo.test', 'TEST Official 1', 'member'),
      ('official2@demo.test', 'TEST Official 2', 'member')
    ) as a(email, name, role)
  loop
    if not exists (select 1 from auth.users where email = r.email) then
      perform public.create_demo_user(r.email, r.name, r.role);
      v_made := v_made + 1;
    end if;
  end loop;

  select id into v_owner1 from auth.users where email = 'owner1@demo.test';
  select id into v_owner2 from auth.users where email = 'owner2@demo.test';
  select id into v_off1 from auth.users where email = 'official1@demo.test';
  select id into v_off2 from auth.users where email = 'official2@demo.test';

  -- Owners: one TEST event each. Whoever owned them before steps off (there are no Viewers now;
  -- "Remove helper logins" hands the events back to event-owner@demo.test).
  delete from public.event_members
  where event_id in (v_one, v_multi) and role = 'owner'
    and user_id <> case event_id when v_one then v_owner1 else v_owner2 end;
  insert into public.event_members (event_id, user_id, role, added_by)
  values (v_one, v_owner1, 'owner', auth.uid()), (v_multi, v_owner2, 'owner', auth.uid())
  on conflict (event_id, user_id) do update set role = 'owner';

  -- Officials: on the Officials list, accepted for every day of both TEST events.
  insert into public.officials (name, qualifications, invite_email, user_id)
  select v.name, 'Level 3 referee', v.email, v.uid
  from (values ('TEST Official 1', 'official1@demo.test', v_off1),
               ('TEST Official 2', 'official2@demo.test', v_off2)) as v(name, email, uid)
  where not exists (select 1 from public.officials o where o.user_id = v.uid);

  insert into public.official_invitations (event_id, official_id, status, days, responded_at)
  select e.id, o.id, 'accepted',
         (select array_agg(d::date order by d) from generate_series(e.start_date, e.end_date, interval '1 day') d),
         now()
  from public.events e
  cross join public.officials o
  where e.id in (v_one, v_multi) and o.user_id in (v_off1, v_off2)
  on conflict (event_id, official_id) do nothing;

  -- Two Chief Officials on each: Official 1 leads the One-Day Card, Official 2 the Multi-Day Open.
  delete from public.event_officials where event_id in (v_one, v_multi);
  insert into public.event_officials (event_id, role, user_id) values
    (v_one, 'chief', v_off1), (v_one, 'deputy', v_off2),
    (v_multi, 'chief', v_off2), (v_multi, 'deputy', v_off1);

  return v_made;
end;
$function$;

create or replace function public.clear_helper_accounts() returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_owner uuid := (select id from auth.users where email = 'event-owner@demo.test');
  v_official uuid := (select id from auth.users where email = 'official@demo.test');
  v_accounts int;
begin
  if auth.uid() is not null and not public.is_site_admin() then
    raise exception 'Only a site Admin can remove helper logins' using errcode = '42501';
  end if;
  delete from public.officials
  where invite_email in ('official1@demo.test', 'official2@demo.test');
  -- Deleting the sign-in account deletes its profile, event roles and Chief Official seats.
  delete from auth.users
  where email in ('owner1@demo.test', 'owner2@demo.test', 'official1@demo.test', 'official2@demo.test');
  get diagnostics v_accounts = row_count;

  -- Hand the TEST events back to the original demo accounts.
  if v_owner is not null then
    insert into public.event_members (event_id, user_id, role)
    select e.id, v_owner, 'owner' from public.events e
    where e.name like 'TEST %'
      and not exists (select 1 from public.event_members o where o.event_id = e.id and o.role = 'owner')
    on conflict (event_id, user_id) do update set role = 'owner';
  end if;
  if v_official is not null then
    insert into public.event_officials (event_id, role, user_id)
    select e.id, 'chief', v_official from public.events e
    where e.name like 'TEST %'
      and not exists (select 1 from public.event_officials o where o.event_id = e.id and (o.role = 'chief' or o.user_id = v_official));
  end if;
  return jsonb_build_object('accounts', v_accounts);
end;
$$;
