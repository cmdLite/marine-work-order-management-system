"use client";

import { supabase } from "@/lib/supabase/client";

/**
 * Calls one of the two service-role routes, always attaching the caller's real
 * Supabase access token so the server can verify who is asking. There is no
 * client-supplied "I am an admin" flag anywhere.
 */
export async function apiFetch<T>(
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
    body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
  });

  const payload = (await response.json().catch(() => ({}))) as {
    error?: string;
  } & T;

  if (!response.ok) {
    throw new Error(payload.error ?? `Request failed (${response.status}).`);
  }

  return payload;
}
