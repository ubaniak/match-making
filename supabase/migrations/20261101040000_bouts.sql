-- Migration 12: bout matching (plan/events.md sections 4 to 6).
--
--   * Each event gets a Chief Official (CO) and a Deputy, set by a site Admin or the Owner.
--   * The Owner pairs entered athletes into bouts. A bout needs approval from both corners'
--     club owners and from the CO or Deputy. Any rejection sends it back to the Owner.
--   * Everyone involved can comment on a bout (plain text).
--   * On weigh-in day the CO or Deputy records each athlete's weight and medical. A failed
--     medical or a no-show cancels the athlete's bouts that day. After a day's weigh-in has
--     started, only the CO or Deputy can make or change that day's bouts, and they can approve
--     on a coach's behalf.
--   * The Owner sets the order and session of the card; it stays editable until the event is Done.
--   * The CO or Deputy records results; a result adds one to both boxers' bout counts.
--
-- The age, weight and experience allowances live in the app (app/src/matching.js), which
-- blocks bouts outside them and shows warnings inside them. The database enforces the hard
-- rules that don't need the tables: both boxers entered in the event, same gender, one bout
-- per athlete per day, and who may do what.

-- ---------------------------------------------------------------------------
-- Officials: one Chief Official and one Deputy per event
-- ---------------------------------------------------------------------------

create table public.event_officials (
  event_id uuid not null references public.events (id) on delete cascade,
  role text not null check (role in ('chief', 'deputy')),
  user_id uuid not null references public.profiles (id) on delete cascade,
  added_by uuid default auth.uid() references public.profiles (id) on delete set null,
  added_at timestamptz not null default now(),
  primary key (event_id, role),
  unique (event_id, user_id)
);

-- The signed-in user's official role on an event ('chief', 'deputy' or null).
create function public.event_official_role(p_event_id uuid) returns text
language sql stable security definer set search_path = public
as $$
  select o.role from public.event_officials o
  join public.profiles p on p.id = o.user_id and p.status = 'active'
  where o.event_id = p_event_id and o.user_id = auth.uid()
$$;

