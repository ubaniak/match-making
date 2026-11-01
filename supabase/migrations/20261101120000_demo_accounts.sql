-- Migration 20: demo accounts in the test data. Needs migrations 14-17 first.
--
-- "Load test data" now also creates three sign-in accounts, all with the code 123456:
--   event-owner@demo.test   Owner of both TEST events
--   club-owner@demo.test    Owner of TEST North End Boxing
--   official@demo.test      An official, accepted for every day of both TEST events and
--                           Chief Official on them
-- "Clear test data" deletes them again.
--
-- How the fixed code works: Supabase can't fix an email sign-in code, so these accounts get the
-- password 123456 instead, and the app's sign-in screen tries that password only for @demo.test
-- emails (it never emails them a code). Real accounts are made by email sign-in and have no
-- password, so a password sign-in can't get into them. demo.test is a reserved domain nobody can
-- own, so no real person can have one of these addresses.
--
-- Anyone who knows this can sign in as a demo account while test data is loaded. They see what any
-- signed-in user sees (all Active and Done events) plus the TEST data their role covers. Clear the
-- test data when you're not using it.

alter function public.seed_test_data() rename to seed_test_roster;
alter function public.clear_test_data() rename to clear_test_roster;
revoke execute on function public.seed_test_roster() from public, anon, authenticated;
revoke execute on function public.clear_test_roster() from public, anon, authenticated;

-- An email sign-in account with a fixed password, made the way Supabase Auth makes them.
-- Its profile comes from the handle_new_user trigger.
create function public.create_demo_user(p_email text, p_name text, p_role text) returns uuid
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_id uuid := gen_random_uuid();
begin
  if p_email not like '%@demo.test' then
    raise exception 'Demo accounts must use a @demo.test email';
  end if;
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change
  ) values (
    '00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', p_email,
    crypt('123456', gen_salt('bf')), now(),
    '{"provider": "email", "providers": ["email"]}', jsonb_build_object('name', p_name), now(), now(),
    '', '', '', ''
  );
  insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), v_id, v_id::text, 'email',
          jsonb_build_object('sub', v_id::text, 'email', p_email, 'email_verified', true), now(), now(), now());
  update public.profiles set name = p_name, role_id = p_role where id = v_id;
  return v_id;
end;
$$;

revoke execute on function public.create_demo_user(text, text, text) from public, anon, authenticated;

create function public.seed_test_data() returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_counts jsonb;
  v_event_owner uuid;
  v_club_owner uuid;
  v_official_user uuid;
  v_official uuid;
begin
  if auth.uid() is not null and not public.is_site_admin() then
    raise exception 'Only a site Admin can load test data' using errcode = '42501';
  end if;
  if exists (select 1 from auth.users where email like '%@demo.test') then
    raise exception 'Test data is already loaded. Clear it first.' using errcode = '23505';
  end if;

  v_counts := public.seed_test_roster();

  v_event_owner := public.create_demo_user('event-owner@demo.test', 'TEST Demo Event Owner', 'user');
  v_club_owner := public.create_demo_user('club-owner@demo.test', 'TEST Demo Club Owner', 'user');
  v_official_user := public.create_demo_user('official@demo.test', 'TEST Demo Official', 'official');

  -- The demo Event Owner owns both TEST events (instead of whoever pressed the button).
  delete from public.event_members m using public.events e
  where e.id = m.event_id and e.name like 'TEST %';
  insert into public.event_members (event_id, user_id, role, added_by)
  select id, v_event_owner, 'owner', auth.uid() from public.events where name like 'TEST %';

  insert into public.club_members (club_id, user_id, role, status)
  select id, v_club_owner, 'owner', 'active' from public.clubs where name = 'TEST North End Boxing';

  insert into public.officials (name, qualifications, invite_email, user_id)
  values ('TEST Demo Official', 'Level 3 referee', 'official@demo.test', v_official_user)
  returning id into v_official;

  insert into public.official_invitations (event_id, official_id, status, days, responded_at)
  select e.id, v_official, 'accepted',
         (select array_agg(d::date order by d) from generate_series(e.start_date, e.end_date, interval '1 day') d),
         now()
  from public.events e where e.name like 'TEST %';

  insert into public.event_officials (event_id, role, user_id)
  select id, 'chief', v_official_user from public.events where name like 'TEST %';

  return v_counts || jsonb_build_object('accounts', 3);
end;
$$;

create function public.clear_test_data() returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_counts jsonb;
  v_accounts int;
begin
  if auth.uid() is not null and not public.is_site_admin() then
    raise exception 'Only a site Admin can clear test data' using errcode = '42501';
  end if;
  v_counts := public.clear_test_roster();
  delete from public.officials where name like 'TEST %';
  -- Deleting the sign-in account deletes its profile, club memberships and event roles.
  delete from auth.users where email like '%@demo.test';
  get diagnostics v_accounts = row_count;
  return v_counts || jsonb_build_object('accounts', v_accounts);
end;
$$;

revoke execute on function public.seed_test_data() from public, anon;
revoke execute on function public.clear_test_data() from public, anon;
grant execute on function public.seed_test_data() to authenticated;
grant execute on function public.clear_test_data() to authenticated;
