import { NextResponse } from "next/server";
import { createAuthClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Pinged by Vercel Cron (see vercel.json) so the Supabase free-tier project
 * doesn't auto-pause from inactivity while this is under review. Calls the
 * same anon-accessible RPC the Identity Bar already uses before anyone signs
 * in — a harmless read, nothing to secure.
 */
export async function GET() {
  const client = createAuthClient();
  const { error } = await client.rpc("identity_vessels");

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, pingedAt: new Date().toISOString() });
}
