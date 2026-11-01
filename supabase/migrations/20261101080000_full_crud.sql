-- Migration 16: full create, read, update and delete for users and officials (Bhavek,
-- 2026-11-01: "full CRUD for everything, including users").
--
--   * Users: site Admins already edit profiles and invites directly (row-level security). This
--     adds delete_user, which removes an account entirely. It refuses to delete your own account,
--     the last active Admin (the existing keep_one_admin guard), or someone who still owns an
--     event; disabling the account is the alternative.
--   * Officials: deleting an official also takes them off any event where they were the Chief
--     Official or Deputy (their invitations already go with them).

-- ---------------------------------------------------------------------------
-- Delete a user
-- ---------------------------------------------------------------------------

create function public.delete_user(p_user_id uuid) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.has_permission('users:manage') then
    raise exception 'Only Admins can delete users' using errcode = '42501';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'You can''t delete your own account' using errcode = '42501';
  end if;
  if exists (select 1 from public.event_members where user_id = p_user_id and role = 'owner') then
    raise exception 'This user owns an event. Change the event''s Owner first, or disable the user instead.' using errcode = '23503';
  end if;
  begin
    -- The profile goes with the account (on delete cascade), which runs keep_one_admin.
    delete from auth.users where id = p_user_id;
  exception when foreign_key_violation then
    raise exception 'This user is still linked to other records. Disable the user instead.' using errcode = '23503';
  end;
end;
$$;

revoke execute on function public.delete_user(uuid) from public, anon;
grant execute on function public.delete_user(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Deleting an official
-- ---------------------------------------------------------------------------

create function public.forget_deleted_official() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if old.user_id is not null then
    delete from public.event_officials eo
    where eo.user_id = old.user_id
      and exists (
        select 1 from public.official_invitations i
        where i.official_id = old.id and i.event_id = eo.event_id
      );
  end if;
  return old;
end;
$$;

create trigger forget_deleted_official
  before delete on public.officials
  for each row execute function public.forget_deleted_official();

revoke execute on function public.forget_deleted_official() from public, anon, authenticated;
