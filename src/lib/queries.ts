"use client";

import { supabase } from "@/lib/supabase/client";
import type {
  IdentityMember,
  ProfileRow,
  UserRole,
  VesselAssignmentRow,
  VesselRow,
  WorkOrderEventRow,
  WorkOrderExpandedRow,
  WorkOrderStatus,
} from "@/lib/database.types";

/**
 * Every function here runs through the anon-key browser client, so PostgreSQL
 * decides what comes back. There are no `where user_id = …` filters bolted on
 * for security — narrowing here is purely about what the screen needs.
 *
 * User input is always passed as a bound parameter through PostgREST or as an
 * RPC argument; no SQL string is ever assembled in the browser.
 */

function unwrap<T>(result: { data: T | null; error: unknown }): T {
  if (result.error) throw result.error;
  return (result.data ?? []) as T;
}

/** Rows per request on the work order board. */
export const WORK_ORDER_PAGE_SIZE = 25;

export interface WorkOrderFilters {
  vesselId: string | null;
  status: WorkOrderStatus | "all";
  attestation: "all" | "attested" | "unattested";
  assignedTo?: string | null;
  search?: string;
  /** Cap the result set — used by the dashboard, which only renders a few rows. */
  limit?: number;
  /** Zero-based page. Ignored unless `limit` is set. */
  page?: number;
}

export async function fetchWorkOrders(
  filters: WorkOrderFilters,
): Promise<WorkOrderExpandedRow[]> {
  let query = supabase
    .from("work_orders_expanded")
    .select("*")
    .order("created_at", { ascending: false });

  if (filters.limit) {
    const page = filters.page ?? 0;
    const from = page * filters.limit;
    // `range` is inclusive at both ends, so ask for one extra row: its presence
    // is how the caller knows another page exists without a second count query.
    query = query.range(from, from + filters.limit);
  }

  if (filters.vesselId) query = query.eq("vessel_id", filters.vesselId);
  if (filters.status !== "all") query = query.eq("status", filters.status);
  if (filters.attestation === "attested") query = query.not("attested_at", "is", null);
  if (filters.attestation === "unattested") query = query.is("attested_at", null);
  if (filters.assignedTo) query = query.eq("assigned_crew_id", filters.assignedTo);

  const term = filters.search?.trim();
  if (term) {
    // PostgREST escapes these values; `%` is the only wildcard in play.
    const safe = term.replace(/[%,()]/g, " ");
    query = query.or(`title.ilike.%${safe}%,code.ilike.%${safe}%,issue.ilike.%${safe}%`);
  }

  return unwrap(await query);
}

/**
 * Dashboard tile totals, counted in Postgres. Returns the counts for everything
 * the caller may see — not just the page of rows currently on screen — so the
 * tiles stay correct however large the table gets.
 */
export async function fetchWorkOrderCounts(vesselId: string | null): Promise<{
  open: number;
  inProgress: number;
  awaiting: number;
  attested: number;
}> {
  const { data, error } = await supabase.rpc("wo_counts", {
    p_vessel_id: vesselId,
  });
  if (error) throw error;

  const row = data?.[0];
  return {
    open: Number(row?.open_count ?? 0),
    inProgress: Number(row?.in_progress_count ?? 0),
    awaiting: Number(row?.awaiting_count ?? 0),
    attested: Number(row?.attested_count ?? 0),
  };
}

/** Active / inactive totals for the admin tiles, without fetching any rows. */
export async function fetchRowCounts(
  table: "vessels" | "profiles",
): Promise<{ active: number; inactive: number }> {
  const [activeResult, totalResult] = await Promise.all([
    supabase
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq("active", true),
    supabase.from(table).select("id", { count: "exact", head: true }),
  ]);

  if (activeResult.error) throw activeResult.error;
  if (totalResult.error) throw totalResult.error;

  const active = activeResult.count ?? 0;
  return { active, inactive: (totalResult.count ?? 0) - active };
}

