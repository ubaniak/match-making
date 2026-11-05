-- Sparring bouts skip the match rules (Bhavek, 2026-11-05): age, weight and experience gaps don't
-- block a Sparring bout and no override reason is needed. It is still approved as soon as it is
-- made, with no club owner or Chief Official approval (unchanged since migration 25).
-- Male against female is still always blocked here; the app also keeps blocking "too young to
-- box" and missing details, which it never sends as rule breaks for Sparring.
-- Same signature as migration 25, so this is a plain replace. Run after 57 (20261104160000).

create or replace function public.save_bout(
  p_bout_id uuid,
  p_event_id uuid,
  p_day date,
  p_red_athlete_id uuid,
  p_blue_athlete_id uuid,
  p_needs_supervisor boolean default false,
  p_warnings text[] default '{}',
  p_bout_type text default 'scored',
  p_blocks text[] default '{}',
  p_override_reason text default null
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_event public.events;
  v_red public.event_athletes;
  v_blue public.event_athletes;
  v_old public.bouts;
  v_id uuid;
  v_type text := coalesce(p_bout_type, 'scored');
  v_blocks text[] := coalesce(p_blocks, '{}');
  v_reason text := nullif(trim(p_override_reason), '');
  v_status text;
begin
  select * into v_event from public.events where id = p_event_id;
  if not found then
    raise exception 'That event no longer exists' using errcode = 'P0002';
  end if;
  if v_type not in ('scored', 'developmental', 'sparring') then
    raise exception 'Pick Scored, Developmental or Sparring' using errcode = '22023';
  end if;
  if p_bout_id is not null then
    select * into v_old from public.bouts where id = p_bout_id and event_id = p_event_id for update;
    if not found then
      raise exception 'That bout no longer exists' using errcode = 'P0002';
    end if;
    if v_old.winner is not null then
      raise exception 'This bout has a result, so it can''t be re-matched' using errcode = '22023';
    end if;
    if not coalesce(public.can_match(p_event_id, v_old.day), false) then
      raise exception 'After the weigh-in starts, only the Chief Official or Deputy can change bouts' using errcode = '42501';
    end if;
  end if;
  if not coalesce(public.can_match(p_event_id, p_day), false) then
    if public.is_event_owner(p_event_id) then
      raise exception 'The weigh-in for that day has started, so only the Chief Official or Deputy can make bouts' using errcode = '42501';
    end if;
    raise exception 'Only the event''s Owner or officials can make bouts' using errcode = '42501';
  end if;
  if not public.card_open(p_event_id) then
    raise exception 'Bouts can be made only while the event is Active' using errcode = '22023';
  end if;
  if p_day is null or p_day < v_event.start_date or p_day > v_event.end_date then
    raise exception 'Pick a day of the event' using errcode = '22023';
  end if;
  if p_red_athlete_id is null or p_blue_athlete_id is null or p_red_athlete_id = p_blue_athlete_id then
    raise exception 'Pick two different athletes' using errcode = '22023';
  end if;
  select * into v_red from public.event_athletes where event_id = p_event_id and athlete_id = p_red_athlete_id;
  select * into v_blue from public.event_athletes where event_id = p_event_id and athlete_id = p_blue_athlete_id;
  if v_red.athlete_id is null or v_blue.athlete_id is null then
    raise exception 'Both athletes must be entered in the event' using errcode = '23514';
  end if;
  if (select gender from public.athletes where id = p_red_athlete_id)
     is distinct from (select gender from public.athletes where id = p_blue_athlete_id) then
    raise exception 'Male and female athletes can''t box each other' using errcode = '23514';
  end if;

  -- Sparring skips the match rules, so any rule breaks the app found don't matter.
  if v_type = 'sparring' then
    v_blocks := '{}';
  end if;

  -- Rule breaks: only a Developmental bout, overridden by an official with a reason.
  if cardinality(v_blocks) > 0 then
    if v_type = 'scored' then
      raise exception 'A Scored bout must follow every match rule' using errcode = '23514';
    elsif not public.is_event_official(p_event_id) then
      raise exception 'Only the Chief Official or Deputy can override the match rules' using errcode = '42501';
    elsif v_reason is null then
      raise exception 'Give a reason for overriding the match rules' using errcode = '22023';
    end if;
  else
    v_reason := null;
  end if;

  if exists (
    select 1 from public.bouts b
    where b.event_id = p_event_id and b.day = p_day and b.status <> 'cancelled'
      and b.id is distinct from p_bout_id
      and (b.red_athlete_id in (p_red_athlete_id, p_blue_athlete_id) or b.blue_athlete_id in (p_red_athlete_id, p_blue_athlete_id))
  ) then
    raise exception 'One of these athletes already has a bout that day' using errcode = '23505';
  end if;

  v_status := case when v_type = 'sparring' then 'approved' else 'pending' end;

  if p_bout_id is null then
    insert into public.bouts (event_id, day, position, red_athlete_id, blue_athlete_id, red_club_id, blue_club_id,
                              needs_supervisor, warnings, after_weigh_in, status, bout_type,
                              override_blocks, override_reason, override_by, override_at)
    values (p_event_id, p_day,
            coalesce((select max(position) + 1 from public.bouts where event_id = p_event_id and day = p_day), 1),
            p_red_athlete_id, p_blue_athlete_id, v_red.club_id, v_blue.club_id,
            coalesce(p_needs_supervisor, false), coalesce(p_warnings, '{}'), public.weigh_in_started(p_event_id, p_day),
            v_status, v_type,
            case when v_reason is null then '{}' else v_blocks end, v_reason,
            case when v_reason is null then null else auth.uid() end,
            case when v_reason is null then null else now() end)
    returning id into v_id;
  else
    delete from public.bout_approvals where bout_id = p_bout_id;
    update public.bouts
    set day = p_day,
        position = case when day = p_day then position
                        else coalesce((select max(position) + 1 from public.bouts where event_id = p_event_id and day = p_day), 1) end,
        session_starts_at = case when day = p_day then session_starts_at end,
        red_athlete_id = p_red_athlete_id, blue_athlete_id = p_blue_athlete_id,
        red_club_id = v_red.club_id, blue_club_id = v_blue.club_id,
        needs_supervisor = coalesce(p_needs_supervisor, false), warnings = coalesce(p_warnings, '{}'),
        after_weigh_in = public.weigh_in_started(p_event_id, p_day),
        status = v_status, bout_type = v_type,
        override_blocks = case when v_reason is null then '{}' else v_blocks end,
        override_reason = v_reason,
        override_by = case when v_reason is null then null else auth.uid() end,
        override_at = case when v_reason is null then null else now() end,
        -- A changed type needs sending for approval again.
        approval_requested_at = case when bout_type = v_type then approval_requested_at end,
        approval_requested_by = case when bout_type = v_type then approval_requested_by end,
        cancel_reason = null, cancelled_at = null,
        made_by = auth.uid(), made_at = now()
    where id = p_bout_id
    returning id into v_id;
  end if;
  return v_id;
end;
$$;
