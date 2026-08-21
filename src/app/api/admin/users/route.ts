import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/server/require-admin";
import { deriveAccountPassword } from "@/lib/server/account-credentials";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z.object({
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
 * Creating a user is the one write that genuinely needs the service-role key:
 * a profile is useless without the hidden Supabase Auth account that gives it a
 * real `auth.uid()`. Both are created here, in that order, and the auth account
 * is rolled back if the profile insert fails so the two never drift apart.
 */
export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let body: z.infer<typeof createSchema>;
  try {
    body = createSchema.parse(await request.json());
  } catch (caught) {
    const issue =
      caught instanceof z.ZodError
        ? (caught.issues[0]?.message ?? "Invalid input.")
        : "Invalid input.";
    return NextResponse.json({ error: `INVALID: ${issue}` }, { status: 400 });
  }

  const { admin } = auth.context;
  const email = body.email.toLowerCase();

  const { data: existing } = await admin
    .from("profiles")
    .select("id")
    .ilike("email", email)
    .maybeSingle();

  if (existing) {
    return NextResponse.json(
      { error: "DUPLICATE: a user with that email already exists." },
      { status: 409 },
    );
  }

  const { data: created, error: authError } = await admin.auth.admin.createUser({
    email,
    password: deriveAccountPassword(email),
    email_confirm: true,
    user_metadata: { name: body.name, seeded_by: "marine-ops-admin" },
  });

  if (authError || !created.user) {
    return NextResponse.json(
      { error: authError?.message ?? "Could not create the backing account." },
      { status: 500 },
    );
  }

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .insert({
      auth_user_id: created.user.id,
      name: body.name,
      email,
      phone: body.phone?.trim() || null,
      date_of_birth: body.dateOfBirth || null,
      role: body.role,
      active: true,
    })
    .select("*")
    .single();

  if (profileError || !profile) {
    await admin.auth.admin.deleteUser(created.user.id);
    return NextResponse.json(
      { error: profileError?.message ?? "Could not create the profile." },
      { status: 500 },
    );
  }

  return NextResponse.json({ profile }, { status: 201 });
}