export async function fetchWorkOrder(
  id: string,
): Promise<WorkOrderExpandedRow | null> {
  const { data, error } = await supabase
    .from("work_orders_expanded")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function fetchWorkOrderEvents(
  workOrderId: string,
): Promise<WorkOrderEventRow[]> {
  return unwrap(
    await supabase
      .from("work_order_events")
      .select("*")
      .eq("work_order_id", workOrderId)
      .order("created_at", { ascending: false }),
  );
}

/** Rows per page on the admin screens. */
export const ADMIN_PAGE_SIZE = 10;

/** One page of rows, plus how many exist in total, for "Page 1 of 4". */
export interface Page<T> {
  rows: T[];
  total: number;
}

export async function fetchVesselsPage(options?: {
  includeInactive?: boolean;
  page?: number;
}): Promise<Page<VesselRow>> {
  const page = options?.page ?? 0;
  const from = page * ADMIN_PAGE_SIZE;

  // `count: "exact"` rides along on the same request — PostgREST returns it in
  // the Content-Range header, so the total costs no extra round trip.
  let query = supabase
    .from("vessels")
    .select("*", { count: "exact" })
    .order("name")
    .range(from, from + ADMIN_PAGE_SIZE - 1);
  if (!options?.includeInactive) query = query.eq("active", true);

  const { data, error, count } = await query;
  if (error) throw error;
  return { rows: data ?? [], total: count ?? 0 };
}

/**
 * Rows 0..limit-1 of the people list, plus how many exist in total.
 *
 * "Load more" raises the limit and refetches from the top rather than
 * accumulating pages in component state. One query always returns the whole
 * visible list, so the rows on screen cannot drift out of order or double up,
 * and refreshing after an edit keeps the list expanded where the admin left it.
 */
export async function fetchProfilesPage(options?: {
  includeInactive?: boolean;
  limit?: number;
}): Promise<Page<ProfileRow>> {
  const limit = options?.limit ?? ADMIN_PAGE_SIZE;

  let query = supabase
    .from("profiles")
    .select("*", { count: "exact" })
    .order("name")
    .range(0, limit - 1);
  if (!options?.includeInactive) query = query.eq("active", true);

  const { data, error, count } = await query;
  if (error) throw error;
  return { rows: data ?? [], total: count ?? 0 };
}

/** Assignments for just the people currently listed. */
export async function fetchAssignmentsForUsers(
  userIds: string[],
): Promise<VesselAssignmentRow[]> {
  if (userIds.length === 0) return [];
  return unwrap(
    await supabase
      .from("vessel_assignments")
      .select("*")
      .in("user_id", userIds)
      .order("assigned_at"),
  );
}

/** Assignments for just the vessels currently on screen. */
export async function fetchAssignmentsForVessels(
  vesselIds: string[],
): Promise<VesselAssignmentRow[]> {
  if (vesselIds.length === 0) return [];
  return unwrap(
    await supabase
      .from("vessel_assignments")
      .select("*")
      .in("vessel_id", vesselIds)
      .order("assigned_at"),
  );
}

/** Profiles for a known set of ids — used to name the people in a crew list. */
export async function fetchProfilesByIds(ids: string[]): Promise<ProfileRow[]> {
  if (ids.length === 0) return [];
  return unwrap(await supabase.from("profiles").select("*").in("id", ids));
}

/**
 * Duplicate lookups run against the database rather than the rows currently on
 * screen. Once a list is paged, an in-memory scan would quietly miss a clash
 * sitting on another page — the unique index would still block the write, but
 * the admin would only find out after pressing save.
 */
export async function findProfileByEmail(
  email: string,
  excludeId: string | null,
): Promise<ProfileRow | null> {
  const trimmed = email.trim();
  if (!trimmed) return null;

  let query = supabase.from("profiles").select("*").ilike("email", trimmed);
  if (excludeId) query = query.neq("id", excludeId);

  const { data, error } = await query.limit(1).maybeSingle();
  if (error) throw error;
  return data;
}

export async function findVesselByIdentifier(
  field: "imo_number" | "mmsi",
  value: string,
  excludeId: string | null,
): Promise<VesselRow | null> {
  const trimmed = value.trim();
  if (!trimmed) return null;

  let query = supabase.from("vessels").select("*").eq(field, trimmed);
  if (excludeId) query = query.neq("id", excludeId);

  const { data, error } = await query.limit(1).maybeSingle();
  if (error) throw error;
  return data;
}

export async function fetchVessels(
  includeInactive = false,
): Promise<VesselRow[]> {
  let query = supabase.from("vessels").select("*").order("name");
  if (!includeInactive) query = query.eq("active", true);
  return unwrap(await query);
}

export async function fetchProfiles(options?: {
  role?: UserRole;
  includeInactive?: boolean;
}): Promise<ProfileRow[]> {
  let query = supabase.from("profiles").select("*").order("name");
  if (options?.role) query = query.eq("role", options.role);
  if (!options?.includeInactive) query = query.eq("active", true);
  return unwrap(await query);
}

export async function fetchAssignments(): Promise<VesselAssignmentRow[]> {
  return unwrap(
    await supabase.from("vessel_assignments").select("*").order("assigned_at"),
  );
}

/** Crew a Captain may assign work to — active crew on the given vessel. */
export async function fetchAssignableCrew(
  vesselId: string,
): Promise<IdentityMember[]> {
  const { data, error } = await supabase.rpc("identity_members", {
    p_vessel_id: vesselId,
    p_role: "crew",
  });
  if (error) throw error;
  return data ?? [];
}

export async function fetchProfileNames(): Promise<Map<string, string>> {
  const rows = await fetchProfiles({ includeInactive: true });
  return new Map(rows.map((row) => [row.id, row.name]));
}
