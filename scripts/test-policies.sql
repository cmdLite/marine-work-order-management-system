-- =============================================================================
-- Behavioural test suite for the schema, RLS policies and RPC guardrails.
-- =============================================================================
-- Run against a scratch PostgreSQL database that has had
--   scripts/local-supabase-stub.sql  then  supabase/migrations/000*.sql
-- applied.  Any failure aborts with an assertion error.
--
--   createdb marine
--   psql -v ON_ERROR_STOP=1 -d marine -f scripts/local-supabase-stub.sql
--   psql -v ON_ERROR_STOP=1 -d marine -f supabase/migrations/0001_schema.sql
--   psql -v ON_ERROR_STOP=1 -d marine -f supabase/migrations/0002_rls.sql
--   psql -v ON_ERROR_STOP=1 -d marine -f supabase/migrations/0003_functions.sql
--   psql -v ON_ERROR_STOP=1 -d marine -f scripts/test-policies.sql
-- =============================================================================

\set ON_ERROR_STOP on
\set QUIET on
set client_min_messages = warning;

-- -----------------------------------------------------------------------------
-- Fixtures (as the schema owner, bypassing RLS)
-- -----------------------------------------------------------------------------
truncate public.work_order_events, public.work_orders,
         public.vessel_assignments, public.profiles, public.vessels
  restart identity cascade;
delete from auth.users;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin1@example.com'),
  ('00000000-0000-0000-0000-0000000000a2', 'admin2@example.com'),
  ('00000000-0000-0000-0000-0000000000c1', 'captain1@example.com'),
  ('00000000-0000-0000-0000-0000000000c2', 'captain2@example.com'),
  ('00000000-0000-0000-0000-0000000000e1', 'crew1@example.com'),
  ('00000000-0000-0000-0000-0000000000e2', 'crew2@example.com'),
  ('00000000-0000-0000-0000-0000000000e3', 'crew3@example.com');

insert into public.vessels (id, name, imo_number, mmsi, flag_state) values
  ('10000000-0000-0000-0000-000000000001', 'MV Alpha', '9074729', '215234000', 'Malta'),
  ('10000000-0000-0000-0000-000000000002', 'MV Bravo', '9074730', '215234001', 'Panama');

insert into public.profiles (id, auth_user_id, name, email, phone, date_of_birth, role) values
  ('20000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1', 'Ada Admin',    'admin1@example.com',   '+1 555 0001', '1980-01-01', 'admin'),
  ('20000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a2', 'Abe Admin',    'admin2@example.com',   '+1 555 0002', '1981-01-01', 'admin'),
  ('20000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000c1', 'Cara Captain', 'captain1@example.com', '+1 555 0003', '1975-01-01', 'captain'),
  ('20000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000c2', 'Cole Captain', 'captain2@example.com', '+1 555 0004', '1976-01-01', 'captain'),
  ('20000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e1', 'Rex Crew',     'crew1@example.com',    '+1 555 0005', '1990-01-01', 'crew'),
  ('20000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000e2', 'Rita Crew',    'crew2@example.com',    '+1 555 0006', '1991-01-01', 'crew'),
  ('20000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000e3', 'Ravi Crew',    'crew3@example.com',    '+1 555 0007', '1992-01-01', 'crew');

insert into public.vessel_assignments (user_id, vessel_id) values
  ('20000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-0000000000e1', '10000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-0000000000e2', '10000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-0000000000c2', '10000000-0000-0000-0000-000000000002'),
  ('20000000-0000-0000-0000-0000000000e3', '10000000-0000-0000-0000-000000000002'),
  -- Rex is shared across both vessels: Crew may hold multiple assignments.
  ('20000000-0000-0000-0000-0000000000e1', '10000000-0000-0000-0000-000000000002');

-- -----------------------------------------------------------------------------
-- Assertion helper
-- -----------------------------------------------------------------------------
create or replace function pg_temp.expect_error(p_sql text, p_code_prefix text, p_label text)
returns void
language plpgsql
as $$
declare
  v_msg text;
begin
  begin
    execute p_sql;
  exception when others then
    v_msg := sqlerrm;
    if position(p_code_prefix in v_msg) <> 1 then
      raise exception 'FAIL [%]: expected "%" but got "%"', p_label, p_code_prefix, v_msg;
    end if;
    raise notice 'ok   %  ->  %', rpad(p_label, 52), left(v_msg, 70);
    return;
  end;
  raise exception 'FAIL [%]: expected "%" but the statement succeeded', p_label, p_code_prefix;
end;
$$;

create or replace function pg_temp.expect(p_condition boolean, p_label text)
returns void
language plpgsql
as $$
begin
  if not p_condition then
    raise exception 'FAIL [%]', p_label;
  end if;
  raise notice 'ok   %', p_label;
end;
$$;

set client_min_messages = notice;

-- =============================================================================
-- 1. Assignment rules
-- =============================================================================
select pg_temp.expect_error(
  $q$ insert into public.vessel_assignments (user_id, vessel_id)
      values ('20000000-0000-0000-0000-0000000000c1','10000000-0000-0000-0000-000000000002') $q$,
  'CONSTRAINT', 'captain cannot hold two active commands');

