-- =============================================================================
-- Marine Work Order Management System
-- Migration 0003 — Identity directory, work order lifecycle, admin guardrails
-- =============================================================================
-- Error convention: every raised message is `CODE: human readable sentence`.
--   NOT_AUTHENTICATED  no active profile behind auth.uid()
--   FORBIDDEN          authenticated, but not allowed to do this
--   INVALID            the request itself is malformed or violates a rule
--   CONFLICT           optimistic-concurrency guard tripped (someone else won)
--   BLOCKED            a deactivation / assignment guardrail refused
--   DUPLICATE          a uniqueness rule refused
--   NOT_FOUND          referenced row does not exist / is not visible
-- The web client splits on the first ':' to pick the right UI treatment.
-- =============================================================================

-- =============================================================================
-- SECTION 1 — Identity directory (the "login screen" surface)
-- =============================================================================
-- These are the ONLY functions reachable by the anon role, and they expose the
-- bare minimum needed to render the Identity Bar: vessel names, and the display
-- name + role of active members. No email, no phone, no date of birth, no work
-- order data. This is the deliberate, documented equivalent of a public login
-- page that lists its demo accounts.
-- =============================================================================

create or replace function public.identity_vessels(p_profile_id uuid default null)
returns table (id uuid, name text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select v.id, v.name
  from public.vessels v
  where v.active
    and (
      p_profile_id is null
      or exists (
        select 1 from public.profiles p
        where p.id = p_profile_id and p.active and p.role = 'admin'
      )
      or exists (
        select 1 from public.vessel_assignments va
        where va.user_id = p_profile_id and va.vessel_id = v.id and va.active
      )
    )
  order by v.name;
$$;

create or replace function public.identity_members(
  p_vessel_id uuid default null,
  p_role public.user_role default null
)
returns table (id uuid, name text, role public.user_role)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.id, p.name, p.role
  from public.profiles p
  where p.active
    and p.auth_user_id is not null
    and (p_role is null or p.role = p_role)
    and (
      -- Admins are not vessel-bound: they always appear, whatever vessel is picked.
      p.role = 'admin'
      or p_vessel_id is null
      or exists (
        select 1 from public.vessel_assignments va
        where va.user_id = p.id and va.vessel_id = p_vessel_id and va.active
      )
    )
  order by p.role, p.name;
$$;

revoke execute on function public.identity_vessels(uuid)                     from public;
revoke execute on function public.identity_members(uuid, public.user_role)   from public;
grant  execute on function public.identity_vessels(uuid)                     to anon, authenticated;
grant  execute on function public.identity_members(uuid, public.user_role)   to anon, authenticated;

-- Who am I? Convenience read for the signed-in session.
create or replace function public.me()
returns table (
  id uuid,
  name text,
  email text,
  phone text,
  role public.user_role,
  active boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.id, p.name, p.email, p.phone, p.role, p.active
  from public.profiles p
  where p.auth_user_id = auth.uid()
  limit 1;
$$;

revoke execute on function public.me() from public;
grant  execute on function public.me() to authenticated;

-- =============================================================================
-- SECTION 2 — Work order lifecycle
-- =============================================================================
-- Each mutating function:
--   1. resolves the caller from auth.uid() (never from a client-supplied id),
--   2. re-checks role + vessel assignment server-side,
--   3. applies a conditional UPDATE guarded by the caller's expected state
--      (optimistic concurrency — §4.3), and
--   4. appends to work_order_events, in the same transaction.
-- =============================================================================

create or replace function public.wo_create(
  p_vessel_id        uuid,
  p_title            text,
  p_issue            text,
  p_assigned_crew_id uuid
)
returns public.work_orders
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_me   uuid := public.current_profile_id();
  v_role public.user_role := public.current_profile_role();
  v_wo   public.work_orders;
begin
  if v_me is null then
    raise exception 'NOT_AUTHENTICATED: no active profile for this session' using errcode = '28000';
  end if;

  if v_role <> 'captain' then
    raise exception 'FORBIDDEN: only a Captain can raise a work order' using errcode = '42501';
  end if;

  if not public.profile_is_assigned(v_me, p_vessel_id) then
    raise exception 'FORBIDDEN: you do not hold command of this vessel' using errcode = '42501';
  end if;

  if not exists (select 1 from public.vessels where id = p_vessel_id and active) then
    raise exception 'INVALID: that vessel is not active' using errcode = '23514';
  end if;

  if length(btrim(coalesce(p_title, ''))) = 0 then
    raise exception 'INVALID: a title is required' using errcode = '23514';
  end if;

  if length(btrim(coalesce(p_issue, ''))) = 0 then
    raise exception 'INVALID: an issue description is required' using errcode = '23514';
  end if;

  if not exists (
    select 1
    from public.profiles p
    join public.vessel_assignments va on va.user_id = p.id
    where p.id = p_assigned_crew_id
      and p.active
      and p.role = 'crew'
      and va.vessel_id = p_vessel_id
      and va.active
  ) then
    raise exception 'INVALID: the assignee must be active Crew assigned to this vessel'
      using errcode = '23514';
  end if;

  insert into public.work_orders (vessel_id, title, issue, assigned_crew_id, created_by, status)
  values (p_vessel_id, btrim(p_title), btrim(p_issue), p_assigned_crew_id, v_me, 'open')
  returning * into v_wo;

  insert into public.work_order_events (work_order_id, type, actor_id, note, to_status)
  values (v_wo.id, 'created', v_me, 'Work order raised', 'open');

  insert into public.work_order_events (work_order_id, type, actor_id, note)
  select v_wo.id, 'assigned', v_me, 'Assigned to ' || p.name
  from public.profiles p where p.id = p_assigned_crew_id;

  return v_wo;
end;
$$;

-- Crew picks up an Open order  ->  In Progress
create or replace function public.wo_start(
  p_id              uuid,
  p_expected_status public.work_order_status
)
returns public.work_orders
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_me uuid := public.current_profile_id();
  v_wo public.work_orders;
begin
  if v_me is null then
    raise exception 'NOT_AUTHENTICATED: no active profile for this session' using errcode = '28000';
  end if;

  select * into v_wo from public.work_orders where id = p_id;
  if not found then
    raise exception 'NOT_FOUND: that work order no longer exists' using errcode = 'P0002';
  end if;

  if v_wo.assigned_crew_id <> v_me then
    raise exception 'FORBIDDEN: only the assigned Crew member can pick this up' using errcode = '42501';
  end if;

  update public.work_orders w
     set status = 'in_progress'
   where w.id = p_id
     and w.status = 'open'
     and w.status = p_expected_status
  returning * into v_wo;

  if not found then
    raise exception 'CONFLICT: this work order was already updated on another device — refresh to see the latest'
      using errcode = '40001';
  end if;

  insert into public.work_order_events (work_order_id, type, actor_id, note, from_status, to_status)
  values (p_id, 'status_change', v_me, 'Work started', 'open', 'in_progress');

  return v_wo;
end;
$$;

-- Crew documents the Solution and marks complete  ->  Done
create or replace function public.wo_complete(
  p_id              uuid,
  p_solution        text,
  p_expected_status public.work_order_status
)
returns public.work_orders
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_me uuid := public.current_profile_id();
  v_wo public.work_orders;
begin
  if v_me is null then
    raise exception 'NOT_AUTHENTICATED: no active profile for this session' using errcode = '28000';
  end if;

  if length(btrim(coalesce(p_solution, ''))) = 0 then
    raise exception 'INVALID: describe the solution before marking this complete' using errcode = '23514';
  end if;

  select * into v_wo from public.work_orders where id = p_id;
  if not found then
    raise exception 'NOT_FOUND: that work order no longer exists' using errcode = 'P0002';
  end if;

  if v_wo.assigned_crew_id <> v_me then
    raise exception 'FORBIDDEN: only the assigned Crew member can complete this' using errcode = '42501';
  end if;

  update public.work_orders w
     set status = 'done',
         solution = btrim(p_solution)
   where w.id = p_id
     and w.status = 'in_progress'
     and w.status = p_expected_status
  returning * into v_wo;

  if not found then
    raise exception 'CONFLICT: this work order was already updated on another device — refresh to see the latest'
      using errcode = '40001';
  end if;

  insert into public.work_order_events (work_order_id, type, actor_id, note, from_status, to_status)
  values (p_id, 'status_change', v_me, 'Solution documented, marked complete', 'in_progress', 'done');

  return v_wo;
end;
$$;

-- Captain attests (approves) a Done order. Stays Done, now closed.
create or replace function public.wo_attest(
  p_id                uuid,
  p_expected_status   public.work_order_status,
  p_expected_attested boolean,
  p_note              text default null
)
returns public.work_orders
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_me   uuid := public.current_profile_id();
  v_role public.user_role := public.current_profile_role();
  v_wo   public.work_orders;
begin
  if v_me is null then
    raise exception 'NOT_AUTHENTICATED: no active profile for this session' using errcode = '28000';
  end if;

  select * into v_wo from public.work_orders where id = p_id;
  if not found then
    raise exception 'NOT_FOUND: that work order no longer exists' using errcode = 'P0002';
  end if;

  if v_role <> 'captain' or not public.profile_is_assigned(v_me, v_wo.vessel_id) then
    raise exception 'FORBIDDEN: only the Captain of this vessel can attest a work order'
      using errcode = '42501';
  end if;

  -- Guard on status AND attestation together, so a near-simultaneous Attest and
  -- Reject on the same Done order cannot both succeed (§4.3).
  update public.work_orders w
     set attested_at = now(),
         attested_by = v_me
   where w.id = p_id
     and w.status = 'done'
     and w.attested_at is null
     and w.status = p_expected_status
     and (w.attested_at is not null) = coalesce(p_expected_attested, false)
  returning * into v_wo;

  if not found then
    raise exception 'CONFLICT: this work order was already updated on another device — refresh to see the latest'
      using errcode = '40001';
  end if;

  insert into public.work_order_events (work_order_id, type, actor_id, note, from_status, to_status)
  values (p_id, 'attested', v_me, nullif(btrim(coalesce(p_note, '')), ''), 'done', 'done');

  return v_wo;
end;
$$;

-- Captain rejects a Done order with a required reason  ->  back to In Progress
create or replace function public.wo_reject(
  p_id                uuid,
  p_reason            text,
  p_expected_status   public.work_order_status,
  p_expected_attested boolean
)
returns public.work_orders
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_me   uuid := public.current_profile_id();
  v_role public.user_role := public.current_profile_role();
  v_wo   public.work_orders;
begin
  if v_me is null then
    raise exception 'NOT_AUTHENTICATED: no active profile for this session' using errcode = '28000';
  end if;

  if length(btrim(coalesce(p_reason, ''))) = 0 then
    raise exception 'INVALID: a rejection reason is required' using errcode = '23514';
  end if;

  select * into v_wo from public.work_orders where id = p_id;
  if not found then
    raise exception 'NOT_FOUND: that work order no longer exists' using errcode = 'P0002';
  end if;

  if v_role <> 'captain' or not public.profile_is_assigned(v_me, v_wo.vessel_id) then
    raise exception 'FORBIDDEN: only the Captain of this vessel can reject a work order'
      using errcode = '42501';
  end if;

  update public.work_orders w
     set status = 'in_progress'
   where w.id = p_id
     and w.status = 'done'
     and w.attested_at is null
     and w.status = p_expected_status
     and (w.attested_at is not null) = coalesce(p_expected_attested, false)
  returning * into v_wo;

  if not found then
    raise exception 'CONFLICT: this work order was already updated on another device — refresh to see the latest'
      using errcode = '40001';
  end if;

  insert into public.work_order_events (work_order_id, type, actor_id, note, from_status, to_status)
  values (p_id, 'rejected', v_me, btrim(p_reason), 'done', 'in_progress');

  return v_wo;
end;
$$;

-- Re-assign an unattested work order to different Crew on the same vessel.
-- Needed so an Admin can clear the §4.4 guardrail before deactivating someone.
create or replace function public.wo_reassign(
  p_id              uuid,
  p_new_crew_id     uuid,
  p_expected_status public.work_order_status
)
returns public.work_orders
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_me   uuid := public.current_profile_id();
  v_role public.user_role := public.current_profile_role();
  v_wo   public.work_orders;
  v_name text;
begin
  if v_me is null then
    raise exception 'NOT_AUTHENTICATED: no active profile for this session' using errcode = '28000';
  end if;

  select * into v_wo from public.work_orders where id = p_id;
  if not found then
    raise exception 'NOT_FOUND: that work order no longer exists' using errcode = 'P0002';
  end if;

  if v_role = 'crew'
     or (v_role = 'captain' and not public.profile_is_assigned(v_me, v_wo.vessel_id)) then
    raise exception 'FORBIDDEN: only an Admin or the Captain of this vessel can reassign a work order'
      using errcode = '42501';
  end if;

  if v_wo.attested_at is not null then
    raise exception 'INVALID: an attested work order is closed and cannot be reassigned'
      using errcode = '23514';
  end if;

  select p.name into v_name
  from public.profiles p
  join public.vessel_assignments va on va.user_id = p.id
  where p.id = p_new_crew_id
    and p.active
    and p.role = 'crew'
    and va.vessel_id = v_wo.vessel_id
    and va.active;

  if v_name is null then
    raise exception 'INVALID: the new assignee must be active Crew assigned to this vessel'
      using errcode = '23514';
  end if;

  update public.work_orders w
     set assigned_crew_id = p_new_crew_id
   where w.id = p_id
     and w.status = p_expected_status
     and w.attested_at is null
  returning * into v_wo;

  if not found then
    raise exception 'CONFLICT: this work order was already updated on another device — refresh to see the latest'
      using errcode = '40001';
  end if;

  insert into public.work_order_events (work_order_id, type, actor_id, note)
  values (p_id, 'assigned', v_me, 'Reassigned to ' || v_name);

  return v_wo;
end;
$$;

revoke execute on function public.wo_create(uuid, text, text, uuid) from public;
revoke execute on function public.wo_start(uuid, public.work_order_status) from public;
revoke execute on function public.wo_complete(uuid, text, public.work_order_status) from public;
revoke execute on function public.wo_attest(uuid, public.work_order_status, boolean, text) from public;
revoke execute on function public.wo_reject(uuid, text, public.work_order_status, boolean) from public;
revoke execute on function public.wo_reassign(uuid, uuid, public.work_order_status) from public;

grant execute on function public.wo_create(uuid, text, text, uuid) to authenticated;
grant execute on function public.wo_start(uuid, public.work_order_status) to authenticated;
grant execute on function public.wo_complete(uuid, text, public.work_order_status) to authenticated;
grant execute on function public.wo_attest(uuid, public.work_order_status, boolean, text) to authenticated;
grant execute on function public.wo_reject(uuid, text, public.work_order_status, boolean) to authenticated;
grant execute on function public.wo_reassign(uuid, uuid, public.work_order_status) to authenticated;

-- =============================================================================
-- SECTION 3 — Admin: duplicate detection, vessels, assignments, guardrails
-- =============================================================================

-- Tier 2 soft duplicate check: date of birth + name + phone all matching an
-- existing active user is a warning, not a block — two different people can
-- legitimately share all three.
create or replace function public.admin_find_soft_duplicates(
  p_name       text,
  p_phone      text,
  p_dob        date,
  p_exclude_id uuid default null
)
returns table (
  id uuid,
  name text,
  email text,
  role public.user_role,
  matched_dob_name_phone boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_name  text := btrim(coalesce(p_name, ''));
  v_phone text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN: admin only' using errcode = '42501';
  end if;

  if p_dob is null or length(v_name) = 0 or length(v_phone) = 0 then
    return;  -- all three are needed for a meaningful soft match
  end if;

  return query
    select
      p.id,
      p.name,
      p.email,
      p.role,
      true as matched_dob_name_phone
    from public.profiles p
    where p.active
      and (p_exclude_id is null or p.id <> p_exclude_id)
      and p.date_of_birth = p_dob
      and lower(btrim(p.name)) = lower(v_name)
      and regexp_replace(coalesce(p.phone, ''), '[^0-9]', '', 'g') = v_phone;
end;
$$;

create or replace function public.admin_create_vessel(
  p_name       text,
  p_imo_number text default null,
  p_mmsi       text default null,
  p_flag_state text default null
)
returns public.vessels
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_vessel     public.vessels;
  v_constraint text;
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN: admin only' using errcode = '42501';
  end if;

  insert into public.vessels (name, imo_number, mmsi, flag_state)
  values (
    btrim(p_name),
    nullif(btrim(coalesce(p_imo_number, '')), ''),
    nullif(btrim(coalesce(p_mmsi, '')), ''),
    nullif(btrim(coalesce(p_flag_state, '')), '')
  )
  returning * into v_vessel;

  return v_vessel;
exception
  when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'vessels_mmsi_key' then
      raise exception 'DUPLICATE: a vessel with this MMSI already exists' using errcode = '23505';
    elsif v_constraint = 'vessels_imo_number_key' then
      raise exception 'DUPLICATE: a vessel with this IMO number already exists' using errcode = '23505';
    else
      raise exception 'DUPLICATE: a vessel with this name + MMSI + flag state already exists' using errcode = '23505';
    end if;
  when check_violation then
    raise exception 'INVALID: an IMO number must be exactly 7 digits and an MMSI exactly 9 digits'
      using errcode = '23514';
end;
$$;

create or replace function public.admin_update_vessel(
  p_id         uuid,
  p_name       text,
  p_imo_number text default null,
  p_mmsi       text default null,
  p_flag_state text default null
)
returns public.vessels
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_vessel     public.vessels;
  v_constraint text;
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN: admin only' using errcode = '42501';
  end if;

  update public.vessels
     set name       = btrim(p_name),
         imo_number = nullif(btrim(coalesce(p_imo_number, '')), ''),
         mmsi       = nullif(btrim(coalesce(p_mmsi, '')), ''),
         flag_state = nullif(btrim(coalesce(p_flag_state, '')), '')
   where id = p_id
  returning * into v_vessel;

  if not found then
    raise exception 'NOT_FOUND: that vessel no longer exists' using errcode = 'P0002';
  end if;

  return v_vessel;
exception
  when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'vessels_mmsi_key' then
      raise exception 'DUPLICATE: a vessel with this MMSI already exists' using errcode = '23505';
    elsif v_constraint = 'vessels_imo_number_key' then
      raise exception 'DUPLICATE: a vessel with this IMO number already exists' using errcode = '23505';
    else
      raise exception 'DUPLICATE: a vessel with this name + MMSI + flag state already exists' using errcode = '23505';
    end if;
  when check_violation then
    raise exception 'INVALID: an IMO number must be exactly 7 digits and an MMSI exactly 9 digits'
      using errcode = '23514';
end;
$$;

-- Guardrail: a vessel cannot be deactivated while it carries any work order
-- that is not yet attested (Open, In Progress, or unattested Done — an
-- unattested Done can still be rejected back into an active state).
create or replace function public.admin_set_vessel_active(p_id uuid, p_active boolean)
returns public.vessels
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_vessel   public.vessels;
  v_blocking text;
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN: admin only' using errcode = '42501';
  end if;

  if not p_active then
    select string_agg(w.code, ', ' order by w.code)
      into v_blocking
    from public.work_orders w
    where w.vessel_id = p_id
      and w.attested_at is null;

    if v_blocking is not null then
      raise exception 'BLOCKED: this vessel still has unattested work orders (%). Resolve or attest them first.', v_blocking
        using errcode = '23514';
    end if;
  end if;

  update public.vessels set active = p_active where id = p_id returning * into v_vessel;

  if not found then
    raise exception 'NOT_FOUND: that vessel no longer exists' using errcode = 'P0002';
  end if;

  -- Deactivating a vessel stands its crew down from it.
  if not p_active then
    update public.vessel_assignments
       set active = false, unassigned_at = now()
     where vessel_id = p_id and active;
  end if;

  return v_vessel;
end;
$$;

create or replace function public.admin_assign_vessel(p_user_id uuid, p_vessel_id uuid)
returns public.vessel_assignments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.vessel_assignments;
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN: admin only' using errcode = '42501';
  end if;

  if not exists (select 1 from public.profiles where id = p_user_id and active) then
    raise exception 'INVALID: that user is not active' using errcode = '23514';
  end if;

  if not exists (select 1 from public.vessels where id = p_vessel_id and active) then
    raise exception 'INVALID: that vessel is not active' using errcode = '23514';
  end if;

  -- The BEFORE trigger on vessel_assignments enforces the admin/captain rules.
  insert into public.vessel_assignments (user_id, vessel_id, active, assigned_at, unassigned_at)
  values (p_user_id, p_vessel_id, true, now(), null)
  on conflict (user_id, vessel_id)
    do update set active = true, assigned_at = now(), unassigned_at = null
  returning * into v_row;

  return v_row;
end;
$$;

-- Guardrails on removing an assignment:
--   * a Captain cannot stand down if they are the sole active Captain on an
--     active vessel — that vessel would have nobody to raise or attest work.
--   * Crew cannot stand down from a vessel while holding unattested work there.
create or replace function public.admin_unassign_vessel(p_user_id uuid, p_vessel_id uuid)
returns public.vessel_assignments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row      public.vessel_assignments;
  v_role     public.user_role;
  v_blocking text;
  v_vessel   text;
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN: admin only' using errcode = '42501';
  end if;

  select role into v_role from public.profiles where id = p_user_id;
  select name into v_vessel from public.vessels where id = p_vessel_id;

  if v_role = 'captain' then
    if exists (select 1 from public.vessels where id = p_vessel_id and active)
       and not exists (
         select 1
         from public.vessel_assignments va
         join public.profiles p on p.id = va.user_id
         where va.vessel_id = p_vessel_id
           and va.active
           and p.active
           and p.role = 'captain'
           and p.id <> p_user_id
       )
    then
      raise exception 'BLOCKED: this is the only active Captain on %. Assign a replacement Captain first.', coalesce(v_vessel, 'that vessel')
        using errcode = '23514';
    end if;
  end if;

  if v_role = 'crew' then
    select string_agg(w.code, ', ' order by w.code)
      into v_blocking
    from public.work_orders w
    where w.vessel_id = p_vessel_id
      and w.assigned_crew_id = p_user_id
      and w.attested_at is null;

    if v_blocking is not null then
      raise exception 'BLOCKED: this crew member still holds unattested work orders on % (%). Reassign or attest them first.', coalesce(v_vessel, 'that vessel'), v_blocking
        using errcode = '23514';
    end if;
  end if;

  update public.vessel_assignments
     set active = false, unassigned_at = now()
   where user_id = p_user_id and vessel_id = p_vessel_id
  returning * into v_row;

  if not found then
    raise exception 'NOT_FOUND: that assignment no longer exists' using errcode = 'P0002';
  end if;

  return v_row;
end;
$$;

-- Guardrails on deactivating a user (§4.4):
--   * Crew  — blocked while holding ANY work order that is not yet attested.
--   * Captain — blocked while sole active Captain of an active vessel.
--   * Admin — the last active Admin can never be deactivated.
create or replace function public.admin_set_user_active(p_user_id uuid, p_active boolean)
returns public.profiles
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile  public.profiles;
  v_role     public.user_role;
  v_blocking text;
  v_vessels  text;
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN: admin only' using errcode = '42501';
  end if;

  select role into v_role from public.profiles where id = p_user_id;
  if v_role is null then
    raise exception 'NOT_FOUND: that user no longer exists' using errcode = 'P0002';
  end if;

  if not p_active then
    -- Checked before the self-check so the last remaining Admin gets the more
    -- informative message when they try to deactivate themselves.
    if v_role = 'admin' then
      if (select count(*) from public.profiles where role = 'admin' and active) <= 1 then
        raise exception 'BLOCKED: this is the last active Admin. The system would lock itself out of its own management dashboard.'
          using errcode = '23514';
      end if;
    end if;

    if p_user_id = public.current_profile_id() then
      raise exception 'BLOCKED: you cannot deactivate the account you are currently using'
        using errcode = '23514';
    end if;

    if v_role = 'crew' then
      select string_agg(w.code, ', ' order by w.code)
        into v_blocking
      from public.work_orders w
      where w.assigned_crew_id = p_user_id
        and w.attested_at is null;

      if v_blocking is not null then
        raise exception 'BLOCKED: this crew member still holds unattested work orders (%). Reassign or attest them first.', v_blocking
          using errcode = '23514';
      end if;
    end if;

    if v_role = 'captain' then
      select string_agg(v.name, ', ' order by v.name)
        into v_vessels
      from public.vessel_assignments va
      join public.vessels v on v.id = va.vessel_id
      where va.user_id = p_user_id
        and va.active
        and v.active
        and not exists (
          select 1
          from public.vessel_assignments other
          join public.profiles op on op.id = other.user_id
          where other.vessel_id = va.vessel_id
            and other.active
            and op.active
            and op.role = 'captain'
            and op.id <> p_user_id
        );

      if v_vessels is not null then
        raise exception 'BLOCKED: this is the only active Captain on %. Assign a replacement Captain first.', v_vessels
          using errcode = '23514';
      end if;
    end if;
  end if;

  update public.profiles set active = p_active where id = p_user_id returning * into v_profile;

  if not p_active then
    update public.vessel_assignments
       set active = false, unassigned_at = now()
     where user_id = p_user_id and active;
  end if;

  return v_profile;
end;
$$;

revoke execute on function public.admin_find_soft_duplicates(text, text, date, uuid) from public;
revoke execute on function public.admin_create_vessel(text, text, text, text) from public;
revoke execute on function public.admin_update_vessel(uuid, text, text, text, text) from public;
revoke execute on function public.admin_set_vessel_active(uuid, boolean) from public;
revoke execute on function public.admin_assign_vessel(uuid, uuid) from public;
revoke execute on function public.admin_unassign_vessel(uuid, uuid) from public;
revoke execute on function public.admin_set_user_active(uuid, boolean) from public;

grant execute on function public.admin_find_soft_duplicates(text, text, date, uuid) to authenticated;
grant execute on function public.admin_create_vessel(text, text, text, text) to authenticated;
grant execute on function public.admin_update_vessel(uuid, text, text, text, text) to authenticated;
grant execute on function public.admin_set_vessel_active(uuid, boolean) to authenticated;
grant execute on function public.admin_assign_vessel(uuid, uuid) to authenticated;
grant execute on function public.admin_unassign_vessel(uuid, uuid) to authenticated;
grant execute on function public.admin_set_user_active(uuid, boolean) to authenticated;

-- =============================================================================
-- SECTION 4 — Reporting view for the dashboards
-- =============================================================================
-- security_invoker = on makes the view run under the caller's RLS, so it can
-- never widen visibility beyond what work_orders_select already allows.
create or replace view public.work_orders_expanded
with (security_invoker = on)
as
select
  w.id,
  w.code,
  w.vessel_id,
  v.name  as vessel_name,
  w.title,
  w.issue,
  w.solution,
  w.status,
  w.assigned_crew_id,
  crew.name as assigned_crew_name,
  w.created_by,
  author.name as created_by_name,
  w.attested_at,
  w.attested_by,
  attester.name as attested_by_name,
  w.created_at,
  w.updated_at
from public.work_orders w
join public.vessels  v        on v.id = w.vessel_id
join public.profiles crew     on crew.id = w.assigned_crew_id
join public.profiles author   on author.id = w.created_by
left join public.profiles attester on attester.id = w.attested_by;

revoke all on public.work_orders_expanded from anon;
grant select on public.work_orders_expanded to authenticated;

-- =============================================================================
-- SECTION 5 — Realtime
-- =============================================================================
-- Publishing work_orders lets a second device notice a change and re-query
-- (under its own RLS) instead of finding out only when its write is rejected.
-- Guarded because the publication does not exist outside a Supabase project.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'work_orders'
    ) then
      alter publication supabase_realtime add table public.work_orders;
    end if;
  end if;
end $$;
