-- Migration 44 (Bhavek, 2026-11-04): "give the admin a "view as" feature which lets them view as any
-- user on the system ... They should see exactly what that user sees."
--
-- How it works:
--   * A site Admin starts "View as" on someone (Admin > Users, the eye button). That writes a row in
--     view_as_sessions, which is also the log of who viewed as whom and when.
--   * While that row is open, every request the Admin's browser makes to the database runs as the
--     viewed person: auth.uid() returns their id, so row security, my_permissions() and every RPC
--     answer exactly as they would for them.
--   * It is read-only. Each of those requests runs in a read-only transaction, so nothing can be
--     added, changed or deleted while viewing, not even through an RPC.
--   * No sign-in is made for the viewed person and they aren't told.
--   * "Back to my account" (stop_view_as) closes the row. A row left open ends on its own after
--     12 hours.
--
-- The switch happens in view_as_pre_request(), which PostgREST runs before every API request
-- (its db-pre-request setting, set at the end of this file).
--
-- Run after migration 43.

create table public.view_as_sessions (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references public.profiles (id) on delete cascade,
  target_id uuid not null references public.profiles (id) on delete cascade,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '12 hours',
  ended_at timestamptz,
  constraint view_as_not_self check (admin_id <> target_id)
);

create index view_as_sessions_open on public.view_as_sessions (admin_id) where ended_at is null;

alter table public.view_as_sessions enable row level security;

-- Site Admins can read the log. Rows are only written through the functions below.
create policy "Site admins read the view-as log" on public.view_as_sessions
  for select to authenticated using (public.is_site_admin());

-- The signed-in person's real id, even while viewing as someone else.
create or replace function public.real_uid() returns uuid
language sql stable
as $$
  select coalesce(nullif(current_setting('app.view_as_real_uid', true), '')::uuid, auth.uid())
$$;

-- Runs before every API request. When a site Admin has an open View as session, the request runs
-- as the viewed person, in a read-only transaction. Anything else passes through untouched.
create or replace function public.view_as_pre_request() returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_claims jsonb;
  v_real uuid;
  v_target uuid;
  v_email text;
  v_path text := coalesce(current_setting('request.path', true), '');
begin
  begin
    v_claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
    v_real := nullif(v_claims ->> 'sub', '')::uuid;
  exception when others then
    return;
  end;
  if v_real is null or coalesce(v_claims ->> 'role', '') <> 'authenticated' then
    return;
  end if;

  -- Ending or checking the session always runs as the Admin themselves.
  if v_path ~ '/rpc/(stop_view_as|my_view_as|start_view_as)$' then
    return;
  end if;

  select s.target_id, p.email into v_target, v_email
  from public.view_as_sessions s
  join public.profiles a on a.id = s.admin_id and a.role_id = 'admin' and a.status = 'active'
  join public.profiles p on p.id = s.target_id
  where s.admin_id = v_real and s.ended_at is null and s.expires_at > now()
  order by s.started_at desc
  limit 1;

  if v_target is null then
    return;
  end if;

  perform set_config('app.view_as_real_uid', v_real::text, true);
  perform set_config('request.jwt.claims',
    (v_claims || jsonb_build_object('sub', v_target::text, 'email', v_email, 'view_as_by', v_real::text))::text, true);
  perform set_config('request.jwt.claim.sub', v_target::text, true);
  perform set_config('transaction_read_only', 'on', true);
end;
$$;

revoke all on function public.view_as_pre_request() from public;
grant execute on function public.view_as_pre_request() to anon, authenticated;

-- Site Admins only: start viewing as someone. Ends any View as session already open.
create or replace function public.start_view_as(p_target_id uuid) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_site_admin() then
    raise exception 'Only a site Admin can view as someone else' using errcode = '42501';
  end if;
  if p_target_id = auth.uid() then
    raise exception 'That''s you already' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles where id = p_target_id) then
    raise exception 'That person hasn''t signed in yet, so there is nothing to view as them' using errcode = '22023';
  end if;
  update public.view_as_sessions set ended_at = now()
  where admin_id = auth.uid() and ended_at is null;
  insert into public.view_as_sessions (admin_id, target_id) values (auth.uid(), p_target_id);
end;
$$;

-- Back to my account: ends the caller's open View as session, if any.
create or replace function public.stop_view_as() returns void
language sql security definer set search_path = public
as $$
  update public.view_as_sessions set ended_at = now()
  where admin_id = auth.uid() and ended_at is null;
$$;

-- The person the caller is viewing as right now (id, name, email), or no row.
create or replace function public.my_view_as()
returns table (id uuid, name text, email text, started_at timestamptz)
language sql stable security definer set search_path = public
as $$
  select p.id, p.name, p.email, s.started_at
  from public.view_as_sessions s
  join public.profiles p on p.id = s.target_id
  where s.admin_id = auth.uid() and s.ended_at is null and s.expires_at > now()
    and public.is_site_admin()
  order by s.started_at desc
  limit 1
$$;

revoke all on function public.start_view_as(uuid) from public, anon;
revoke all on function public.stop_view_as() from public, anon;
revoke all on function public.my_view_as() from public, anon;
grant execute on function public.start_view_as(uuid) to authenticated;
grant execute on function public.stop_view_as() to authenticated;
grant execute on function public.my_view_as() to authenticated;

-- Turn the switch on: PostgREST calls view_as_pre_request() before each request.
alter role authenticator set pgrst.db_pre_request = 'public.view_as_pre_request';
notify pgrst, 'reload config';
