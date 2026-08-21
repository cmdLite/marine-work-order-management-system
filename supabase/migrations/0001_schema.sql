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
