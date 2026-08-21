-- =============================================================================
-- Marine Work Order Management System — full schema
-- Concatenation of supabase/migrations/0001, 0002 and 0003, in order.
-- Paste into the Supabase SQL Editor and run once. Idempotent.
-- Generated: do not edit — edit the migrations instead.
-- =============================================================================

-- =============================================================================
-- Marine Work Order Management System
-- Migration 0001 — Extensions, enums, tables, constraints, indexes, triggers
-- =============================================================================
-- Idempotent: safe to re-run on an existing project.
-- =============================================================================

-- pgcrypto supplies gen_random_uuid(). On Supabase it is pre-installed in the
-- `extensions` schema, which is already on the search_path for every role.
create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'user_role') then
    create type public.user_role as enum ('admin', 'captain', 'crew');
  end if;
  if not exists (select 1 from pg_type where typname = 'work_order_status') then
    -- Exactly three statuses, per the brief. Attestation/rejection are NOT statuses.
    create type public.work_order_status as enum ('open', 'in_progress', 'done');
  end if;
  if not exists (select 1 from pg_type where typname = 'work_order_event_type') then
    create type public.work_order_event_type as enum (
      'created', 'assigned', 'status_change', 'attested', 'rejected'
    );
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- updated_at helper
-- -----------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- vessels
-- -----------------------------------------------------------------------------
create table if not exists public.vessels (
  id          uuid primary key default gen_random_uuid(),
  name        text        not null,
  imo_number  text,
  mmsi        text,
  flag_state  text,
  active      boolean     not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint vessels_name_not_blank check (length(btrim(name)) > 0),
  -- IMO numbers are exactly 7 digits; MMSI is exactly 9 digits.
  constraint vessels_imo_format  check (imo_number is null or imo_number ~ '^[0-9]{7}$'),
  constraint vessels_mmsi_format check (mmsi is null or mmsi ~ '^[0-9]{9}$')
);

-- Tier 1 (hard) duplicate key: IMO number is permanent for the life of the hull.
create unique index if not exists vessels_imo_number_key
  on public.vessels (imo_number)
  where imo_number is not null;

-- Tier 1 (hard) duplicate key: MMSI identifies one vessel's radio/AIS station
-- at a time — no two active or inactive records may share it.
create unique index if not exists vessels_mmsi_key
  on public.vessels (mmsi)
  where mmsi is not null;

-- Fallback natural key for craft with no IMO (< 100 GT / non-propelled):
-- Vessel Name + MMSI + Flag State.
create unique index if not exists vessels_natural_key
  on public.vessels (
    lower(btrim(name)),
    coalesce(mmsi, ''),
    lower(coalesce(btrim(flag_state), ''))
  )
  where imo_number is null;

create index if not exists vessels_active_idx on public.vessels (active) where active;

drop trigger if exists vessels_touch_updated_at on public.vessels;
create trigger vessels_touch_updated_at
  before update on public.vessels
  for each row execute function public.touch_updated_at();