-- CO, Deputy or site Admin.
create function public.is_event_official(p_event_id uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select public.is_site_admin() or public.event_official_role(p_event_id) is not null
$$;

-- Officials see the event and its entries too.
create or replace function public.can_read_event(p_event_id uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select public.is_site_admin()
    or public.event_role(p_event_id) is not null
    or public.event_official_role(p_event_id) is not null
    or public.in_event_club(p_event_id)
    or exists (
      select 1 from public.events e
      where e.id = p_event_id and e.status in ('active', 'done') and public.has_permission('pages:read')
    )
$$;

create or replace function public.can_read_entries(p_event_id uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select public.is_site_admin() or public.is_event_owner(p_event_id) or public.in_event_club(p_event_id)
    or public.event_official_role(p_event_id) is not null
$$;

-- Set (or clear, with p_user_id null) the event's CO or Deputy.
create function public.set_event_official(p_event_id uuid, p_role text, p_user_id uuid) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not coalesce(public.can_edit_event(p_event_id), false) then
    raise exception 'Only the event''s Owner or a site Admin can choose its officials' using errcode = '42501';
  end if;
  if p_role not in ('chief', 'deputy') then
    raise exception 'Officials are a Chief Official or a Deputy' using errcode = '22023';
  end if;
  if p_user_id is null then
    delete from public.event_officials where event_id = p_event_id and role = p_role;
    return;
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id and status = 'active') then
    raise exception 'Pick someone who has signed in at least once' using errcode = '23514';
  end if;
  if exists (select 1 from public.event_officials where event_id = p_event_id and user_id = p_user_id and role <> p_role) then
    raise exception 'The Chief Official and the Deputy must be different people' using errcode = '23505';
  end if;
  insert into public.event_officials (event_id, role, user_id) values (p_event_id, p_role, p_user_id)
  on conflict (event_id, role) do update set user_id = excluded.user_id, added_by = auth.uid(), added_at = now();
end;
$$;

-- ---------------------------------------------------------------------------
-- Bouts, approvals, comments, weigh-ins
-- ---------------------------------------------------------------------------

create table public.bouts (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  day date not null,
  -- The bout session it's in, by start time (sessions are re-saved with the day times).
  session_starts_at time,
  position integer not null default 0,
  red_athlete_id uuid not null references public.athletes (id) on delete cascade,
  blue_athlete_id uuid not null references public.athletes (id) on delete cascade,
  red_club_id uuid references public.clubs (id) on delete set null,
  blue_club_id uuid references public.clubs (id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  -- U17 against U19: the official approval also unlocks the age exception.
  needs_supervisor boolean not null default false,
  -- What the app warned about when the bout was made (e.g. 'Novice vs Open, 4 bouts apart').
  warnings text[] not null default '{}',
  after_weigh_in boolean not null default false,
  made_by uuid default auth.uid() references public.profiles (id) on delete set null,
  made_at timestamptz not null default now(),
  cancel_reason text check (cancel_reason is null or length(cancel_reason) <= 300),
  cancelled_at timestamptz,
  winner text check (winner in ('red', 'blue')),
  method text check (method in ('points', 'rsc', 'ko', 'walkover', 'dq', 'abd')),
  result_note text check (result_note is null or length(result_note) <= 500),
  result_by uuid references public.profiles (id) on delete set null,
  result_at timestamptz,
  check (red_athlete_id <> blue_athlete_id),
  check ((winner is null) = (method is null))
);

create index bouts_event_idx on public.bouts (event_id, day, position);
create index bouts_red_idx on public.bouts (red_athlete_id);
create index bouts_blue_idx on public.bouts (blue_athlete_id);

create table public.bout_approvals (
  bout_id uuid not null references public.bouts (id) on delete cascade,
  side text not null check (side in ('red', 'blue', 'official')),
  decision text not null check (decision in ('approved', 'rejected')),
  note text check (note is null or length(note) <= 500),
  -- An official approved on the coach's behalf (after weigh-in).
  override boolean not null default false,
  decided_by uuid default auth.uid() references public.profiles (id) on delete set null,
  decided_at timestamptz not null default now(),
  primary key (bout_id, side)
);

create table public.bout_comments (
  id uuid primary key default gen_random_uuid(),
  bout_id uuid not null references public.bouts (id) on delete cascade,
  author_id uuid default auth.uid() references public.profiles (id) on delete set null,
  body text not null check (length(trim(body)) between 1 and 1000),
  created_at timestamptz not null default now()
);

create index bout_comments_bout_idx on public.bout_comments (bout_id, created_at);

create table public.weigh_ins (
  event_id uuid not null references public.events (id) on delete cascade,
  day date not null,
  athlete_id uuid not null references public.athletes (id) on delete cascade,
  weight_kg numeric(5, 2) check (weight_kg is null or weight_kg between 10 and 250),
  medical text not null check (medical in ('pass', 'fail', 'absent')),
  note text check (note is null or length(note) <= 500),
  recorded_by uuid default auth.uid() references public.profiles (id) on delete set null,
  recorded_at timestamptz not null default now(),
  primary key (event_id, day, athlete_id),
  check (medical <> 'pass' or weight_kg is not null)
);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Has the weigh-in for this event day started (any weight or medical recorded)?
create function public.weigh_in_started(p_event_id uuid, p_day date) returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.weigh_ins where event_id = p_event_id and day = p_day)
$$;

-- Who can see an event's bouts and weigh-ins: the Owner, officials, clubs in it, site Admins.
create function public.can_read_bouts(p_event_id uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select public.can_read_entries(p_event_id)
$$;

-- Everyone involved in a bout: site Admins, the Owner, officials and both corners' clubs.
create function public.in_bout(p_bout_id uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.bouts b
    where b.id = p_bout_id and (
      public.is_site_admin() or public.is_event_owner(b.event_id) or public.event_official_role(b.event_id) is not null
      or public.club_role(b.red_club_id) is not null or public.club_role(b.blue_club_id) is not null
    )
  )
$$;

-- Can the signed-in user make or change bouts on this day? Before the day's weigh-in: the
-- Owner and officials. After it: officials only. Site Admins always.
create function public.can_match(p_event_id uuid, p_day date) returns boolean
language sql stable security definer set search_path = public
as $$
  select public.is_event_official(p_event_id)
    or (public.is_event_owner(p_event_id) and not public.weigh_in_started(p_event_id, p_day))
$$;

-- The card can change while the event is Active (and until it is Done).
create function public.card_open(p_event_id uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.events where id = p_event_id and status = 'active')
$$;

-- Works out a bout's status from its approvals.
create function public.refresh_bout_status(p_bout_id uuid) returns void
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
  set status = case when coalesce(v_rejected, false) then 'rejected' when v_approved = 3 then 'approved' else 'pending' end
  where id = p_bout_id and status <> 'cancelled';
end;
$$;

-- Cancels an athlete's open bouts (no result yet) on a day, or on every day when p_day is null.
create function public.cancel_athlete_bouts(p_event_id uuid, p_athlete_id uuid, p_day date, p_reason text) returns void
language sql security definer set search_path = public
as $$
  update public.bouts
  set status = 'cancelled', cancel_reason = p_reason, cancelled_at = now()
  where event_id = p_event_id and status <> 'cancelled' and winner is null
    and (p_day is null or day = p_day)
    and p_athlete_id in (red_athlete_id, blue_athlete_id)
$$;

-- Withdrawing an athlete cancels their bouts.
create function public.cancel_bouts_on_withdraw() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  perform public.cancel_athlete_bouts(old.event_id, old.athlete_id, null, 'Withdrawn from the event');
  return old;
end;
$$;

create trigger cancel_bouts_on_withdraw after delete on public.event_athletes
  for each row execute function public.cancel_bouts_on_withdraw();

-- ---------------------------------------------------------------------------
-- Making bouts
-- ---------------------------------------------------------------------------

-- Make a bout (p_bout_id null) or re-match one. Re-matching clears its approvals.
-- p_warnings and p_needs_supervisor come from the app's rule check.
create function public.save_bout(
  p_bout_id uuid,
  p_event_id uuid,
  p_day date,
  p_red_athlete_id uuid,
  p_blue_athlete_id uuid,
  p_needs_supervisor boolean default false,
  p_warnings text[] default '{}'
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_event public.events;
  v_red public.event_athletes;
  v_blue public.event_athletes;
  v_old public.bouts;
  v_id uuid;
begin
  select * into v_event from public.events where id = p_event_id;
  if not found then
    raise exception 'That event no longer exists' using errcode = 'P0002';
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
  if exists (
    select 1 from public.bouts b
    where b.event_id = p_event_id and b.day = p_day and b.status <> 'cancelled'
      and b.id is distinct from p_bout_id
      and (b.red_athlete_id in (p_red_athlete_id, p_blue_athlete_id) or b.blue_athlete_id in (p_red_athlete_id, p_blue_athlete_id))
  ) then
    raise exception 'One of these athletes already has a bout that day' using errcode = '23505';
  end if;

  if p_bout_id is null then
    insert into public.bouts (event_id, day, position, red_athlete_id, blue_athlete_id, red_club_id, blue_club_id,
                              needs_supervisor, warnings, after_weigh_in)
    values (p_event_id, p_day,
            coalesce((select max(position) + 1 from public.bouts where event_id = p_event_id and day = p_day), 1),
            p_red_athlete_id, p_blue_athlete_id, v_red.club_id, v_blue.club_id,
            coalesce(p_needs_supervisor, false), coalesce(p_warnings, '{}'), public.weigh_in_started(p_event_id, p_day))
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
        status = 'pending', cancel_reason = null, cancelled_at = null,
        made_by = auth.uid(), made_at = now()
    where id = p_bout_id
    returning id into v_id;
  end if;
  return v_id;
end;
$$;

-- Approve or reject a bout. p_side: 'red' or 'blue' (that corner's club owners) or
-- 'official' (CO or Deputy). After the weigh-in, an official can decide for a corner
-- (p_override); site Admins can decide any side.
create function public.decide_bout(p_bout_id uuid, p_side text, p_approve boolean, p_note text default null) returns void
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

-- Take a bout off the card.
create function public.cancel_bout(p_bout_id uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_bout public.bouts;
begin
  select * into v_bout from public.bouts where id = p_bout_id for update;
  if not found then
    raise exception 'That bout no longer exists' using errcode = 'P0002';
  end if;
  if not coalesce(public.can_match(v_bout.event_id, v_bout.day), false) then
    raise exception 'Only the event''s Owner (before the weigh-in) or officials can cancel bouts' using errcode = '42501';
  end if;
  if v_bout.winner is not null then
    raise exception 'This bout has a result, so it can''t be cancelled' using errcode = '22023';
  end if;
  update public.bouts set status = 'cancelled', cancel_reason = nullif(trim(p_reason), ''), cancelled_at = now()
  where id = p_bout_id;
end;
$$;

-- Set the order and sessions of one day's card. p_order: [{"id": ..., "session": "13:00" | null}, ...]
-- in running order.
create function public.set_card_order(p_event_id uuid, p_day date, p_order jsonb) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_item jsonb;
  v_position integer := 0;
begin
  if not coalesce(public.is_site_admin() or public.is_event_owner(p_event_id), false) then
    raise exception 'Only the event''s Owner sets the order of the card' using errcode = '42501';
  end if;
  if not public.card_open(p_event_id) then
    raise exception 'The card can change only while the event is Active' using errcode = '22023';
  end if;
  for v_item in select * from jsonb_array_elements(p_order) loop
    v_position := v_position + 1;
    update public.bouts
    set position = v_position, session_starts_at = nullif(v_item ->> 'session', '')::time
    where id = (v_item ->> 'id')::uuid and event_id = p_event_id and day = p_day;
  end loop;
end;
$$;

create function public.add_bout_comment(p_bout_id uuid, p_body text) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.in_bout(p_bout_id) then
    raise exception 'Only people involved in this bout can comment on it' using errcode = '42501';
  end if;
  if coalesce(trim(p_body), '') = '' then
    raise exception 'Write a comment first' using errcode = '22023';
  end if;
  insert into public.bout_comments (bout_id, body) values (p_bout_id, trim(p_body)) returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Weigh-in and results
-- ---------------------------------------------------------------------------

-- Record an athlete's weigh-in for a day. A failed medical or a no-show cancels their bouts
-- that day. (The app re-checks the remaining bouts against the new weight.)
create function public.record_weigh_in(
  p_event_id uuid, p_day date, p_athlete_id uuid, p_weight_kg numeric, p_medical text, p_note text default null
) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_event_official(p_event_id) then
    raise exception 'Only the Chief Official or Deputy records the weigh-in' using errcode = '42501';
  end if;
  if not public.card_open(p_event_id) then
    raise exception 'The weigh-in can be recorded only while the event is Active' using errcode = '22023';
  end if;
  if not exists (select 1 from public.event_athletes where event_id = p_event_id and athlete_id = p_athlete_id) then
    raise exception 'That athlete isn''t entered in the event' using errcode = '23514';
  end if;
  if not exists (select 1 from public.events where id = p_event_id and p_day between start_date and end_date) then
    raise exception 'Pick a day of the event' using errcode = '22023';
  end if;
  if p_medical not in ('pass', 'fail', 'absent') then
    raise exception 'The medical is a pass, a fail or a no-show' using errcode = '22023';
  end if;
  if p_medical = 'pass' and p_weight_kg is null then
    raise exception 'Enter the athlete''s weight' using errcode = '22023';
  end if;
  insert into public.weigh_ins (event_id, day, athlete_id, weight_kg, medical, note)
  values (p_event_id, p_day, p_athlete_id, p_weight_kg, p_medical, nullif(trim(p_note), ''))
  on conflict (event_id, day, athlete_id) do update
    set weight_kg = excluded.weight_kg, medical = excluded.medical, note = excluded.note,
        recorded_by = auth.uid(), recorded_at = now();
  if p_medical = 'fail' then
    perform public.cancel_athlete_bouts(p_event_id, p_athlete_id, p_day, 'Failed the medical');
  elsif p_medical = 'absent' then
    perform public.cancel_athlete_bouts(p_event_id, p_athlete_id, p_day, 'Didn''t come to the weigh-in');
  end if;
end;
$$;

-- Record (or correct) a result. The first result on a bout adds one to both boxers' bouts.
create function public.record_result(p_bout_id uuid, p_winner text, p_method text, p_note text default null) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_bout public.bouts;
begin
  select * into v_bout from public.bouts where id = p_bout_id for update;
  if not found then
    raise exception 'That bout no longer exists' using errcode = 'P0002';
  end if;
  if not public.is_event_official(v_bout.event_id) then
    raise exception 'Only the Chief Official or Deputy records results' using errcode = '42501';
  end if;
  if not public.card_open(v_bout.event_id) and not public.is_site_admin() then
    raise exception 'Results can be recorded only while the event is Active' using errcode = '22023';
  end if;
  if v_bout.status <> 'approved' then
    raise exception 'Only approved bouts get a result' using errcode = '22023';
  end if;
  if p_winner not in ('red', 'blue') or p_method not in ('points', 'rsc', 'ko', 'walkover', 'dq', 'abd') then
    raise exception 'Pick the winner and how they won' using errcode = '22023';
  end if;
  if v_bout.winner is null then
    update public.athletes set bouts = coalesce(bouts, 0) + 1 where id in (v_bout.red_athlete_id, v_bout.blue_athlete_id);
  end if;
  update public.bouts
  set winner = p_winner, method = p_method, result_note = nullif(trim(p_note), ''), result_by = auth.uid(), result_at = now()
  where id = p_bout_id;
end;
$$;

-- Remove a result recorded by mistake; the bout counts go back down.
create function public.clear_result(p_bout_id uuid) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_bout public.bouts;
begin
  select * into v_bout from public.bouts where id = p_bout_id for update;
  if not found then
    raise exception 'That bout no longer exists' using errcode = 'P0002';
  end if;
  if not public.is_event_official(v_bout.event_id) then
    raise exception 'Only the Chief Official or Deputy changes results' using errcode = '42501';
  end if;
  if v_bout.winner is null then
    return;
  end if;
  update public.athletes set bouts = greatest(coalesce(bouts, 0) - 1, 0) where id in (v_bout.red_athlete_id, v_bout.blue_athlete_id);
  update public.bouts set winner = null, method = null, result_note = null, result_by = null, result_at = null where id = p_bout_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Row-level security: reads only; every change goes through the functions above.
-- ---------------------------------------------------------------------------

alter table public.event_officials enable row level security;
alter table public.bouts enable row level security;
alter table public.bout_approvals enable row level security;
alter table public.bout_comments enable row level security;
alter table public.weigh_ins enable row level security;

create policy "read event officials" on public.event_officials for select to authenticated
  using (public.can_read_event(event_id));
create policy "read bouts" on public.bouts for select to authenticated
  using (public.can_read_bouts(event_id));
create policy "read bout approvals" on public.bout_approvals for select to authenticated
  using (exists (select 1 from public.bouts b where b.id = bout_id and public.can_read_bouts(b.event_id)));
create policy "read bout comments" on public.bout_comments for select to authenticated
  using (public.in_bout(bout_id));
create policy "read weigh-ins" on public.weigh_ins for select to authenticated
  using (public.can_read_bouts(event_id));

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke execute on function public.refresh_bout_status(uuid) from public, anon, authenticated;
revoke execute on function public.cancel_athlete_bouts(uuid, uuid, date, text) from public, anon, authenticated;
revoke execute on function public.set_event_official(uuid, text, uuid) from public, anon;
grant execute on function public.set_event_official(uuid, text, uuid) to authenticated;
revoke execute on function public.save_bout(uuid, uuid, date, uuid, uuid, boolean, text[]) from public, anon;
grant execute on function public.save_bout(uuid, uuid, date, uuid, uuid, boolean, text[]) to authenticated;
revoke execute on function public.decide_bout(uuid, text, boolean, text) from public, anon;
grant execute on function public.decide_bout(uuid, text, boolean, text) to authenticated;
revoke execute on function public.cancel_bout(uuid, text) from public, anon;
grant execute on function public.cancel_bout(uuid, text) to authenticated;
revoke execute on function public.set_card_order(uuid, date, jsonb) from public, anon;
grant execute on function public.set_card_order(uuid, date, jsonb) to authenticated;
revoke execute on function public.add_bout_comment(uuid, text) from public, anon;
grant execute on function public.add_bout_comment(uuid, text) to authenticated;
revoke execute on function public.record_weigh_in(uuid, date, uuid, numeric, text, text) from public, anon;
grant execute on function public.record_weigh_in(uuid, date, uuid, numeric, text, text) to authenticated;
revoke execute on function public.record_result(uuid, text, text, text) from public, anon;
grant execute on function public.record_result(uuid, text, text, text) to authenticated;
revoke execute on function public.clear_result(uuid) from public, anon;
grant execute on function public.clear_result(uuid) to authenticated;
