-- =============================================================================
-- Marine Work Order Management System
-- Migration 0002 — Session helpers + Row Level Security
-- =============================================================================
-- Every table is RLS-protected. Authorization is decided in Postgres from the
-- real auth.uid() of the silently signed-in backing account, so the browser
-- client cannot read or write anything the impersonated user is not allowed to.
-- The UI's permission checks are a convenience layer only; this file is the
-- actual enforcement boundary.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Session helpers
--   SECURITY DEFINER so they can read `profiles` / `vessel_assignments` without
--   tripping the very policies that call them (no recursive RLS).
--   search_path is pinned to defeat search-path hijacking.
-- -----------------------------------------------------------------------------

create or replace function public.current_profile_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.id
  from public.profiles p
  where p.auth_user_id = auth.uid()
    and p.active
  limit 1;
$$;

create or replace function public.current_profile_role()
returns public.user_role
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.role
  from public.profiles p
  where p.auth_user_id = auth.uid()
    and p.active
  limit 1;
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.profiles p
    where p.auth_user_id = auth.uid()
      and p.active
      and p.role = 'admin'
  );
$$;

-- Is an arbitrary profile actively assigned to a vessel?
create or replace function public.profile_is_assigned(p_profile_id uuid, p_vessel_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.vessel_assignments va
    where va.user_id = p_profile_id
      and va.vessel_id = p_vessel_id
      and va.active
  );
$$;

-- Is the *current* session actively assigned to a vessel?
create or replace function public.is_assigned_to_vessel(p_vessel_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.vessel_assignments va
    join public.profiles p on p.id = va.user_id
    where p.auth_user_id = auth.uid()
      and p.active
      and va.vessel_id = p_vessel_id
      and va.active
  );
$$;

-- Can the current session see this vessel at all?
create or replace function public.can_see_vessel(p_vessel_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_admin() or public.is_assigned_to_vessel(p_vessel_id);
$$;

-- Does the current session share at least one active vessel with this profile?
create or replace function public.shares_vessel_with(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.vessel_assignments mine
    join public.profiles me on me.id = mine.user_id
    join public.vessel_assignments theirs on theirs.vessel_id = mine.vessel_id
    where me.auth_user_id = auth.uid()
      and me.active
      and mine.active
      and theirs.active
      and theirs.user_id = p_profile_id
  );
$$;

-- -----------------------------------------------------------------------------
-- Lock down default EXECUTE grants, then hand them back deliberately.
-- -----------------------------------------------------------------------------
revoke execute on function public.current_profile_id()                from public;
revoke execute on function public.current_profile_role()              from public;
revoke execute on function public.is_admin()                          from public;
revoke execute on function public.profile_is_assigned(uuid, uuid)     from public;
revoke execute on function public.is_assigned_to_vessel(uuid)         from public;
revoke execute on function public.can_see_vessel(uuid)                from public;
revoke execute on function public.shares_vessel_with(uuid)            from public;

grant execute on function public.current_profile_id()                to authenticated;
grant execute on function public.current_profile_role()              to authenticated;
grant execute on function public.is_admin()                          to authenticated;
grant execute on function public.profile_is_assigned(uuid, uuid)     to authenticated;
grant execute on function public.is_assigned_to_vessel(uuid)         to authenticated;
grant execute on function public.can_see_vessel(uuid)                to authenticated;
grant execute on function public.shares_vessel_with(uuid)            to authenticated;

-- =============================================================================
-- Enable RLS everywhere
-- =============================================================================
alter table public.vessels             enable row level security;
alter table public.profiles            enable row level security;
alter table public.vessel_assignments  enable row level security;
alter table public.work_orders         enable row level security;
alter table public.work_order_events   enable row level security;

alter table public.vessels             force row level security;
alter table public.profiles            force row level security;
alter table public.vessel_assignments  force row level security;
alter table public.work_orders         force row level security;
alter table public.work_order_events   force row level security;

-- Table privileges: the anon role gets nothing at all. Everything the Identity
-- Bar needs before sign-in goes through the narrow identity_* RPCs in 0003.
revoke all on public.vessels            from anon;
revoke all on public.profiles           from anon;
revoke all on public.vessel_assignments from anon;
revoke all on public.work_orders        from anon;
revoke all on public.work_order_events  from anon;

grant select                         on public.vessels            to authenticated;
grant insert, update                 on public.vessels            to authenticated;
grant select                         on public.profiles           to authenticated;
grant insert, update                 on public.profiles           to authenticated;
grant select                         on public.vessel_assignments to authenticated;
grant select                         on public.work_orders        to authenticated;
grant select                         on public.work_order_events  to authenticated;

-- =============================================================================
-- vessels
-- =============================================================================
drop policy if exists vessels_select on public.vessels;
create policy vessels_select on public.vessels
  for select to authenticated
  using (public.is_admin() or public.is_assigned_to_vessel(id));

drop policy if exists vessels_insert_admin on public.vessels;
create policy vessels_insert_admin on public.vessels
  for insert to authenticated
  with check (public.is_admin());

drop policy if exists vessels_update_admin on public.vessels;
create policy vessels_update_admin on public.vessels
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- No DELETE policy anywhere in this schema: records are deactivated, never
-- destroyed, so the audit trail and foreign keys always resolve.

-- =============================================================================
-- profiles
-- =============================================================================
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    public.is_admin()
    or id = public.current_profile_id()
    or public.shares_vessel_with(id)
  );

drop policy if exists profiles_insert_admin on public.profiles;
create policy profiles_insert_admin on public.profiles
  for insert to authenticated
  with check (public.is_admin());

drop policy if exists profiles_update_admin on public.profiles;
create policy profiles_update_admin on public.profiles
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- =============================================================================
-- vessel_assignments
--   SELECT is scoped below. There is deliberately NO insert/update/delete
--   policy: every write goes through admin_assign_vessel / admin_unassign_vessel
--   in 0003, which re-check admin, enforce the sole-active-Captain and
--   unattested-work guardrails, and soft-deactivate rather than delete. A
--   direct table write — even from an Admin session — would skip all of that,
--   the same reasoning that already applies to work_orders below.
-- =============================================================================
drop policy if exists vessel_assignments_select on public.vessel_assignments;
create policy vessel_assignments_select on public.vessel_assignments
  for select to authenticated
  using (
    public.is_admin()
    or user_id = public.current_profile_id()
    or public.is_assigned_to_vessel(vessel_id)
  );

drop policy if exists vessel_assignments_write_admin on public.vessel_assignments;

-- =============================================================================
-- work_orders
--   SELECT is vessel-scoped. There is deliberately NO insert/update/delete
--   policy: every mutation goes through the audited wo_* RPCs in 0003, which
--   re-check permissions, enforce the legal state transitions, apply the
--   optimistic-concurrency guard and write the event trail atomically.
-- =============================================================================
drop policy if exists work_orders_select on public.work_orders;
create policy work_orders_select on public.work_orders
  for select to authenticated
  using (public.is_admin() or public.is_assigned_to_vessel(vessel_id));

-- =============================================================================
-- work_order_events — readable with the parent work order, written only by RPC
-- =============================================================================
drop policy if exists work_order_events_select on public.work_order_events;
create policy work_order_events_select on public.work_order_events
  for select to authenticated
  using (
    exists (
      select 1
      from public.work_orders w
      where w.id = work_order_id
        and (public.is_admin() or public.is_assigned_to_vessel(w.vessel_id))
    )
  );