select pg_temp.expect_error(
  $q$ insert into public.vessel_assignments (user_id, vessel_id)
      values ('20000000-0000-0000-0000-0000000000a1','10000000-0000-0000-0000-000000000001') $q$,
  'INVALID', 'admins cannot be assigned to a vessel');

-- =============================================================================
-- 2. Work order lifecycle, acting as real sessions
-- =============================================================================
set role authenticated;

-- --- Cara Captain raises a work order on MV Alpha -----------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', false);

select pg_temp.expect(
  (select count(*) from public.work_orders) = 0, 'captain starts with an empty board');

select pg_temp.expect_error(
  $q$ select public.wo_create('10000000-0000-0000-0000-000000000002','X','Y','20000000-0000-0000-0000-0000000000e3') $q$,
  'FORBIDDEN', 'captain cannot raise work on a vessel she does not command');

select pg_temp.expect_error(
  $q$ select public.wo_create('10000000-0000-0000-0000-000000000001','X','Y','20000000-0000-0000-0000-0000000000e3') $q$,
  'INVALID', 'assignee must be crew on that vessel');

-- NOTE: called in FROM, not in the target list — `(f()).*` would re-evaluate
-- the function once per output column and raise several work orders.
create temporary table t_wo as
  select * from public.wo_create(
    '10000000-0000-0000-0000-000000000001',
    'Replace bilge pump seal',
    'Seal is weeping in the forward bilge.',
    '20000000-0000-0000-0000-0000000000e1');

select pg_temp.expect(
  (select status from t_wo) = 'open', 'new work order starts Open');

-- --- Crew who is not the assignee cannot act ---------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e2', false);
select pg_temp.expect_error(
  format($q$ select public.wo_start(%L,'open') $q$, (select id from t_wo)),
  'FORBIDDEN', 'non-assignee crew cannot pick up the order');

-- --- The assignee picks it up ------------------------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e1', false);
select pg_temp.expect(
  (select status from public.wo_start((select id from t_wo), 'open')) = 'in_progress',
  'assignee moves Open -> In Progress');

-- --- Optimistic concurrency: the same call from a second device loses --------
select pg_temp.expect_error(
  format($q$ select public.wo_start(%L,'open') $q$, (select id from t_wo)),
  'CONFLICT', 'stale expected-status write is rejected');

select pg_temp.expect_error(
  format($q$ select public.wo_complete(%L,'','in_progress') $q$, (select id from t_wo)),
  'INVALID', 'cannot complete without documenting a solution');

select pg_temp.expect(
  (select status from public.wo_complete(
     (select id from t_wo), 'Fitted a new seal and pressure tested.', 'in_progress')) = 'done',
  'assignee moves In Progress -> Done');

-- =============================================================================
-- 3. Guardrail: unattested Done still blocks crew deactivation
-- =============================================================================
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
select pg_temp.expect_error(
  $q$ select public.admin_set_user_active('20000000-0000-0000-0000-0000000000e1', false) $q$,
  'BLOCKED', 'crew with an unattested Done order cannot be deactivated');

select pg_temp.expect_error(
  $q$ select public.admin_set_vessel_active('10000000-0000-0000-0000-000000000001', false) $q$,
  'BLOCKED', 'vessel with an unattested order cannot be deactivated');

-- =============================================================================
-- 4. Attest / reject
-- =============================================================================
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c2', false);
select pg_temp.expect_error(
  format($q$ select public.wo_attest(%L,'done',false) $q$, (select id from t_wo)),
  'FORBIDDEN', 'a captain of another vessel cannot attest');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', false);
select pg_temp.expect_error(
  format($q$ select public.wo_reject(%L,'','done',false) $q$, (select id from t_wo)),
  'INVALID', 'rejection requires a reason');

select pg_temp.expect(
  (select status from public.wo_reject(
     (select id from t_wo), 'Please photograph the new seal before closing.', 'done', false)) = 'in_progress',
  'reject returns a Done order to In Progress');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e1', false);
select public.wo_complete((select id from t_wo), 'Reseated, photographed, pressure tested.', 'in_progress');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', false);
select pg_temp.expect(
  (select attested_at from public.wo_attest((select id from t_wo), 'done', false)) is not null,
  'captain attests the Done order');

select pg_temp.expect_error(
  format($q$ select public.wo_attest(%L,'done',false) $q$, (select id from t_wo)),
  'CONFLICT', 'a second attest from another device is rejected');

select pg_temp.expect_error(
  format($q$ select public.wo_reject(%L,'too late','done',false) $q$, (select id from t_wo)),
  'CONFLICT', 'reject cannot race an attest that already landed');

select pg_temp.expect(
  (select count(*) from public.work_order_events where work_order_id = (select id from t_wo)) >= 7,
  'the full attestation / rejection trail is recorded');

-- =============================================================================
-- 5. Row Level Security — data scoping
-- =============================================================================
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c2', false);
select pg_temp.expect(
  (select count(*) from public.work_orders) = 0,
  'a captain sees no work orders from vessels he does not command');
