-- People on the Officials list couldn't sign in for the first time (Bhavek 2026-11-12).
-- Run after 20261105030000_sparring_no_weigh_in.sql. Safe to run more than once.
--
-- On a first sign-in, handle_new_user links the new account to its Officials list row
-- (update officials set user_id = ...). The link_official_email trigger on officials refused any
-- change of user_id by someone without users:manage. During sign-in nobody is signed in yet
-- (auth.uid() is null), so it raised "Only Admins can change an official's login", Supabase
-- refused the new account with "Database error saving new user", and the sign-in page said the
-- person "hasn't been invited".
--
-- Now the check only applies to a signed-in person. Changes made by the database itself (the
-- sign-in trigger, the SQL editor) go through, the same way check_club_member already works.

create or replace function public.link_official_email() returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  existing public.profiles;
begin
  new.invite_email := nullif(lower(trim(new.invite_email)), '');
  new.updated_at := now();
  new.updated_by := auth.uid();

  if tg_op = 'UPDATE' and auth.uid() is not null and not public.has_permission('users:manage') then
    if new.user_id is distinct from old.user_id then
      raise exception 'Only Admins can change an official''s login' using errcode = '42501';
    end if;
  end if;

  if new.invite_email is null or new.user_id is not null then
    return new;
  end if;

  select * into existing from public.profiles where lower(email) = new.invite_email;
  if found then
    new.user_id := existing.id;
  else
    insert into public.invites (email, name, role_id, invited_by)
    values (new.invite_email, new.name, 'official', auth.uid())  -- becomes Member (normalize_account_role)
    on conflict (email) do nothing;
  end if;
  return new;
end;
$$;

revoke execute on function public.link_official_email() from public, anon, authenticated;
