-- Pick the Owner when creating an event. Leaving it out (or picking yourself) works as before.
-- When someone else is picked, the creator stays on the event as an Admin, except a site Admin,
-- who can see every event anyway and isn't added.

drop function public.save_event(uuid, text, text, date, date, jsonb);

create function public.save_event(
  p_id uuid,
  p_name text,
  p_venue text,
  p_start_date date,
  p_end_date date,
  p_days jsonb,
  p_owner_id uuid default null
) returns uuid
language plpgsql security invoker set search_path = public
as $$
declare
  v_id uuid := p_id;
  day_count int;
begin
  select count(distinct (d ->> 'day')::date) into day_count
  from jsonb_array_elements(p_days) d
  where (d ->> 'day')::date between p_start_date and p_end_date
    and nullif(d ->> 'weigh_in_time', '') is not null
    and nullif(d ->> 'bouts_time', '') is not null;
  if day_count <> (p_end_date - p_start_date + 1) or jsonb_array_length(p_days) <> day_count then
    raise exception 'Every day of the event needs a weigh-in time and a bout time' using errcode = '22023';
  end if;

  if v_id is null then
    -- Pick the id first: the new row isn't visible to its creator until the owner row exists.
    v_id := gen_random_uuid();
    insert into public.events (id, name, venue, start_date, end_date)
    values (v_id, trim(p_name), nullif(trim(p_venue), ''), p_start_date, p_end_date);

    if p_owner_id is not null and p_owner_id <> auth.uid() then
      perform public.transfer_event_ownership(v_id, p_owner_id);
      if public.has_permission('users:manage') then
        delete from public.event_members where event_id = v_id and user_id = auth.uid();
      end if;
    end if;
  else
    update public.events
    set name = trim(p_name), venue = nullif(trim(p_venue), ''), start_date = p_start_date, end_date = p_end_date
    where id = v_id;
    if not found then
      raise exception 'You can''t edit that event' using errcode = '42501';
    end if;
  end if;

  delete from public.event_days where event_id = v_id;
  insert into public.event_days (event_id, day, weigh_in_time, bouts_time)
  select v_id, (d ->> 'day')::date, (d ->> 'weigh_in_time')::time, (d ->> 'bouts_time')::time
  from jsonb_array_elements(p_days) d;

  return v_id;
end;
$$;

revoke execute on function public.save_event(uuid, text, text, date, date, jsonb, uuid) from public, anon;
grant execute on function public.save_event(uuid, text, text, date, date, jsonb, uuid) to authenticated;
