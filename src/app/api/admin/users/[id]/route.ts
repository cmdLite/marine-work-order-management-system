import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/server/require-admin";
import { deriveAccountPassword } from "@/lib/server/account-credentials";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const updateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(254),
  phone: z.string().trim().max(40).optional().nullable(),
  dateOfBirth: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
    .optional()
    .nullable(),
  role: z.enum(["admin", "captain", "crew"]),
});

/**
 * Editing a user. The profile row and the hidden auth account are kept in step:
 * changing the email rewrites both, and because the account credential is
 * derived from the email it is re-derived at the same time.
 *
 * Role changes are guarded — a Captain who still holds an active command cannot
 * quietly become Crew and leave that vessel without a master.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "INVALID: bad user id." }, { status: 400 });
  }

  let body: z.infer<typeof updateSchema>;
  try {
    body = updateSchema.parse(await request.json());
  } catch (caught) {
    const issue =
      caught instanceof z.ZodError
        ? (caught.issues[0]?.message ?? "Invalid input.")
        : "Invalid input.";
    return NextResponse.json({ error: `INVALID: ${issue}` }, { status: 400 });
  }

  const { admin, actor } = auth.context;
  const email = body.email.toLowerCase();

  const { data: current } = await admin
    .from("profiles")
    .select("id, email, role, auth_user_id, active")
    .eq("id", id)
    .maybeSingle();

  if (!current) {
    return NextResponse.json({ error: "NOT_FOUND: no such user." }, { status: 404 });
  }

  if (current.role === "admin" && body.role !== "admin") {
    const { count } = await admin
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("role", "admin")
      .eq("active", true);

    if ((count ?? 0) <= 1) {
      return NextResponse.json(
        {
          error:
            "BLOCKED: this is the last active Admin — promote someone else before changing this role.",
        },
        { status: 409 },
      );
    }
    if (id === actor.id) {
      return NextResponse.json(
        { error: "BLOCKED: you cannot remove your own Admin role while using it." },
        { status: 409 },
      );
    }
  }

  if (current.role === "captain" && body.role !== "captain") {
    const { data: commands } = await admin
      .from("vessel_assignments")
      .select("vessel_id, vessels!inner(name, active)")
      .eq("user_id", id)
      .eq("active", true);

    if (commands && commands.length > 0) {
      return NextResponse.json(
        {
          error:
            "BLOCKED: stand this Captain down from their vessel before changing their role.",
        },
        { status: 409 },
      );
    }
  }

  if (body.role === "admin" && current.role !== "admin") {
    // Admins are not vessel-bound, so clear any command first.
    await admin
      .from("vessel_assignments")
      .update({ active: false, unassigned_at: new Date().toISOString() })
      .eq("user_id", id)
      .eq("active", true);
  }

  if (email !== current.email.toLowerCase()) {
    const { data: clash } = await admin
      .from("profiles")
      .select("id")
      .ilike("email", email)
      .neq("id", id)
      .maybeSingle();

    if (clash) {
      return NextResponse.json(
        { error: "DUPLICATE: another user already uses that email." },
        { status: 409 },
      );
    }

    if (current.auth_user_id) {
      const { error: authError } = await admin.auth.admin.updateUserById(
        current.auth_user_id,
        { email, password: deriveAccountPassword(email) },
      );
      if (authError) {
        return NextResponse.json({ error: authError.message }, { status: 500 });
      }
    }
  }

  const { data: profile, error } = await admin
    .from("profiles")
    .update({
      name: body.name,
      email,
      phone: body.phone?.trim() || null,
      date_of_birth: body.dateOfBirth || null,
      role: body.role,
    })
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ profile });
}
