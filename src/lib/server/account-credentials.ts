import { createHash } from "node:crypto";

/**
 * Every mock user is backed by a real, hidden Supabase Auth account. That is
 * what makes `auth.uid()` real and RLS enforceable without ever showing a login
 * form (§6 of the brief).
 *
 * Those accounts need a credential. Rather than storing one, we derive it
 * deterministically from a server-only secret plus the account's email, so:
 *   - the seed script and the impersonation route agree without a shared table,
 *   - the credential never appears in the browser bundle, in the database, or
 *     in any API response,
 *   - rotating IMPERSONATION_SECRET invalidates every backing account at once.
 */
export function deriveAccountPassword(email: string): string {
  const secret = process.env.IMPERSONATION_SECRET;

  if (!secret || secret.length < 16) {
    throw new Error(
      "IMPERSONATION_SECRET must be set to a random string of at least 16 characters.",
    );
  }

  const digest = createHash("sha256")
    .update(`${secret}:${email.trim().toLowerCase()}`)
    .digest("base64url");

  // Prefixed so the result always satisfies Supabase's password complexity rules.
  return `Mw1!${digest.slice(0, 40)}`;
}
