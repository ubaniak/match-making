-- Migration 15: the Chief Official and Deputy also see who accepted, declined or hasn't
-- answered an event's officials invitations (Bhavek, 2026-11-01). Inviting, re-inviting and
-- removing officials stay with the Owner and site Admins.

-- Owner, site Admin, Chief Official or Deputy.
create function public.can_see_official_lists(p_event_id uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select public.is_owner_or_admin(p_event_id) or public.event_official_role(p_event_id) is not null
$$;

create or replace function public.list_event_invitations(p_event_id uuid)
returns table (
  id uuid, official_id uuid, name text, email text, user_id uuid, status text, respond_by date,
  invited_at timestamptz, responded_at timestamptz
)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.can_see_official_lists(p_event_id) then
    return;
  end if;
  return query
    select i.id, i.official_id, o.name, o.invite_email, o.user_id, i.status, i.respond_by, i.invited_at, i.responded_at
    from public.official_invitations i
    join public.officials o on o.id = i.official_id
    where i.event_id = p_event_id
    order by o.name;
end;
$$;

drop policy "read official invitations" on public.official_invitations;
create policy "read official invitations" on public.official_invitations for select to authenticated
  using (
    public.can_see_official_lists(event_id)
    or exists (select 1 from public.officials o where o.id = official_id and o.user_id = auth.uid())
  );