-- -----------------------------------------------------------------------------
-- profiles
--   One row per human. `auth_user_id` points at the hidden, pre-seeded Supabase
--   Auth account that the Identity Bar silently signs in as, which is what makes
--   auth.uid() real and RLS enforceable (see §6 of the brief).
-- -----------------------------------------------------------------------------
create table if not exists public.profiles (
  id            uuid primary key default gen_random_uuid(),
  auth_user_id  uuid unique references auth.users (id) on delete set null,
  name          text not null,
  email         text not null,
  phone         text,
  date_of_birth date,
  role          public.user_role not null,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint profiles_name_not_blank check (length(btrim(name)) > 0),
  constraint profiles_email_format check (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  constraint profiles_dob_sane check (date_of_birth is null or date_of_birth < current_date)
);

-- Tier 1 (hard) duplicate key: email, case-insensitive. Also identifies the
-- hidden backing Supabase Auth account.
create unique index if not exists profiles_email_key
  on public.profiles (lower(btrim(email)));
create index if not exists profiles_role_active_idx on public.profiles (role, active);
-- Supports the Tier 2 (soft) duplicate warning: name + phone + date of birth.
create index if not exists profiles_soft_duplicate_idx
  on public.profiles (lower(btrim(name)), phone, date_of_birth)
  where active;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- -----------------------------------------------------------------------------
-- vessel_assignments (many-to-many, soft-deactivated rather than deleted)
-- -----------------------------------------------------------------------------
create table if not exists public.vessel_assignments (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  vessel_id     uuid not null references public.vessels (id) on delete cascade,
  active        boolean not null default true,
  assigned_at   timestamptz not null default now(),
  unassigned_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint vessel_assignments_unique_pair unique (user_id, vessel_id)
);

create index if not exists vessel_assignments_vessel_active_idx
  on public.vessel_assignments (vessel_id) where active;
create index if not exists vessel_assignments_user_active_idx
  on public.vessel_assignments (user_id) where active;

drop trigger if exists vessel_assignments_touch_updated_at on public.vessel_assignments;
create trigger vessel_assignments_touch_updated_at
  before update on public.vessel_assignments
  for each row execute function public.touch_updated_at();

-- A Captain holds at most ONE active command at a time (one master in command).
-- The schema permits multiple assignment rows; this trigger is the enforcement.
-- Admins are not vessel-bound and must not be assigned at all.
create or replace function public.enforce_assignment_rules()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_role public.user_role;
  v_other_vessel text;
begin
  if not new.active then
    return new;
  end if;

  select role into v_role from public.profiles where id = new.user_id;

  if v_role is null then
    raise exception 'INVALID: profile % does not exist', new.user_id using errcode = '23503';
  end if;

  if v_role = 'admin' then
    raise exception 'INVALID: Admins are not vessel-bound and cannot be assigned to a vessel'
      using errcode = '23514';
  end if;

  if v_role = 'captain' then
    select v.name into v_other_vessel
    from public.vessel_assignments va
    join public.vessels v on v.id = va.vessel_id
    where va.user_id = new.user_id
      and va.active
      and va.vessel_id <> new.vessel_id
    limit 1;

    if v_other_vessel is not null then
      raise exception 'CONSTRAINT: this Captain already holds active command of %. A Captain may command only one vessel at a time.', v_other_vessel
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists vessel_assignments_enforce_rules on public.vessel_assignments;
create trigger vessel_assignments_enforce_rules
  before insert or update on public.vessel_assignments
  for each row execute function public.enforce_assignment_rules();

-- -----------------------------------------------------------------------------
-- work_orders
-- -----------------------------------------------------------------------------
create sequence if not exists public.work_order_code_seq;

create table if not exists public.work_orders (
  id               uuid primary key default gen_random_uuid(),
  code             text not null unique
                     default ('WO-' || lpad(nextval('public.work_order_code_seq')::text, 5, '0')),
  vessel_id        uuid not null references public.vessels (id) on delete restrict,
  title            text not null,
  issue            text not null,
  solution         text,
  status           public.work_order_status not null default 'open',
  assigned_crew_id uuid not null references public.profiles (id) on delete restrict,
  created_by       uuid not null references public.profiles (id) on delete restrict,
  attested_at      timestamptz,
  attested_by      uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint work_orders_title_not_blank check (length(btrim(title)) > 0),
  constraint work_orders_issue_not_blank check (length(btrim(issue)) > 0),
  -- attested_at and attested_by are set together or not at all
  constraint work_orders_attestation_pair
    check ((attested_at is null) = (attested_by is null)),
  -- only a Done order can carry an attestation
  constraint work_orders_attested_only_when_done
    check (attested_at is null or status = 'done'),
  -- a Done order must document a Solution
  constraint work_orders_solution_required_when_done
    check (status <> 'done' or (solution is not null and length(btrim(solution)) > 0))
);

create index if not exists work_orders_vessel_idx  on public.work_orders (vessel_id);
create index if not exists work_orders_crew_idx    on public.work_orders (assigned_crew_id);
create index if not exists work_orders_status_idx  on public.work_orders (status);
create index if not exists work_orders_created_idx on public.work_orders (created_at desc);
-- Powers the deactivation guardrails: "any work order not yet attested".
create index if not exists work_orders_unattested_idx
  on public.work_orders (vessel_id, assigned_crew_id)
  where attested_at is null;

drop trigger if exists work_orders_touch_updated_at on public.work_orders;
create trigger work_orders_touch_updated_at
  before update on public.work_orders
  for each row execute function public.touch_updated_at();

-- -----------------------------------------------------------------------------
-- work_order_events — the full attestation / rejection / transition trail
-- -----------------------------------------------------------------------------
create table if not exists public.work_order_events (
  id            uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references public.work_orders (id) on delete cascade,
  type          public.work_order_event_type not null,
  actor_id      uuid references public.profiles (id) on delete set null,
  note          text,
  from_status   public.work_order_status,
  to_status     public.work_order_status,
  created_at    timestamptz not null default now()
);

create index if not exists work_order_events_wo_idx
  on public.work_order_events (work_order_id, created_at desc);

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
