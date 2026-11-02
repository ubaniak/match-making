-- Migration 24 (Bhavek, 2026-11-01): "an official is allowed to add other officials".
--
--   * Any official who has accepted an event (and its Chief Official and Deputy) can invite more
--     officials to it and resend invitations. Site Admins still can.
--   * Those officials also see the event's officials lists, so they can see who is already asked.
--   * Bhavek: "adding officials should go through the same onboarding flow as users". Whoever can
--     invite can also add someone who isn't on the Officials list yet, by name and email: they go
--     on the Officials list, get an Official account invite (or their account is linked), get the
--     same welcome email as Admin > Users, and get the event invitation.
--   * Unchanged: only site Admins and the Chief Official cancel invitations or remove officials;
--     only a site Admin picks the Chief Official; a site Admin or the Chief Official picks the Deputy.

-- Site Admins, the Chief Official and Deputy, and officials who accepted the event.
create function public.can_add_officials(p_event_id uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select public.can_invite_officials(p_event_id)
      or public.event_official_role(p_event_id) is not null
      or public.is_accepted_official(p_event_id)
$$;

create or replace function public.can_see_official_lists(p_event_id uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select public.is_owner_or_admin(p_event_id)
      or public.event_official_role(p_event_id) is not null
      or public.is_accepted_official(p_event_id)
$$;

create or replace function public.list_invitable_officials(p_event_id uuid)
returns table (id uuid, name text, email text, signed_in boolean)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.can_add_officials(p_event_id) then
    raise exception 'Only a site Admin or an official on this event can invite officials' using errcode = '42501';
  end if;
  return query
    select o.id, o.name, o.invite_email, o.user_id is not null
    from public.officials o
    where o.invite_email is not null
    order by o.name;
end;
$$;

create or replace function public.invite_officials(p_event_id uuid, p_official_ids uuid[], p_respond_by date default null)
returns setof uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_event public.events;
  v_official uuid;
  v_id uuid;
begin
  if not public.can_add_officials(p_event_id) then
    raise exception 'Only a site Admin or an official on this event can invite officials' using errcode = '42501';
  end if;
  if not public.event_is_open(p_event_id) then
    raise exception 'Officials can be invited once the event is Active, and until it is over' using errcode = '22023';
  end if;
  select * into v_event from public.events where id = p_event_id;
  if p_respond_by is not null and p_respond_by < public.local_today(v_event.timezone) then
    raise exception 'The respond-by date has already passed' using errcode = '22023';
  end if;
  if p_respond_by is not null and p_respond_by > v_event.end_date then
    raise exception 'The respond-by date must be on or before the event''s last day' using errcode = '22023';
  end if;
  if coalesce(array_length(p_official_ids, 1), 0) = 0 then
    raise exception 'Choose at least one official' using errcode = '22023';
  end if;

  foreach v_official in array p_official_ids loop
    if not exists (select 1 from public.officials where id = v_official and invite_email is not null) then
      raise exception 'Only officials with an email can be invited' using errcode = '23514';
    end if;
    insert into public.official_invitations (event_id, official_id, respond_by)
    values (p_event_id, v_official, p_respond_by)
    on conflict (event_id, official_id) do update
      set status = 'pending', respond_by = excluded.respond_by, invited_by = auth.uid(),
          invited_at = now(), responded_at = null
      where official_invitations.status <> 'accepted'
    returning id into v_id;
    if v_id is not null then
      return next v_id;
    end if;
    v_id := null;
  end loop;
end;
$$;

create or replace function public.official_invitation_email(p_invitation_id uuid)
returns table (
  official_name text, email text, event_name text, venue text, start_date date, end_date date, respond_by date
)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not exists (
    select 1 from public.official_invitations
    where id = p_invitation_id and public.can_add_officials(event_id)
  ) then
    return;
  end if;
  return query
    select o.name, o.invite_email, e.name, e.venue, e.start_date, e.end_date, i.respond_by
    from public.official_invitations i
    join public.officials o on o.id = i.official_id
    join public.events e on e.id = i.event_id
    where i.id = p_invitation_id;
end;
$$;

-- Adds someone to the Officials list (if their email isn't on it yet) and invites them to the
-- event. The officials trigger links their account or invites the email as an Official, the same
-- as Admin > Add a user. Returns the invitation and whether this made a new account invite, so
-- the app sends the welcome email and then the invitation email.
create function public.add_event_official(p_event_id uuid, p_name text, p_email text, p_respond_by date default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_name text := nullif(trim(coalesce(p_name, '')), '');
  v_official uuid;
  v_new_account boolean;
  v_invitation uuid;
begin
  if not public.can_add_officials(p_event_id) then
    raise exception 'Only a site Admin or an official on this event can invite officials' using errcode = '42501';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'That email address doesn''t look right' using errcode = '22023';
  end if;
  if v_name is null then
    raise exception 'Give the official''s name' using errcode = '22023';
  end if;

  v_new_account := not exists (select 1 from public.profiles where email = v_email)
               and not exists (select 1 from public.invites where email = v_email);
  select id into v_official from public.officials where invite_email = v_email order by created_at limit 1;
  if v_official is null then
    select o.id into v_official from public.officials o join public.profiles p on p.id = o.user_id where p.email = v_email;
  end if;
  if v_official is null then
    insert into public.officials (name, invite_email) values (v_name, v_email) returning id into v_official;
  end if;

  select x into v_invitation from public.invite_officials(p_event_id, array[v_official], p_respond_by) x limit 1;
  if v_invitation is null then
    raise exception 'That official has already accepted this event' using errcode = '23505';
  end if;
  return jsonb_build_object('invitation_id', v_invitation, 'official_id', v_official, 'new_account', v_new_account);
end;
$$;

-- What the welcome email says. Site Admins can send it to anyone; an official can send it to
-- someone invited to an event where they can invite officials. Returns nothing otherwise.
create function public.welcome_email_details(p_email text)
returns table (name text, role_name text)
language plpgsql stable security definer set search_path = public
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
begin
  if not public.is_site_admin() and not exists (
    select 1 from public.official_invitations i
    join public.officials o on o.id = i.official_id
    where o.invite_email = v_email and public.can_add_officials(i.event_id)
  ) then
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

revoke execute on function public.add_event_official(uuid, text, text, date) from public, anon;
grant execute on function public.add_event_official(uuid, text, text, date) to authenticated;
revoke execute on function public.welcome_email_details(text) from public, anon;
grant execute on function public.welcome_email_details(text) to authenticated;
revoke execute on function public.can_add_officials(uuid) from public, anon;
grant execute on function public.can_add_officials(uuid) to authenticated;
