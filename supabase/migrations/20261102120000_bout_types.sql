-- Migration 25: bout types.
--
-- Every bout is one of three types:
--   * scored        must obey every match rule. No override. Needs both corners and an official.
--   * developmental the match rules apply, but the Chief Official, Deputy or a site Admin can
--                   override a rule break by giving a reason. The reason, who gave it, when, and the
--                   rules it broke are kept on the bout. Still needs both corners and an official.
--   * sparring      the match rules apply, but no approval is needed: the bout is Approved as soon
--                   as it is made.
-- Male against female is always blocked, whatever the type.
--
-- The rule check runs in the app (app/src/matching.js); it sends the rule breaks it found as
-- p_blocks, the same way it already sends p_warnings.

alter table public.bouts
  add column bout_type text not null default 'scored' check (bout_type in ('scored', 'developmental', 'sparring')),
  -- Developmental only: the rules an official overrode, and why.
  add column override_blocks text[] not null default '{}',
  add column override_reason text check (override_reason is null or length(override_reason) <= 500),
  add column override_by uuid references public.profiles (id) on delete set null,
  add column override_at timestamptz,
  add constraint bouts_override_only_developmental check (
    (override_reason is null and cardinality(override_blocks) = 0) or bout_type = 'developmental'
  );

-- Sparring bouts are approved without approvals; every other type works it out from them.
create or replace function public.refresh_bout_status(p_bout_id uuid) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_rejected boolean;
  v_approved integer;
begin
  select bool_or(decision = 'rejected'), count(*) filter (where decision = 'approved')
  into v_rejected, v_approved
  from public.bout_approvals where bout_id = p_bout_id;
  update public.bouts
  set status = case
    when bout_type = 'sparring' then 'approved'
    when coalesce(v_rejected, false) then 'rejected'
    when v_approved = 3 then 'approved'
    else 'pending' end
  where id = p_bout_id and status <> 'cancelled';
end;
$$;

-- Make a bout (p_bout_id null) or re-match one. Re-matching clears its approvals.
-- p_blocks, p_warnings and p_needs_supervisor come from the app's rule check.
drop function public.save_bout(uuid, uuid, date, uuid, uuid, boolean, text[]);
create function public.save_bout(
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

  -- Rule breaks: only a Developmental bout, overridden by an official with a reason.
  if cardinality(v_blocks) > 0 then
    if v_type = 'scored' then
      raise exception 'A Scored bout must follow every match rule' using errcode = '23514';
    elsif v_type = 'sparring' then
      raise exception 'A Sparring bout must follow the match rules' using errcode = '23514';
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

-- Sparring bouts aren't approved or rejected.
create or replace function public.decide_bout(p_bout_id uuid, p_side text, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_bout public.bouts;
  v_club uuid;
  v_override boolean := false;
begin
  select * into v_bout from public.bouts where id = p_bout_id for update;
  if not found then
    raise exception 'That bout no longer exists' using errcode = 'P0002';
  end if;
  if v_bout.bout_type = 'sparring' then
    raise exception 'Sparring bouts don''t need approval' using errcode = '22023';
  end if;
  if v_bout.status = 'cancelled' or v_bout.winner is not null then
    raise exception 'This bout can no longer be approved or rejected' using errcode = '22023';
  end if;
  if not public.card_open(v_bout.event_id) then
    raise exception 'The event isn''t Active' using errcode = '22023';
  end if;
  if p_side = 'official' then
    if not public.is_event_official(v_bout.event_id) then
      raise exception 'Only the Chief Official or Deputy gives the official approval' using errcode = '42501';
    end if;
  elsif p_side in ('red', 'blue') then
    v_club := case when p_side = 'red' then v_bout.red_club_id else v_bout.blue_club_id end;
    if not coalesce(public.club_role(v_club) = 'owner', false) and not public.is_site_admin() then
      if v_bout.after_weigh_in and public.event_official_role(v_bout.event_id) is not null then
        v_override := true;
      else
        raise exception 'Only that corner''s club Owners can approve for it' using errcode = '42501';
      end if;
    end if;
  else
    raise exception 'Unknown side' using errcode = '22023';
  end if;

  insert into public.bout_approvals (bout_id, side, decision, note, override)
  values (p_bout_id, p_side, case when p_approve then 'approved' else 'rejected' end, nullif(trim(p_note), ''), v_override)
  on conflict (bout_id, side) do update
    set decision = excluded.decision, note = excluded.note, override = excluded.override,
        decided_by = auth.uid(), decided_at = now();
  perform public.refresh_bout_status(p_bout_id);
end;
$$;

revoke execute on function public.save_bout(uuid, uuid, date, uuid, uuid, boolean, text[], text, text[], text) from public, anon;
grant execute on function public.save_bout(uuid, uuid, date, uuid, uuid, boolean, text[], text, text[], text) to authenticated;
