"use client";

import * as React from "react";
import { supabase } from "@/lib/supabase/client";
import { parseError } from "@/lib/errors";

export interface QueryResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

interface QueryState<T> {
  key: string;
  data: T | null;
  error: string | null;
}

/**
 * Minimal fetch-on-dependency-change hook.
 *
 * Deliberately hand-rolled rather than pulling in a data-fetching library: the
 * app has a handful of queries, every one of them is a single Supabase call,
 * and this keeps the request path easy to follow for a reviewer.
 *
 * Loading is derived by comparing the key the state was resolved for against
 * the key currently being requested, rather than by flipping a flag inside the
 * effect. That keeps the previous rows on screen during a refetch (no flicker)
 * and keeps the effect free of synchronous state updates.
 */
export function useQuery<T>(
  key: React.DependencyList,
  run: () => Promise<T>,
  options: { enabled?: boolean } = {},
): QueryResult<T> {
  const enabled = options.enabled ?? true;
  const [nonce, setNonce] = React.useState(0);
  const [state, setState] = React.useState<QueryState<T>>({
    key: "",
    data: null,
    error: null,
  });

  const requestKey = React.useMemo(
    () => JSON.stringify([key, nonce, enabled]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [...key, nonce, enabled],
  );

  // Keep the latest closure available to the effect without making it a
  // dependency — callers pass a fresh arrow function on every render.
  const runRef = React.useRef(run);
  React.useEffect(() => {
    runRef.current = run;
  });

  React.useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    void (async () => {
      try {
        const result = await runRef.current();
        if (!cancelled) setState({ key: requestKey, data: result, error: null });
      } catch (caught) {
        if (!cancelled) {
          setState((current) => ({
            key: requestKey,
            data: current.data,
            error: parseError(caught).message,
          }));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [requestKey, enabled]);

  const refresh = React.useCallback(() => setNonce((value) => value + 1), []);
  const settled = state.key === requestKey;

  return {
    data: state.data,
    loading: enabled && !settled,
    error: settled ? state.error : null,
    refresh,
  };
}

/**
 * Re-run a callback whenever another device changes the given table.
 *
 * This is what makes the optimistic-concurrency guard (§4.3) pleasant rather
 * than annoying: the second device usually sees the new state before its user
 * clicks anything, and if it does not, the write is still rejected safely.
 */
export function useRealtimeRefresh(table: string, onChange: () => void) {
  const handlerRef = React.useRef(onChange);
  React.useEffect(() => {
    handlerRef.current = onChange;
  });

  React.useEffect(() => {
    const channel = supabase
      .channel(`realtime:${table}`)
      .on("postgres_changes", { event: "*", schema: "public", table }, () =>
        handlerRef.current(),
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [table]);
}

/** Tracks an in-flight mutation so buttons can disable themselves. */
export function usePending() {
  const [pending, setPending] = React.useState<string | null>(null);

  const run = React.useCallback(
    async (key: string, action: () => Promise<void>) => {
      setPending(key);
      try {
        await action();
      } finally {
        setPending(null);
      }
    },
    [],
  );

  return { pending, run, isPending: (key: string) => pending === key };
}

/** Stable empty array so `?? []` does not create a new dependency each render. */
export function useList<T>(value: T[] | null | undefined): T[] {
  return React.useMemo(() => value ?? [], [value]);
}
