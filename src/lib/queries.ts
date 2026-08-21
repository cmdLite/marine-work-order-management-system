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

export interface WorkOrderFilters {
  vesselId: string | null;
  status: WorkOrderStatus | "all";
  attestation: "all" | "attested" | "unattested";
  assignedTo?: string | null;
  search?: string;
}

export async function fetchWorkOrders(
  filters: WorkOrderFilters,
): Promise<WorkOrderExpandedRow[]> {
  let query = supabase
    .from("work_orders_expanded")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);

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
