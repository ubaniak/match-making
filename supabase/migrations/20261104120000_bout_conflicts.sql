-- Migration 53 (Bhavek, 2026-11-04): officials declare a conflict of interest on a bout.
--
--   "I do want each official to declare a conflict of interest on each bout. The CO should see
--    that when match making."
--
--   * Any official working the event (one of the two Chief Official seats, or an official who
--     accepted the event's invitation) can declare a conflict of interest on any bout of that
--     event, with an optional reason, and take it back. Only until the bout has a result, while
--     the event is Active.
--   * Who sees conflicts: the event's Chief Officials (both seats) and site Admins see every
--     conflict. Each official sees their own. Nobody else (Owner, clubs, the public).
--   * The Chief Officials get a notification when someone declares one.
--   * The Officials assignment plan (migration 47, app/src/officialPlan.js) rests a conflicted
--     official on that bout and flags it if a Chief Official assigns them by hand. Approving the
--     plan is not blocked: the Chief Officials can accept it.
--   * Re-matching a bout to a different pair of boxers clears its conflicts (they were about the
--     old boxers). Swapping corners keeps them.
--
-- Run after migration 52 (20261104110000_clubs_approve_bouts.sql).

create table public.bout_conflicts (
  bout_id uuid not null references public.bouts (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  reason text check (reason is null or char_length(reason) <= 500),
  created_at timestamptz not null default now(),
  primary key (bout_id, user_id)
);

create index bout_conflicts_user_idx on public.bout_conflicts (user_id);

alter table public.bout_conflicts enable row level security;

-- Is the signed-in user an official working this event (either Chief Official seat, or accepted)?
create function public.works_event(p_event_id uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select public.is_event_chief(p_event_id) or public.is_accepted_official(p_event_id)
$$;

-- Own rows, or the event's Chief Officials and site Admins (can_plan_officials, migration 47).
create policy "read bout conflicts" on public.bout_conflicts for select to authenticated
  using (
    user_id = auth.uid()
    or exists (select 1 from public.bouts b where b.id = bout_id and public.can_plan_officials(b.event_id))
  );

-- Writes go through the functions below only.
revoke insert, update, delete on public.bout_conflicts from anon, authenticated;

-- Declare (or update the reason for) a conflict of interest on a bout.
create function public.declare_bout_conflict(p_bout_id uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_bout public.bouts;
  v_chiefs uuid[];
begin
  select * into v_bout from public.bouts where id = p_bout_id;
  if not found then
    raise exception 'Bout not found' using errcode = 'P0002';
  end if;
  if not public.works_event(v_bout.event_id) then
    raise exception 'Only officials working this event can declare a conflict of interest' using errcode = '42501';
  end if;
  if not public.card_open(v_bout.event_id) then
    raise exception 'Conflicts can be declared only while the event is Active' using errcode = '22023';
  end if;
  if v_bout.winner is not null then
    raise exception 'This bout already has a result' using errcode = '22023';
  end if;

  insert into public.bout_conflicts (bout_id, user_id, reason)
  values (p_bout_id, auth.uid(), nullif(left(trim(p_reason), 500), ''))
  on conflict (bout_id, user_id) do update set reason = excluded.reason, created_at = now();

  select coalesce(array_agg(user_id), '{}') into v_chiefs
  from public.event_officials where event_id = v_bout.event_id;
  perform public.add_notification(
    v_chiefs, 'bout_conflict',
    public.person_name(auth.uid()) || ' has a conflict of interest: ' || public.bout_label(v_bout),
    public.bout_where(v_bout) || coalesce(' · ' || nullif(trim(p_reason), ''), ''),
    v_bout.event_id, null, v_bout.id, 'bouts', null
  );
end;
$$;

-- Take back your own conflict of interest.
create function public.withdraw_bout_conflict(p_bout_id uuid) returns void
language plpgsql security definer set search_path = public
as $$
begin
  delete from public.bout_conflicts where bout_id = p_bout_id and user_id = auth.uid();
end;
$$;

-- Re-matched to a different pair of boxers: the old conflicts no longer apply.
create function public.clear_bout_conflicts_on_rematch() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if not (
    (new.red_athlete_id is not distinct from old.red_athlete_id and new.blue_athlete_id is not distinct from old.blue_athlete_id)
    or (new.red_athlete_id is not distinct from old.blue_athlete_id and new.blue_athlete_id is not distinct from old.red_athlete_id)
  ) then
    delete from public.bout_conflicts where bout_id = new.id;
  end if;
  return new;
end;
$$;

create trigger clear_bout_conflicts_on_rematch
  after update of red_athlete_id, blue_athlete_id on public.bouts
  for each row execute function public.clear_bout_conflicts_on_rematch();

-- A new notification kind.
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'availability', 'invitation_answer', 'official_role',
  'bout_approval', 'bout_decision', 'bout_cancelled', 'bout_comment', 'bout_review',
  'join_request', 'join_answer', 'late_entry', 'late_entry_answer',
  'transfer', 'transfer_answer', 'member_request', 'member_answer',
  'event_role', 'event_status',
  'club_invite', 'club_invite_answer',
  'official_plan', 'bout_conflict'
));

revoke execute on function public.works_event(uuid) from public, anon;
grant execute on function public.works_event(uuid) to authenticated;
revoke execute on function public.declare_bout_conflict(uuid, text) from public, anon;
grant execute on function public.declare_bout_conflict(uuid, text) to authenticated;
revoke execute on function public.withdraw_bout_conflict(uuid) from public, anon;
grant execute on function public.withdraw_bout_conflict(uuid) to authenticated;
revoke execute on function public.clear_bout_conflicts_on_rematch() from public, anon, authenticated;
