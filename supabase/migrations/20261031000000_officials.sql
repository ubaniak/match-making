-- Officials, added the same way as athletes: an Admin creates the record, and an optional
-- login email invites that person with the Officials role and links them to it on first sign-in.

create table public.officials (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  qualifications text,
  user_id uuid unique references public.profiles (id) on delete set null,
  invite_email text check (invite_email = lower(invite_email)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);

-- Link a new official's email to an existing account, or invite it as an Official.
create function public.link_official_email() returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  existing public.profiles;
begin
  new.invite_email := nullif(lower(trim(new.invite_email)), '');
  new.updated_at := now();
  new.updated_by := auth.uid();

  if tg_op = 'UPDATE' and not public.has_permission('users:manage') then
    if new.user_id is distinct from old.user_id then
      raise exception 'Only Admins can change an official''s login' using errcode = '42501';
    end if;
  end if;

  if new.invite_email is null or new.user_id is not null then
    return new;
  end if;

  select * into existing from public.profiles where email = new.invite_email;
  if found then
    new.user_id := existing.id;
    if existing.role_id = 'public' then
      update public.profiles set role_id = 'official' where id = existing.id;
    end if;
  else
    insert into public.invites (email, name, role_id, invited_by)
    values (new.invite_email, new.name, 'official', auth.uid())
    on conflict (email) do nothing;
  end if;
  return new;
end;
$$;

create trigger link_official_email
  before insert or update on public.officials
  for each row execute function public.link_official_email();

-- Sign-in now links official records as well as athlete records.
create or replace function public.handle_new_user() returns trigger
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

  update public.officials set user_id = new.id
  where invite_email = new_email and user_id is null;

  delete from public.invites where email = new_email;
  return new;
end;
$$;

alter table public.officials enable row level security;

create policy "read officials" on public.officials for select to authenticated
  using (public.has_permission('officials:read'));
create policy "add officials" on public.officials for insert to authenticated
  with check (public.has_permission('users:manage'));
create policy "edit officials" on public.officials for update to authenticated
  using (public.has_permission('officials:write', user_id))
  with check (public.has_permission('officials:write', user_id));
create policy "remove officials" on public.officials for delete to authenticated
  using (public.has_permission('users:manage'));

revoke execute on function public.link_official_email() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
