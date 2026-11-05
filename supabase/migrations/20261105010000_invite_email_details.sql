-- Migration 59 (was 32 before it was renumbered to run after 58): invite emails carry the event's schedule.
-- Club and official invitation emails now list the event's name, dates, venue, each day's weigh-in
-- and bout times (in the event's own time zone), and an optional note from whoever invited.
-- The note isn't stored; the app sends it with the email request.
-- Safe to run more than once.

-- Each bout day of the event, in order:
-- [{ day, weigh_in_start, weigh_in_end, sessions: [{ starts_at, label }] }]. Times are 'HH:MM'
-- in the event's time zone (events.timezone). Only called from the email functions below.
create or replace function public.event_email_schedule(p_event_id uuid)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'day', d.day,
    'weigh_in_start', to_char(d.weigh_in_start, 'HH24:MI'),
    'weigh_in_end', to_char(d.weigh_in_end, 'HH24:MI'),
    'sessions', (
      select coalesce(jsonb_agg(jsonb_build_object('starts_at', to_char(s.starts_at, 'HH24:MI'), 'label', s.label) order by s.starts_at), '[]'::jsonb)
      from public.event_bout_sessions s
      where s.event_id = d.event_id and s.day = d.day
    )
  ) order by d.day), '[]'::jsonb)
  from public.event_days d
  where d.event_id = p_event_id
$$;

revoke execute on function public.event_email_schedule(uuid) from public, anon, authenticated;

-- The official's invitation email, now with the time zone and schedule. Same rule as before:
-- returns nothing unless can_add_officials allows the caller (a site Admin or the event's Chief
-- Officials, migration 49).
-- The return type changes, so the old function is dropped first.
drop function if exists public.official_invitation_email(uuid);
create function public.official_invitation_email(p_invitation_id uuid)
returns table (
  official_name text, email text, event_name text, venue text, start_date date, end_date date, respond_by date,
  timezone text, schedule jsonb
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
    select o.name, o.invite_email, e.name, e.venue, e.start_date, e.end_date, i.respond_by,
      e.timezone, public.event_email_schedule(e.id)
    from public.official_invitations i
    join public.officials o on o.id = i.official_id
    join public.events e on e.id = i.event_id
    where i.id = p_invitation_id;
end;
$$;

revoke execute on function public.official_invitation_email(uuid) from public, anon;
grant execute on function public.official_invitation_email(uuid) to authenticated;

-- A club's invitation email: one row per active owner of a club that is invited to the event
-- (club_status 'invited': an owner must accept first, migration 36) or already in it
-- ('accepted'). Returns nothing unless the caller is the event's Owner or a site Admin (the
-- people who invite clubs). Dropped first so the return type can change on a re-run.
drop function if exists public.club_invitation_email(uuid, uuid);
create function public.club_invitation_email(p_event_id uuid, p_club_id uuid)
returns table (
  owner_name text, email text, club_name text, event_name text, venue text, start_date date, end_date date,
  timezone text, schedule jsonb, club_status text
)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not coalesce(public.is_site_admin() or public.is_event_owner(p_event_id), false) then
    return;
  end if;
  return query
    select p.name, p.email, c.name, e.name, e.venue, e.start_date, e.end_date,
      e.timezone, public.event_email_schedule(e.id), ec.status
    from public.event_clubs ec
    join public.events e on e.id = ec.event_id
    join public.clubs c on c.id = ec.club_id
    join public.club_members m on m.club_id = c.id and m.role = 'owner' and m.status = 'active'
    join public.profiles p on p.id = m.user_id
    where ec.event_id = p_event_id and ec.club_id = p_club_id and ec.status in ('invited', 'accepted')
      and p.email is not null;
end;
$$;

revoke execute on function public.club_invitation_email(uuid, uuid) from public, anon;
grant execute on function public.club_invitation_email(uuid, uuid) to authenticated;
