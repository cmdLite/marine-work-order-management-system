import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient, createAuthClient } from "@/lib/supabase/admin";
import { deriveAccountPassword } from "@/lib/server/account-credentials";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ profileId: z.string().uuid() });

/**
 * The mock-auth sign-in.
 *
 * Selecting a member in the Identity Bar posts here; the server exchanges that
 * profile for a real Supabase Auth session on its hidden backing account and
 * hands the tokens back. The browser then holds a genuine session, so
 * `auth.uid()` is real and every RLS policy applies for that person — with no
 * login form anywhere in the app and no credential ever reaching the client.
 *
 * The profile id is the *only* client input, and it is validated as a UUID
 * before it touches the database; the email and credential are resolved
 * server-side, so a caller cannot impersonate an arbitrary email address.
 */
export async function POST(request: Request) {
  let parsed: { profileId: string };
  try {
    parsed = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "A valid profileId is required." }, { status: 400 });
  }

  try {
    const admin = createAdminClient();

    const { data: profile, error } = await admin
      .from("profiles")
      .select("id, email, active, auth_user_id, name")
      .eq("id", parsed.profileId)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: "Could not look up that member." }, { status: 500 });
    }
    if (!profile) {
      return NextResponse.json({ error: "That member no longer exists." }, { status: 404 });
    }
    if (!profile.active) {
      return NextResponse.json(
        { error: "That member has been deactivated and cannot be selected." },
        { status: 403 },
      );
    }
    if (!profile.auth_user_id) {
      return NextResponse.json(
        { error: "That member has no backing account. Re-run the seed script." },
        { status: 409 },
      );
    }

    const auth = createAuthClient();
    const { data: signIn, error: signInError } = await auth.auth.signInWithPassword({
      email: profile.email,
      password: deriveAccountPassword(profile.email),
    });

    if (signInError || !signIn.session) {
      return NextResponse.json(
        {
          error:
            "Could not start a session for that member. Check that IMPERSONATION_SECRET matches the one used when seeding.",
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      access_token: signIn.session.access_token,
      refresh_token: signIn.session.refresh_token,
      profile: { id: profile.id, name: profile.name },
    });
  } catch (caught) {
    const message =
      caught instanceof Error ? caught.message : "Unexpected server error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
