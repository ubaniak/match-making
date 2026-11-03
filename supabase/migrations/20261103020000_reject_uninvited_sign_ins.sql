-- Only people we know about can sign in (Bhavek 2026-11-03).
--
-- "Know about" means one of:
--   * they already have an account (a profiles row, even a disabled one; the app handles disabled),
--   * a site Admin, an Official or the CO invited them (an invites row: Admin > Users, or adding a
--     new official on an event),
--   * they are on the Officials list with that email,
--   * a demo account from the test data (@demo.test).
-- Anyone else is turned away before Supabase creates an account or sends an email.
--
-- Two layers:
--   1. email_is_invited(email), which the sign-in page asks first so it can say so straight away
--      and no email goes out.
--   2. A trigger on auth.users that refuses to create the account anyway. This also covers Google
--      sign-in and anyone calling Supabase directly. Supabase reports it as
--      "Database error saving new user", which the app turns into the same plain message.

create or replace function public.email_is_invited(p_email text) returns boolean
language sql stable security definer set search_path = public
as $$
  with e as (select lower(trim(coalesce(p_email, ''))) as email)
  select e.email <> '' and (
       e.email like '%@demo.test'
    or exists (select 1 from public.profiles p where lower(p.email) = e.email)
    or exists (select 1 from public.invites i where i.email = e.email)
    or exists (select 1 from public.officials o where lower(o.invite_email) = e.email)
  )
  from e;
$$;

revoke execute on function public.email_is_invited(text) from public;
grant execute on function public.email_is_invited(text) to anon, authenticated;

create or replace function public.reject_uninvited_sign_up() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if not public.email_is_invited(new.email) then
    raise exception 'This email has not been invited' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke execute on function public.reject_uninvited_sign_up() from public, anon, authenticated;

drop trigger if exists reject_uninvited_sign_up on auth.users;
create trigger reject_uninvited_sign_up
  before insert on auth.users
  for each row execute function public.reject_uninvited_sign_up();

-- Club Owners could only invite people who had already signed in, and the message told them to
-- "ask them to sign in once". That no longer works for strangers, so point them at a site Admin.
create or replace function public.invite_club_member(p_club_id uuid, p_email text, p_role text default 'coach')
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_user public.profiles;
  v_admin boolean := public.is_site_admin();
begin
  if not (v_admin or coalesce(public.club_role(p_club_id) = 'owner', false)) then
    raise exception 'Only the club''s Owners can invite people' using errcode = '42501';
  end if;
  if coalesce(p_role, 'coach') not in ('owner', 'coach') then
    raise exception 'Invite people as an Owner or a Coach' using errcode = '22023';
  end if;
  select * into v_user from public.profiles where lower(email) = lower(trim(p_email));
  if v_user.id is null then
    raise exception '% doesn''t have an account yet. Ask a site Admin to add them in Admin > Users; once they''ve signed in, invite them here.', lower(trim(p_email))
      using errcode = '23514';
  end if;
  if v_user.status <> 'active' then
    raise exception '% is disabled', lower(trim(p_email)) using errcode = '23514';
  end if;
  if exists (select 1 from public.club_members where club_id = p_club_id and user_id = v_user.id) then
    raise exception '% is already in the club or invited', lower(trim(p_email)) using errcode = '23505';
  end if;
  insert into public.club_members (club_id, user_id, role, status)
  values (p_club_id, v_user.id, coalesce(p_role, 'coach'), case when v_admin then 'active' else 'pending' end);
  return coalesce(nullif(trim(v_user.name), ''), v_user.email);
end;
$$;

revoke execute on function public.invite_club_member(uuid, text, text) from public, anon;
grant execute on function public.invite_club_member(uuid, text, text) to authenticated;
