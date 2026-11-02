-- Migration 33: four more demo accounts, one per test helper. Needs migration 20 first.
-- Safe to run more than once.
--
-- Each signs in with the code 123456 like the other demo accounts (no email is sent):
--   owner1@demo.test     Owner of TEST One-Day Card
--   owner2@demo.test     Owner of TEST Multi-Day Open
--   official1@demo.test  Official accepted for every day of both TEST events.
--                        Chief Official of TEST One-Day Card, Deputy of TEST Multi-Day Open
--   official2@demo.test  Official accepted for every day of both TEST events.
--                        Chief Official of TEST Multi-Day Open, Deputy of TEST One-Day Card
--
-- An event has one Owner, one Chief and one Deputy, so the older accounts step aside:
-- event-owner@demo.test stays on both TEST events as a viewer, and official@demo.test stays an
-- accepted official on both but is no longer their Chief Official. club-owner@demo.test is unchanged.
--
-- If test data is already loaded, this migration adds the four accounts now. Otherwise
-- "Load test data" makes them. "Clear test data" deletes them with the other demo accounts.
-- Admin > Test data also has "Add helper logins" / "Remove helper logins" buttons
-- (seed_helper_accounts / clear_helper_accounts) to add or remove just these four.

create or replace function public.add_helper_demo_accounts() returns int
language plpgsql security definer set search_path = public
as $$
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
      ('owner1@demo.test', 'TEST Event Owner 1', 'user'),
      ('owner2@demo.test', 'TEST Event Owner 2', 'user'),
      ('official1@demo.test', 'TEST Official 1', 'official'),
      ('official2@demo.test', 'TEST Official 2', 'official')
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

  -- Owners: one TEST event each. Whoever owned them before stays on as a viewer.
  update public.event_members set role = 'viewer'
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

  -- Chief and Deputy: Official 1 leads the One-Day Card, Official 2 the Multi-Day Open.
  delete from public.event_officials where event_id in (v_one, v_multi);
  insert into public.event_officials (event_id, role, user_id) values
    (v_one, 'chief', v_off1), (v_one, 'deputy', v_off2),
    (v_multi, 'chief', v_off2), (v_multi, 'deputy', v_off1);

  return v_made;
end;
$$;

revoke execute on function public.add_helper_demo_accounts() from public, anon, authenticated;

-- "Load test data" now makes the four helper accounts too.
create or replace function public.seed_test_data() returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_counts jsonb;
  v_event_owner uuid;
  v_club_owner uuid;
  v_official_user uuid;
  v_official uuid;
  v_helpers int;
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

  -- The helper accounts take over ownership and the Chief/Deputy roles (see above).
  v_helpers := public.add_helper_demo_accounts();

  return v_counts || jsonb_build_object('accounts', 3 + v_helpers);
end;
$$;

-- Admin > Test data buttons: add or remove just the four helper accounts.
create or replace function public.seed_helper_accounts() returns jsonb
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is not null and not public.is_site_admin() then
    raise exception 'Only a site Admin can add helper logins' using errcode = '42501';
  end if;
  if not exists (select 1 from public.events where name = 'TEST One-Day Card')
     or not exists (select 1 from public.events where name = 'TEST Multi-Day Open') then
    raise exception 'Load test data first. The helper logins are added to the TEST events.' using errcode = 'P0002';
  end if;
  return jsonb_build_object('accounts', public.add_helper_demo_accounts());
end;
$$;

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
  -- Deleting the sign-in account deletes its profile, event roles and Chief/Deputy rows.
  delete from auth.users
  where email in ('owner1@demo.test', 'owner2@demo.test', 'official1@demo.test', 'official2@demo.test');
  get diagnostics v_accounts = row_count;

  -- Hand the TEST events back to the original demo accounts.
  if v_owner is not null then
    update public.event_members m set role = 'owner'
    from public.events e
    where e.id = m.event_id and e.name like 'TEST %' and m.user_id = v_owner
      and not exists (select 1 from public.event_members o where o.event_id = m.event_id and o.role = 'owner');
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

revoke execute on function public.seed_helper_accounts() from public, anon;
revoke execute on function public.clear_helper_accounts() from public, anon;
grant execute on function public.seed_helper_accounts() to authenticated;
grant execute on function public.clear_helper_accounts() to authenticated;

-- Test data already loaded: add the four accounts now.
select public.add_helper_demo_accounts()
where exists (select 1 from auth.users where email = 'event-owner@demo.test');
