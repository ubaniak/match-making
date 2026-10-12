-- Roles, permissions, profiles, invites and athletes, as described in plan/rbac.md.
-- Row-level security does the protecting: the React app talks to these tables with the public anon key.

-- ---------------------------------------------------------------------------
-- RBAC tables
-- ---------------------------------------------------------------------------

create table public.roles (
  id text primary key,
  name text not null,
  description text,
  is_system boolean not null default false
);

-- The fixed list of permissions. Each one is checked by an RLS policy somewhere.
create table public.permissions (
  id text primary key,
  description text not null
);

create table public.role_permissions (
  role_id text not null references public.roles (id) on delete cascade,
  permission text not null references public.permissions (id) on delete cascade,
  scope text not null check (scope in ('any', 'own', 'self')),
  primary key (role_id, permission)
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  name text,
  role_id text not null default 'public' references public.roles (id),
  status text not null default 'active' check (status in ('active', 'disabled')),
  created_at timestamptz not null default now()
);

-- An Admin adds a row; when that email first signs in it gets this role.
create table public.invites (
  email text primary key check (email = lower(email)),
  name text,
  role_id text not null references public.roles (id),
  invited_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

insert into public.roles (id, name, description, is_system) values
  ('admin', 'Admins', 'Everything, including giving and removing access.', true),
  ('official', 'Officials', 'Referees, judges and other officials.', true),
  ('coach', 'Coaches', 'Run their own cards and athletes.', true),
  ('athlete', 'Athletes', 'Edit their own profile and view cards.', true),
  ('public', 'Public', 'Read-only access to public pages.', true);

insert into public.permissions (id, description) values
  ('public:read', 'View public pages'),
  ('pages:read', 'View member pages'),
  ('cards:read', 'View cards and their bouts'),
  ('cards:create', 'Create a card'),
  ('cards:manage', 'Edit a card, accept or decline submissions, set bouts'),
  ('cards:submit-official', 'Put an official''s name forward for a card'),
  ('cards:submit-athlete', 'Put an athlete''s name forward for a card'),
  ('athletes:read', 'View athlete profiles'),
  ('athletes:create', 'Add an athlete'),
  ('athletes:write', 'Edit an athlete''s profile'),
  ('officials:read', 'View official profiles'),
  ('officials:write', 'Edit an official''s profile'),
  ('files:upload', 'Upload documents and photos to a profile'),
  ('users:manage', 'Invite users, change their role, remove access'),
  ('roles:manage', 'Create roles, edit role permissions'),
  ('audit:read', 'See who changed what');

-- Default grants from the matrix in plan/rbac.md. Admins need no rows: has_permission always says yes to them.
insert into public.role_permissions (role_id, permission, scope) values
  ('official', 'public:read', 'any'),
  ('official', 'pages:read', 'any'),
  ('official', 'cards:read', 'any'),
  ('official', 'cards:submit-official', 'self'),
  ('official', 'athletes:read', 'any'),
  ('official', 'officials:read', 'any'),
  ('official', 'officials:write', 'self'),
  ('official', 'files:upload', 'self'),
  ('coach', 'public:read', 'any'),
  ('coach', 'pages:read', 'any'),
  ('coach', 'cards:read', 'any'),
  ('coach', 'cards:create', 'any'),
  ('coach', 'cards:manage', 'own'),
  ('coach', 'cards:submit-athlete', 'own'),
  ('coach', 'athletes:read', 'any'),
  ('coach', 'athletes:create', 'any'),
  ('coach', 'athletes:write', 'own'),
  ('coach', 'officials:read', 'any'),
  ('coach', 'files:upload', 'own'),
  ('athlete', 'public:read', 'any'),
  ('athlete', 'pages:read', 'any'),
  ('athlete', 'cards:read', 'any'),
  ('athlete', 'athletes:read', 'any'),
  ('athlete', 'athletes:write', 'self'),
  ('athlete', 'files:upload', 'self'),
  ('public', 'public:read', 'any');

-- ---------------------------------------------------------------------------
-- Permission checks
-- ---------------------------------------------------------------------------

-- The signed-in user's role, 'public' when signed out or without a profile, null when disabled.
create function public.current_role_id() returns text
language sql stable security definer set search_path = public
as $$
  select case
    when auth.uid() is null then 'public'
    when not exists (select 1 from public.profiles where id = auth.uid()) then 'public'
    else (select role_id from public.profiles where id = auth.uid() and status = 'active')
  end
$$;

-- True when the signed-in user holds `perm` with a scope that covers a record owned by `owner`.
create function public.has_permission(perm text, owner uuid default null) returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce((
    select r = 'admin' or exists (
      select 1 from public.role_permissions rp
      where rp.role_id = r
        and rp.permission = perm
        and (rp.scope = 'any' or (owner is not null and owner = auth.uid()))
    )
    from (select public.current_role_id() as r) current_user_role
  ), false)
$$;

-- What the React app uses to decide what to show.
create function public.my_permissions() returns table (permission text, scope text)
language sql stable security definer set search_path = public
as $$
  select p.id, 'any' from public.permissions p where public.current_role_id() = 'admin'
  union all
  select rp.permission, rp.scope from public.role_permissions rp
  where rp.role_id = public.current_role_id() and public.current_role_id() <> 'admin'
$$;

-- ---------------------------------------------------------------------------
-- Athletes
-- ---------------------------------------------------------------------------

create table public.athletes (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  date_of_birth date,
  weight_class text,
  club text,
  coach_id uuid references public.profiles (id) on delete set null,
  user_id uuid unique references public.profiles (id) on delete set null,
  invite_email text check (invite_email = lower(invite_email)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);

-- ---------------------------------------------------------------------------
-- Sign-in: create the profile, apply any invite, link athlete records
-- ---------------------------------------------------------------------------

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  invite public.invites;
  new_email text := lower(new.email);
begin
  select * into invite from public.invites where email = new_email;

  insert into public.profiles (id, email, name, role_id)
  values (new.id, new_email, invite.name, coalesce(invite.role_id, 'public'));

  update public.athletes set user_id = new.id
  where invite_email = new_email and user_id is null;

  delete from public.invites where email = new_email;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Add someone by email with a role. Updates their role if they've already signed in,
-- otherwise saves an invite that applies on their first sign-in.
create function public.invite_user(p_email text, p_name text, p_role text) returns text
language plpgsql security definer set search_path = public
as $$
declare
  clean_email text := lower(trim(p_email));
begin
  if not public.has_permission('users:manage') then
    raise exception 'Only Admins can add people' using errcode = '42501';
  end if;
  if clean_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'That email address doesn''t look right' using errcode = '22023';
  end if;

  update public.profiles
  set role_id = p_role, name = coalesce(nullif(trim(p_name), ''), name)
  where email = clean_email;
  if found then
    return 'updated';
  end if;

  insert into public.invites (email, name, role_id, invited_by)
  values (clean_email, nullif(trim(p_name), ''), p_role, auth.uid())
  on conflict (email) do update set name = excluded.name, role_id = excluded.role_id, invited_by = excluded.invited_by;
  return 'invited';
end;
$$;

-- When an athlete gets a login email, link them to that account if it exists,
-- otherwise invite the email as an Athlete. Never downgrades someone who already has a role.
create function public.link_athlete_email() returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  existing public.profiles;
begin
  new.invite_email := nullif(lower(trim(new.invite_email)), '');
  new.updated_at := now();
  new.updated_by := auth.uid();

  if tg_op = 'UPDATE' and not public.has_permission('users:manage') then
    if new.coach_id is distinct from old.coach_id or new.user_id is distinct from old.user_id then
      raise exception 'Only Admins can change an athlete''s coach or login' using errcode = '42501';
    end if;
  end if;

  if new.invite_email is null or new.user_id is not null then
    return new;
  end if;

  select * into existing from public.profiles where email = new.invite_email;
  if found then
    new.user_id := existing.id;
    if existing.role_id = 'public' then
      update public.profiles set role_id = 'athlete' where id = existing.id;
    end if;
  else
    insert into public.invites (email, name, role_id, invited_by)
    values (new.invite_email, new.name, 'athlete', auth.uid())
    on conflict (email) do nothing;
  end if;
  return new;
end;
$$;

create trigger link_athlete_email
  before insert or update on public.athletes
  for each row execute function public.link_athlete_email();

-- ---------------------------------------------------------------------------
-- Safety: the last active Admin can't be demoted, disabled or deleted
-- ---------------------------------------------------------------------------

create function public.keep_one_admin() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if old.role_id = 'admin' and old.status = 'active'
     and (tg_op = 'DELETE' or new.role_id <> 'admin' or new.status <> 'active')
     and not exists (
       select 1 from public.profiles
       where role_id = 'admin' and status = 'active' and id <> old.id
     ) then
    raise exception 'There must always be at least one active Admin' using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger keep_one_admin
  before update or delete on public.profiles
  for each row execute function public.keep_one_admin();

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.profiles enable row level security;
alter table public.invites enable row level security;
alter table public.athletes enable row level security;

create policy "read roles" on public.roles for select to anon, authenticated using (true);
create policy "read permissions" on public.permissions for select to anon, authenticated using (true);

create policy "read grants" on public.role_permissions for select to authenticated using (true);
create policy "manage grants" on public.role_permissions for all to authenticated
  using (public.has_permission('roles:manage') and role_id <> 'admin')
  with check (public.has_permission('roles:manage') and role_id <> 'admin');

create policy "read own profile or all as user manager" on public.profiles for select to authenticated
  using (id = auth.uid() or public.has_permission('users:manage'));
create policy "manage profiles" on public.profiles for update to authenticated
  using (public.has_permission('users:manage'))
  with check (public.has_permission('users:manage'));

create policy "manage invites" on public.invites for all to authenticated
  using (public.has_permission('users:manage'))
  with check (public.has_permission('users:manage'));

create policy "read athletes" on public.athletes for select to authenticated
  using (public.has_permission('athletes:read'));
create policy "add athletes" on public.athletes for insert to authenticated
  with check (public.has_permission('athletes:create') and public.has_permission('athletes:write', coach_id));
create policy "edit athletes" on public.athletes for update to authenticated
  using (public.has_permission('athletes:write', coach_id) or public.has_permission('athletes:write', user_id))
  with check (public.has_permission('athletes:write', coach_id) or public.has_permission('athletes:write', user_id));
create policy "remove athletes" on public.athletes for delete to authenticated
  using (public.has_permission('athletes:write', coach_id));

-- Only signed-in users call these; the trigger functions aren't callable directly.
revoke execute on function public.invite_user(text, text, text) from public, anon;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.link_athlete_email() from public, anon, authenticated;
revoke execute on function public.keep_one_admin() from public, anon, authenticated;
