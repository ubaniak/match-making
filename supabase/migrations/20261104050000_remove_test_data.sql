-- Migration 46 (Bhavek, 2026-11-04, "delete and remove the test data stuff" and "if i create a user
-- with @demo.test let them use the 123456 otp").
-- Run after migration 45 (20261104040000_admin_and_member_accounts.sql). Safe to run more than once.
--
-- The test data feature is gone from the app (Admin > Test data, Load/Clear, helper logins). This
-- migration removes what is left of it in the database, and keeps demo sign-in for people a site
-- Admin adds by hand:
--
--   1. Deletes the test data, the same rows "Clear test data" deleted:
--        * every event whose name starts with "TEST " (with its days, entries, bouts, results,
--          weigh-ins, officials, invitations and notifications, which all cascade),
--        * every athlete whose name starts with "TEST ", and any other athlete in a TEST club,
--          unless that athlete is entered in, or has a bout at, a real event,
--        * every club whose name starts with "TEST " that no longer has athletes,
--        * every official whose name starts with "TEST ",
--        * the seven demo sign-in accounts the test data made (listed below by email).
--      Matching is case-sensitive: "TEST " in capitals followed by a space. Nothing else is touched.
--      Other @demo.test accounts a site Admin added are kept. A TEST club is kept if it still has
--      an athlete entered at a real event, so no real bout history is lost; the notice at the end
--      says how many were kept.
--   2. Drops the functions behind the test data feature.
--   3. Demo accounts: when a site Admin adds a person with an @demo.test email (Admin > Users, or
--      anything else that makes an invite), their account is made straight away with the password
--      123456, so they sign in with the code 123456 and no email is sent. demo.test is a reserved
--      domain, so no real person has one of these addresses. Only invited @demo.test emails get an
--      account: the blanket "@demo.test counts as invited" rule from migration 34 is gone.

do $$
declare
  v_events int;
  v_athletes int;
  v_clubs int;
  v_officials int;
  v_accounts int;
  v_kept int;
  v_seeded text[] := array['event-owner@demo.test', 'club-owner@demo.test', 'official@demo.test',
                           'owner1@demo.test', 'owner2@demo.test', 'official1@demo.test', 'official2@demo.test'];
begin
  -- Events first: that removes their entries and bouts, so the athletes can then be deleted.
  delete from public.events where name like 'TEST %';
  get diagnostics v_events = row_count;

  -- After the TEST events are gone, any entry or bout left is at a real event.
  delete from public.athletes a
  where a.name like 'TEST %'
     or (a.club_id in (select id from public.clubs where name like 'TEST %')
         and not exists (select 1 from public.event_athletes ea where ea.athlete_id = a.id)
         and not exists (select 1 from public.bouts b where a.id in (b.red_athlete_id, b.blue_athlete_id)));
  get diagnostics v_athletes = row_count;

  delete from public.clubs c
  where c.name like 'TEST %'
    and not exists (select 1 from public.athletes a where a.club_id = c.id);
  get diagnostics v_clubs = row_count;

  delete from public.officials
  where name like 'TEST %' or lower(invite_email) = any (v_seeded);
  get diagnostics v_officials = row_count;

  delete from public.invites where lower(email) = any (v_seeded);
  delete from public.club_member_invites where lower(email) = any (v_seeded);

  -- Deleting the sign-in account deletes its profile, club memberships and event roles.
  delete from auth.users where lower(email) = any (v_seeded);
  get diagnostics v_accounts = row_count;

  select count(*) into v_kept from public.clubs where name like 'TEST %';

  raise notice 'Removed % TEST events, % athletes, % clubs, % officials and % test data demo accounts. Kept % TEST clubs that have athletes entered at real events.',
    v_events, v_athletes, v_clubs, v_officials, v_accounts, v_kept;
end;
$$;

drop function if exists public.seed_test_data();
drop function if exists public.clear_test_data();
drop function if exists public.seed_test_roster();
drop function if exists public.clear_test_roster();
drop function if exists public.seed_helper_accounts();
drop function if exists public.clear_helper_accounts();
drop function if exists public.add_helper_demo_accounts();
drop function if exists public.create_demo_user(text, text, text);

-- Same as migration 34, without the blanket @demo.test exception. An invited @demo.test email
-- already has its account (see below), so it passes as an existing profile.
create or replace function public.email_is_invited(p_email text) returns boolean
language sql stable security definer set search_path = public
as $$
  with e as (select lower(trim(coalesce(p_email, ''))) as email)
  select e.email <> '' and (
       exists (select 1 from public.profiles p where lower(p.email) = e.email)
    or exists (select 1 from public.invites i where i.email = e.email)
    or exists (select 1 from public.officials o where lower(o.invite_email) = e.email)
  )
  from e;
$$;

revoke execute on function public.email_is_invited(text) from public;
grant execute on function public.email_is_invited(text) to anon, authenticated;

-- An email sign-in account with the fixed password 123456, made the way Supabase Auth makes them.
-- handle_new_user then makes the profile from the invite (name and account type) and uses it up.
create or replace function public.create_demo_account() returns trigger
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_email text := lower(trim(new.email));
  v_id uuid := gen_random_uuid();
begin
  if v_email not like '%@demo.test' or exists (select 1 from auth.users where lower(email) = v_email) then
    return new;
  end if;
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change
  ) values (
    '00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', v_email,
    crypt('123456', gen_salt('bf')), now(),
    '{"provider": "email", "providers": ["email"]}', jsonb_build_object('name', new.name), now(), now(),
    '', '', '', ''
  );
  insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), v_id, v_id::text, 'email',
          jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true), now(), now(), now());
  return new;
end;
$$;

revoke execute on function public.create_demo_account() from public, anon, authenticated;

drop trigger if exists create_demo_account on public.invites;
create trigger create_demo_account
  after insert or update of email on public.invites
  for each row execute function public.create_demo_account();

-- Anyone already invited with an @demo.test email gets their account now.
update public.invites set email = email where email like '%@demo.test';
