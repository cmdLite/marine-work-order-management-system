import "server-only";

import { createClient } from "@supabase/supabase-js";
import type { Database, ProfileRow } from "@/lib/database.types";
import { createAdminClient } from "@/lib/supabase/admin";

export interface AdminContext {
  admin: ReturnType<typeof createAdminClient>;
  actor: Pick<ProfileRow, "id" | "name" | "role" | "active">;
}

/**
 * Server-side authorization for the two routes that must use the service-role
 * key (creating and editing the hidden auth account behind a profile).
 *
 * The caller's own access token is verified against Supabase Auth and then
 * mapped to a profile — the client never gets to assert who it is. If this
 * check were somehow bypassed, the RLS policies would still refuse the write.
 */
export async function requireAdmin(
  request: Request,
): Promise<{ ok: true; context: AdminContext } | { ok: false; status: number; error: string }> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ")
    ? header.slice(7).trim()
    : "";

  if (!token) {
    return { ok: false, status: 401, error: "Missing session token." };
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return { ok: false, status: 500, error: "Server is not configured." };
  }

  const asCaller = createClient<Database>(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: userData, error: userError } = await asCaller.auth.getUser();
  if (userError || !userData.user) {
    return { ok: false, status: 401, error: "Your session is no longer valid." };
  }

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("id, name, role, active")
    .eq("auth_user_id", userData.user.id)
    .maybeSingle();

  if (!profile || !profile.active || profile.role !== "admin") {
    return { ok: false, status: 403, error: "Admins only." };
  }

  return { ok: true, context: { admin, actor: profile } };
}
