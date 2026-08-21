import type { PostgrestError } from "@supabase/supabase-js";

/**
 * The database raises every business-rule failure as `CODE: human sentence`
 * (see supabase/migrations/0003_functions.sql). This turns that back into
 * something the UI can branch on and a message worth showing a person.
 */
export const APP_ERROR_KINDS = [
  "NOT_AUTHENTICATED",
  "FORBIDDEN",
  "INVALID",
  "CONFLICT",
  "BLOCKED",
  "DUPLICATE",
  "NOT_FOUND",
  "UNKNOWN",
] as const;

export type AppErrorKind = (typeof APP_ERROR_KINDS)[number];

export interface AppError {
  kind: AppErrorKind;
  message: string;
}

const KNOWN = new Set<string>(APP_ERROR_KINDS);

export function parseError(error: unknown): AppError {
  const raw = extractMessage(error);

  const separator = raw.indexOf(":");
  if (separator > 0) {
    const candidate = raw.slice(0, separator).trim();
    if (KNOWN.has(candidate)) {
      return {
        kind: candidate as AppErrorKind,
        message: raw.slice(separator + 1).trim(),
      };
    }
  }

  // An access token that lapsed while the tab sat idle. PostgREST answers 401
  // with PGRST301 and a message about decoding keys, which means nothing to the
  // person reading it — and the session usually recovers on its own, because the
  // refresh token is still good.
  if (
    /PGRST301/.test(raw) ||
    /jwt expired/i.test(raw) ||
    /(no suitable key|able to decode the jwt)/i.test(raw)
  ) {
    return {
      kind: "NOT_AUTHENTICATED",
      message: "Your session expired. Reconnecting — try that again in a moment.",
    };
  }

  // Postgres-level failures that never reached our own guards.
  if (/row-level security/i.test(raw) || /permission denied/i.test(raw)) {
    return {
      kind: "FORBIDDEN",
      message: "You do not have permission to do that.",
    };
  }
  if (/duplicate key value/i.test(raw)) {
    return { kind: "DUPLICATE", message: "That record already exists." };
  }

  return { kind: "UNKNOWN", message: raw || "Something went wrong." };
}

function extractMessage(error: unknown): string {
  if (!error) return "";
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;

  const maybe = error as Partial<PostgrestError> & { error?: string };
  return maybe.message ?? maybe.error ?? String(error);
}

/** A conflict means someone else won the race — the UI should offer a refresh. */
export function isConflict(error: AppError): boolean {
  return error.kind === "CONFLICT";
}
