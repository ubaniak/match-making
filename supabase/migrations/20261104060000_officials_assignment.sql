-- Migration 47 (Bhavek, 2026-11-04): the Officials assignment tab.
--
--   "Assign officials to all the tasks during the night ... the chief official approves the plan
--    and has the ability to change it by hand ... once the chief official finalizes and approves
--    the plan, all the officials that are at the bout can see it."
--
--   * A plan is per event day: for each bout on that night's card, what each official working the
--     night does: judge, referee, supervisor, timekeeper or rest. The app makes the plan from the
--     rules (app/src/officialPlan.js); the Chief Officials can change any of it and save it.
--   * Only the event's two Chief Officials (and a site Admin) see and change a draft plan.
--   * Approving checks every bout has exactly 1 referee, 1 supervisor and at least 3 judges. It then
--     puts the plan on the bouts (bout_officials, migrations 41 and 42), replacing what officials
--     had taken themselves, and tells the officials working that night. From then on every official
--     who accepted the event can see the plan, read-only.
--   * "Change plan" takes it back to draft: officials stop seeing it until it is approved again.
--     The bouts keep the approved officials until then.
--   * On the day the Chief Officials can also change which roles an official can do (the Judge,
--     Referee, Supervisor and Timekeeper ticks from migration 42).
--
-- Run after migration 46 (20261104050000_remove_test_data.sql).

create table public.official_plans (
  event_id uuid not null references public.events (id) on delete cascade,
  day date not null,
  status text not null default 'draft' check (status in ('draft', 'approved')),
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  approved_by uuid references public.profiles (id) on delete set null,
  approved_at timestamptz,
  primary key (event_id, day)
);

create table public.official_plan_slots (
  event_id uuid not null,
  day date not null,
  bout_id uuid not null references public.bouts (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null check (role in ('judge', 'referee', 'supervisor', 'timekeeper', 'rest')),
  primary key (bout_id, user_id),
  foreign key (event_id, day) references public.official_plans (event_id, day) on delete cascade
);

create index official_plan_slots_day_idx on public.official_plan_slots (event_id, day);

alter table public.official_plans enable row level security;
alter table public.official_plan_slots enable row level security;

-- Chief Officials and site Admins plan; officials who accepted the event see approved plans.
create function public.can_plan_officials(p_event_id uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select public.is_site_admin() or public.is_event_chief(p_event_id)
$$;

create function public.can_see_official_plan(p_event_id uuid, p_day date) returns boolean
language sql stable security definer set search_path = public
as $$
  select public.can_plan_officials(p_event_id)
    or (public.is_accepted_official(p_event_id) and exists (
      select 1 from public.official_plans where event_id = p_event_id and day = p_day and status = 'approved'
    ))
$$;

create policy "read official plans" on public.official_plans for select to authenticated
  using (public.can_see_official_plan(event_id, day));
create policy "read official plan slots" on public.official_plan_slots for select to authenticated
  using (public.can_see_official_plan(event_id, day));

-- Writes go through the functions below only.
revoke insert, update, delete on public.official_plans from anon, authenticated;
revoke insert, update, delete on public.official_plan_slots from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Reading
-- ---------------------------------------------------------------------------

-- The officials working a day: accepted the event and that day. Planners only.
create function public.list_day_officials(p_event_id uuid, p_day date)
returns table (
  user_id uuid, official_id uuid, name text, level integer,
  judge boolean, referee boolean, supervisor boolean, timekeeper boolean
)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.can_see_official_plan(p_event_id, p_day) then
    return;
  end if;
  return query
    select o.user_id, o.id, coalesce(nullif(o.name, ''), p.name, p.email), o.level,
      i.judge, i.referee, i.supervisor, i.timekeeper
    from public.official_invitations i
    join public.officials o on o.id = i.official_id
    join public.profiles p on p.id = o.user_id and p.status = 'active'
    where i.event_id = p_event_id and i.status = 'accepted' and p_day = any (i.days)
    order by 3;
end;
$$;

-- ---------------------------------------------------------------------------
-- Planning
-- ---------------------------------------------------------------------------

-- Save a day's plan as a draft. p_slots: [{ bout_id, user_id, role }]. Replaces the whole day.
create function public.save_official_plan(p_event_id uuid, p_day date, p_slots jsonb) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.can_plan_officials(p_event_id) then
    raise exception 'Only the event''s Chief Officials can plan the officials' using errcode = '42501';
  end if;
  if not public.card_open(p_event_id) then
    raise exception 'Officials can be planned only while the event is Active' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(coalesce(p_slots, '[]')) s (bout_id uuid, user_id uuid, role text)
    left join public.bouts b on b.id = s.bout_id and b.event_id = p_event_id and b.day = p_day
    where b.id is null
  ) then
    raise exception 'The plan has a bout that isn''t on this day''s card. Reload and try again.' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(coalesce(p_slots, '[]')) s (bout_id uuid, user_id uuid, role text)
    where s.user_id not in (select d.user_id from public.list_day_officials(p_event_id, p_day) d)
  ) then
    raise exception 'The plan has someone who isn''t working this day. Reload and try again.' using errcode = '22023';
  end if;

  insert into public.official_plans (event_id, day, status, updated_by, updated_at)
  values (p_event_id, p_day, 'draft', auth.uid(), now())
  on conflict (event_id, day) do update
    set status = 'draft', updated_by = auth.uid(), updated_at = now(), approved_by = null, approved_at = null;

  delete from public.official_plan_slots where event_id = p_event_id and day = p_day;
  insert into public.official_plan_slots (event_id, day, bout_id, user_id, role)
  select distinct on (s.bout_id, s.user_id) p_event_id, p_day, s.bout_id, s.user_id, s.role
  from jsonb_to_recordset(coalesce(p_slots, '[]')) s (bout_id uuid, user_id uuid, role text);
