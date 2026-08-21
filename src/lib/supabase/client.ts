"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

export type MarineClient = SupabaseClient<Database>;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    "Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY. " +
      "Copy .env.example to .env.local and fill in your Supabase project values.",
  );
}

/**
 * The one browser client for the whole app.
 *
 * Every read and write in the dashboard goes through this client with the anon
 * key, which means Postgres Row Level Security — not the UI — decides what the
 * impersonated user may see and do. `persistSession` is what keeps the reviewer
 * signed in as the last-selected member across page reloads (§6 of the brief);
 * no custom persistence layer is needed.
 */
export const supabase: MarineClient = createClient<Database>(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storageKey: "marine-wo-session",
  },
  global: {
    headers: { "x-application-name": "marine-work-order-management" },
  },
});
