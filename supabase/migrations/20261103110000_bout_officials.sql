-- Migration 41 (Bhavek, 2026-11-03): "when accepting a bout for an official, they have to submit
-- 'Judge Only' or 'Ref and Judge' per bout".
--
--   * An official working the event takes a bout on the card by accepting it, and must say how:
--     'judge' (Judge only) or 'ref_judge' (Ref and Judge). They can change their answer or
--     withdraw while the bout has no result and the event is Active.
--   * Who can accept: the Chief Official and Deputy (any day), and officials who accepted the
--     event's invitation for the bout's day.
--   * The event's Owner, Chief Official, Deputy or a site Admin can take an official off a bout.
--   * Everyone who sees the bout sees who is working it and as what.
--
-- Run after migration 40.

create table public.bout_officials (
  bout_id uuid not null references public.bouts (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null check (role in ('judge', 'ref_judge')),
  accepted_at timestamptz not null default now(),
  primary key (bout_id, user_id)
);

create index bout_officials_user_id_idx on public.bout_officials (user_id);

alter table public.bout_officials enable row level security;

create policy "read bout officials" on public.bout_officials for select to authenticated
  using (exists (select 1 from public.bouts b where b.id = bout_id and public.can_read_bouts(b.event_id)));

-- Writes go through the functions below only.
revoke insert, update, delete on public.bout_officials from anon, authenticated;

-- Whether the signed-in user can work bouts on this day of the event: the Chief Official or
-- Deputy, or an official who accepted the invitation for that day.
create function public.can_work_bout_day(p_event_id uuid, p_day date) returns boolean
language sql stable security definer set search_path = public
as $$
  select public.event_official_role(p_event_id) is not null
    or p_day = any (public.my_official_days(p_event_id))
$$;

-- Accept a bout (or change the answer). p_role: 'judge' (Judge only) or 'ref_judge' (Ref and Judge).
create function public.accept_bout(p_bout_id uuid, p_role text) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_bout public.bouts;
begin
  if p_role is null or p_role not in ('judge', 'ref_judge') then
    raise exception 'Choose Judge only or Ref and Judge' using errcode = '22023';
  end if;
  select * into v_bout from public.bouts where id = p_bout_id;
  if not found then
    raise exception 'That bout no longer exists' using errcode = 'P0002';
  end if;
  if not public.can_work_bout_day(v_bout.event_id, v_bout.day) then
    raise exception 'Only officials working this day can accept the bout' using errcode = '42501';
  end if;
  if not public.card_open(v_bout.event_id) then
    raise exception 'Bouts can be accepted only while the event is Active' using errcode = '22023';
  end if;
  if v_bout.status = 'cancelled' then
    raise exception 'This bout is cancelled' using errcode = '22023';
  end if;
  if v_bout.winner is not null then
    raise exception 'This bout already has a result' using errcode = '22023';
  end if;

  insert into public.bout_officials (bout_id, user_id, role)
  values (p_bout_id, auth.uid(), p_role)
  on conflict (bout_id, user_id) do update set role = excluded.role, accepted_at = now();
end;
$$;

-- Take an official off a bout. p_user_id null: the signed-in user withdraws. Anyone else is
-- removed only by the event's Owner, Chief Official, Deputy or a site Admin.
create function public.withdraw_from_bout(p_bout_id uuid, p_user_id uuid default null) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_bout public.bouts;
  v_user uuid := coalesce(p_user_id, auth.uid());
begin
  select * into v_bout from public.bouts where id = p_bout_id;
  if not found then
    raise exception 'That bout no longer exists' using errcode = 'P0002';
  end if;
  if v_user <> auth.uid()
     and not (public.is_owner_or_admin(v_bout.event_id) or public.is_event_official(v_bout.event_id)) then
    raise exception 'Only the event''s Owner, Chief Official or Deputy can take another official off a bout' using errcode = '42501';
  end if;
  if v_bout.winner is not null and not public.is_site_admin() then
    raise exception 'This bout already has a result' using errcode = '22023';
  end if;
  delete from public.bout_officials where bout_id = p_bout_id and user_id = v_user;
end;
$$;

grant execute on function public.can_work_bout_day(uuid, date) to authenticated;
grant execute on function public.accept_bout(uuid, text) to authenticated;
grant execute on function public.withdraw_from_bout(uuid, uuid) to authenticated;