select pg_temp.expect(
  (select count(*) from public.vessels) = 1,
  'a captain sees only his own vessel');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e1', false);
select pg_temp.expect(
  (select count(*) from public.work_orders) = 1,
  'crew assigned to the vessel sees the work order');
select pg_temp.expect(
  (select count(*) from public.vessels) = 2,
  'crew shared across two vessels sees both');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
select pg_temp.expect(
  (select count(*) from public.vessels) = 2 and (select count(*) from public.profiles) = 7,
  'an admin sees the whole fleet');

-- Direct table writes are refused for everyone: mutations must go through the
-- audited RPCs, which is what keeps the event trail complete.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', false);
select pg_temp.expect_error(
  format($q$ update public.work_orders set status = 'open' where id = %L $q$, (select id from t_wo)),
  'permission denied', 'direct UPDATE on work_orders is refused');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e1', false);
update public.profiles set role = 'admin' where auth_user_id = '00000000-0000-0000-0000-0000000000e1';
select pg_temp.expect(
  (select role from public.me()) = 'crew',
  'crew cannot escalate their own role (RLS matches no rows)');

select pg_temp.expect_error(
  $q$ select public.admin_set_user_active('20000000-0000-0000-0000-0000000000c1', false) $q$,
  'FORBIDDEN', 'crew cannot call admin functions');

-- The anon role — a visitor who has not picked an identity yet — sees nothing
-- beyond the narrow identity_* directory.
reset role;
set role anon;
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.expect_error(
  $q$ select count(*) from public.profiles $q$,
  'permission denied', 'anon cannot read profiles directly');
select pg_temp.expect_error(
  $q$ select count(*) from public.work_orders $q$,
  'permission denied', 'anon cannot read work orders directly');
select pg_temp.expect(
  (select count(*) from public.identity_vessels()) = 2,
  'anon can list vessels for the Identity Bar');
select pg_temp.expect(
  (select count(*) from public.identity_members('10000000-0000-0000-0000-000000000001','crew')) = 2,
  'anon can list crew for the selected vessel');
select pg_temp.expect(
  (select count(*) from public.identity_members('10000000-0000-0000-0000-000000000001', null)) = 5,
  'admins always appear in the member list, whatever vessel is selected');

reset role;
set role authenticated;

-- =============================================================================
-- 6. Remaining guardrails
-- =============================================================================
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);

select pg_temp.expect(
  (select active from public.admin_set_user_active('20000000-0000-0000-0000-0000000000e1', false)) = false,
  'crew is deactivatable once the work order is attested');

select pg_temp.expect_error(
  $q$ select public.admin_set_user_active('20000000-0000-0000-0000-0000000000c1', false) $q$,
  'BLOCKED', 'the sole active captain of a vessel cannot be deactivated');

select pg_temp.expect_error(
  $q$ select public.admin_unassign_vessel('20000000-0000-0000-0000-0000000000c1','10000000-0000-0000-0000-000000000001') $q$,
  'BLOCKED', 'the sole active captain cannot be stood down');

select pg_temp.expect_error(
  $q$ select public.admin_set_user_active('20000000-0000-0000-0000-0000000000a1', false) $q$,
  'BLOCKED', 'an admin cannot deactivate the account they are using');

select public.admin_set_user_active('20000000-0000-0000-0000-0000000000a2', false);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
select pg_temp.expect_error(
  $q$ select public.admin_set_user_active('20000000-0000-0000-0000-0000000000a1', false) $q$,
  'BLOCKED', 'the last active admin can never be deactivated');

select pg_temp.expect_error(
  $q$ select public.admin_create_vessel('Anything','9074729','215234000','Malta') $q$,
  'DUPLICATE', 'IMO number is a hard uniqueness constraint');

select pg_temp.expect_error(
  $q$ select public.admin_create_vessel('MV Charlie', '123', '215111000', 'Malta') $q$,
  'INVALID', 'IMO must be 7 digits — bad formats are rejected');

select public.admin_create_vessel('MV Tender', null, '215999000', 'Malta');
select pg_temp.expect_error(
  $q$ select public.admin_create_vessel('mv tender', null, '215999000', 'malta') $q$,
  'DUPLICATE', 'name + MMSI + flag state is the fallback key when there is no IMO');

-- MMSI is its own independent hard key, isolated from IMO and the natural key:
-- a different name, no IMO clash, only the MMSI collides.
select pg_temp.expect_error(
  $q$ select public.admin_create_vessel('MV Completely Different', '9312345', '215234000', 'Liberia') $q$,
  'DUPLICATE', 'MMSI alone is a hard uniqueness constraint, independent of IMO');

select pg_temp.expect(
  (select count(*) from public.admin_find_soft_duplicates('Rita Crew','+1 555 0006','1991-01-01')) = 1,
  'name + phone + date of birth surfaces a soft duplicate warning');
select pg_temp.expect(
  (select count(*) from public.admin_find_soft_duplicates('Rita Crew','+1 555 9999','1991-01-01')) = 0,
  'a different phone is not a soft duplicate');

reset role;
\echo ''
\echo '  All policy, lifecycle and guardrail assertions passed.'
\echo ''