end;
$$;

-- Approve a saved plan: every live bout needs 1 referee, 1 supervisor and 3 or more judges.
-- Puts the plan on the bouts and tells the officials working that day.
create function public.approve_official_plan(p_event_id uuid, p_day date) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_plan public.official_plans;
  v_bad text;
  v_users uuid[];
begin
  if not public.can_plan_officials(p_event_id) then
    raise exception 'Only the event''s Chief Officials can approve the plan' using errcode = '42501';
  end if;
  if not public.card_open(p_event_id) then
    raise exception 'The plan can be approved only while the event is Active' using errcode = '22023';
  end if;
  select * into v_plan from public.official_plans where event_id = p_event_id and day = p_day;
  if not found then
    raise exception 'Save the plan first' using errcode = 'P0002';
  end if;

  select string_agg('bout ' || n::text, ', ') into v_bad
  from (
    select row_number() over (order by b.position) as n, b.id,
      count(*) filter (where s.role = 'referee') as refs,
      count(*) filter (where s.role = 'supervisor') as sups,
      count(*) filter (where s.role = 'judge') as judges
    from public.bouts b
    left join public.official_plan_slots s on s.bout_id = b.id
    where b.event_id = p_event_id and b.day = p_day and b.status not in ('cancelled', 'rejected')
    group by b.id, b.position
  ) t
  where refs <> 1 or sups <> 1 or judges < 3;
  if v_bad is not null then
    raise exception 'Every bout needs 1 referee, 1 supervisor and at least 3 judges. Check %.', v_bad using errcode = '22023';
  end if;

  update public.official_plans
  set status = 'approved', approved_by = auth.uid(), approved_at = now()
  where event_id = p_event_id and day = p_day;

  -- The plan becomes who works each bout (bouts that already have a result keep theirs).
  delete from public.bout_officials bo using public.bouts b
  where b.id = bo.bout_id and b.event_id = p_event_id and b.day = p_day and b.winner is null;
  insert into public.bout_officials (bout_id, user_id, judge, referee, supervisor, timekeeper)
  select s.bout_id, s.user_id, s.role = 'judge', s.role = 'referee', s.role = 'supervisor', s.role = 'timekeeper'
  from public.official_plan_slots s
  join public.bouts b on b.id = s.bout_id and b.winner is null and b.status not in ('cancelled', 'rejected')
  where s.event_id = p_event_id and s.day = p_day and s.role <> 'rest'
  on conflict (bout_id, user_id) do nothing;

  select array_agg(d.user_id) into v_users from public.list_day_officials(p_event_id, p_day) d;
  perform public.add_notification(
    v_users, 'official_plan', 'Officials plan approved: ' || public.event_name(p_event_id),
    to_char(p_day, 'Dy DD Mon YYYY') || '. See what you do on each bout.',
    p_event_id, null, null, 'assignment', null
  );
end;
$$;

-- Take an approved plan back to draft so it can be changed. Officials stop seeing it.
create function public.reopen_official_plan(p_event_id uuid, p_day date) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.can_plan_officials(p_event_id) then
    raise exception 'Only the event''s Chief Officials can change the plan' using errcode = '42501';
  end if;
  update public.official_plans
  set status = 'draft', approved_by = null, approved_at = null, updated_by = auth.uid(), updated_at = now()
  where event_id = p_event_id and day = p_day;
end;
$$;

-- On the day, a Chief Official changes which roles an official can do at the event.
create function public.set_official_event_roles(
  p_event_id uuid, p_user_id uuid,
  p_judge boolean, p_referee boolean, p_supervisor boolean, p_timekeeper boolean
) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.can_plan_officials(p_event_id) then
    raise exception 'Only the event''s Chief Officials can change an official''s roles' using errcode = '42501';
  end if;
  if not (coalesce(p_judge, false) or coalesce(p_referee, false) or coalesce(p_supervisor, false) or coalesce(p_timekeeper, false)) then
    raise exception 'Leave at least one role ticked' using errcode = '22023';
  end if;
  update public.official_invitations i
  set judge = coalesce(p_judge, false), referee = coalesce(p_referee, false),
      supervisor = coalesce(p_supervisor, false), timekeeper = coalesce(p_timekeeper, false)
  from public.officials o
  where o.id = i.official_id and o.user_id = p_user_id and i.event_id = p_event_id and i.status = 'accepted';
  if not found then
    raise exception 'That official hasn''t accepted this event' using errcode = 'P0002';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Notifications: a new kind for "plan approved"
-- ---------------------------------------------------------------------------

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'availability', 'invitation_answer', 'official_role',
  'bout_approval', 'bout_decision', 'bout_cancelled', 'bout_comment', 'bout_review',
  'join_request', 'join_answer', 'late_entry', 'late_entry_answer',
  'transfer', 'transfer_answer', 'member_request', 'member_answer',
  'event_role', 'event_status',
  'club_invite', 'club_invite_answer',
  'official_plan'
));

grant execute on function public.can_plan_officials(uuid) to authenticated;
grant execute on function public.can_see_official_plan(uuid, date) to authenticated;
grant execute on function public.list_day_officials(uuid, date) to authenticated;
grant execute on function public.save_official_plan(uuid, date, jsonb) to authenticated;
grant execute on function public.approve_official_plan(uuid, date) to authenticated;
grant execute on function public.reopen_official_plan(uuid, date) to authenticated;
grant execute on function public.set_official_event_roles(uuid, uuid, boolean, boolean, boolean, boolean) to authenticated;
