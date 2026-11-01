-- Migration 18: "Send for approval" for bouts.
--
-- The Owner, the Chief Official or Deputy, or a site Admin sends a bout (or every waiting bout at
-- once) to the people who still have to approve it: each corner's club Owners, and the event's
-- Chief Official and Deputy for the official approval. The app emails each person once, listing
-- all their bouts. The bout remembers when it was last sent, and re-matching clears that.

alter table public.bouts
  add column approval_requested_at timestamptz,
  add column approval_requested_by uuid references public.profiles (id) on delete set null;

-- Re-matching (new boxers or a new day) means the bout has to be sent again.
create function public.clear_bout_approval_request() returns trigger
language plpgsql set search_path = public
as $$
begin
  if new.red_athlete_id is distinct from old.red_athlete_id
    or new.blue_athlete_id is distinct from old.blue_athlete_id
    or new.day is distinct from old.day then
    new.approval_requested_at := null;
    new.approval_requested_by := null;
  end if;
  return new;
end;
$$;

create trigger bouts_clear_approval_request
  before update of red_athlete_id, blue_athlete_id, day on public.bouts
  for each row execute function public.clear_bout_approval_request();

-- Marks the bouts as sent and returns who to tell: one row per bout, side still waiting, and
-- person. Only bouts that are waiting for approval (not approved, rejected, cancelled or with a
-- result) are sent, and only by the event's Owner, its Chief Official or Deputy, or a site Admin.
-- bout_number is the bout's place on that day's card.
create function public.request_bout_approvals(p_bout_ids uuid[])
returns table (
  bout_id uuid, side text, recipient_name text, recipient_email text,
  event_name text, venue text, day date, bout_number integer,
  red_name text, red_club text, blue_name text, blue_club text
)
language plpgsql security definer set search_path = public
as $$
#variable_conflict use_column
declare
  v_event uuid;
begin
  if p_bout_ids is null or cardinality(p_bout_ids) = 0 then
    return;
  end if;
  for v_event in select distinct b.event_id from public.bouts b where b.id = any (p_bout_ids) loop
    if not (public.is_owner_or_admin(v_event) or public.is_event_official(v_event)) then
      raise exception 'Only the event''s Owner, its Chief Official or Deputy, or a site Admin can send bouts for approval' using errcode = '42501';
    end if;
    if not public.card_open(v_event) then
      raise exception 'Bouts can be sent for approval only while the event is Active' using errcode = '22023';
    end if;
  end loop;

  update public.bouts b
  set approval_requested_at = now(), approval_requested_by = auth.uid()
  where b.id = any (p_bout_ids) and b.status = 'pending' and b.winner is null;

  return query
    with sent as (
      select b.*,
        (select count(*)::integer from public.bouts x
         where x.event_id = b.event_id and x.day = b.day and x.status <> 'cancelled'
           and (x.position < b.position or (x.position = b.position and x.id <= b.id))) as num
      from public.bouts b
      where b.id = any (p_bout_ids) and b.status = 'pending' and b.winner is null
    ),
    waiting as (
      select s.id, sides.side
      from sent s
      cross join (values ('red'), ('blue'), ('official')) as sides (side)
      where not exists (
        select 1 from public.bout_approvals a where a.bout_id = s.id and a.side = sides.side and a.decision = 'approved'
      )
    ),
    people as (
      select w.id, w.side, p.name, p.email
      from waiting w
      join sent s on s.id = w.id
      join public.club_members m on m.club_id = case w.side when 'red' then s.red_club_id else s.blue_club_id end
        and m.role = 'owner' and m.status = 'active'
      join public.profiles p on p.id = m.user_id and p.status = 'active'
      where w.side in ('red', 'blue')
      union all
      select w.id, w.side, p.name, p.email
      from waiting w
      join sent s on s.id = w.id
      join public.event_officials o on o.event_id = s.event_id
      join public.profiles p on p.id = o.user_id and p.status = 'active'
      where w.side = 'official'
    )
    select s.id, pe.side, pe.name, pe.email,
      e.name, e.venue, s.day, s.num,
      ra.name, rc.name, ba.name, bc.name
    from people pe
    join sent s on s.id = pe.id
    join public.events e on e.id = s.event_id
    join public.athletes ra on ra.id = s.red_athlete_id
    join public.athletes ba on ba.id = s.blue_athlete_id
    left join public.clubs rc on rc.id = s.red_club_id
    left join public.clubs bc on bc.id = s.blue_club_id
    where pe.email is not null
    order by pe.email, s.day, s.num, pe.side;
end;
$$;

revoke execute on function public.clear_bout_approval_request() from public, anon, authenticated;
revoke execute on function public.request_bout_approvals(uuid[]) from public, anon;
grant execute on function public.request_bout_approvals(uuid[]) to authenticated;
