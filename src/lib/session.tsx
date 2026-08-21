"use client";

import * as React from "react";
import { supabase } from "@/lib/supabase/client";
import type { MeRow, VesselRow } from "@/lib/database.types";
import { parseError } from "@/lib/errors";

export const ALL_VESSELS = "__all__";

const VESSEL_STORAGE_KEY = "marine-wo.active-vessel";

type SessionStatus = "loading" | "anonymous" | "signed-in";

interface SessionValue {
  status: SessionStatus;
  /** The impersonated user's profile — the app behaves exactly as if they logged in. */
  profile: MeRow | null;
  /** Vessels this user can actually see; already scoped by RLS. */
  vessels: VesselRow[];
  /** `null` means "All Vessels", which only an Admin may choose. */
  activeVesselId: string | null;
  activeVessel: VesselRow | null;
  setActiveVesselId: (vesselId: string | null) => void;
  signInAs: (profileId: string) => Promise<void>;
  signOutIdentity: () => Promise<void>;
  refresh: () => Promise<void>;
  switching: boolean;
  error: string | null;
}

const SessionContext = React.createContext<SessionValue | null>(null);

export function useSession(): SessionValue {
  const context = React.useContext(SessionContext);
  if (!context) throw new Error("useSession must be used inside <SessionProvider>");
  return context;
}

/** Convenience guards used all over the UI. Authorization itself lives in RLS. */
export function usePermissions() {
  const { profile } = useSession();
  return React.useMemo(
    () => ({
      isAdmin: profile?.role === "admin",
      isCaptain: profile?.role === "captain",
      isCrew: profile?.role === "crew",
    }),
    [profile],
  );
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = React.useState<SessionStatus>("loading");
  const [profile, setProfile] = React.useState<MeRow | null>(null);
  const [vessels, setVessels] = React.useState<VesselRow[]>([]);
  const [activeVesselId, setActiveVesselIdState] = React.useState<string | null>(null);
  const [switching, setSwitching] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const applyVesselDefault = React.useCallback(
    (nextProfile: MeRow | null, nextVessels: VesselRow[]) => {
      const stored =
        typeof window === "undefined"
          ? null
          : window.localStorage.getItem(VESSEL_STORAGE_KEY);

      if (!nextProfile) {
        setActiveVesselIdState(null);
        return;
      }

      if (stored === ALL_VESSELS && nextProfile.role === "admin") {
        setActiveVesselIdState(null);
        return;
      }
      if (stored && nextVessels.some((vessel) => vessel.id === stored)) {
        setActiveVesselIdState(stored);
        return;
      }
      // Admins are not vessel-bound, so they land on the whole fleet.
      setActiveVesselIdState(
        nextProfile.role === "admin" ? null : (nextVessels[0]?.id ?? null),
      );
    },
    [],
  );

  const load = React.useCallback(async () => {
    const { data: sessionData } = await supabase.auth.getSession();

    if (!sessionData.session) {
      setProfile(null);
      setVessels([]);
      setActiveVesselIdState(null);
      setStatus("anonymous");
      return;
    }

    const { data: meRows, error: meError } = await supabase.rpc("me");
    const me = meRows?.[0] ?? null;

    if (meError || !me || !me.active) {
      // The backing account exists but the profile was deactivated — drop the session.
      await supabase.auth.signOut();
      setProfile(null);
      setVessels([]);
      setStatus("anonymous");
      setError(
        me && !me.active
          ? "That account has been deactivated. Pick another member to continue."
          : (meError?.message ?? null),
      );
      return;
    }

    const { data: vesselRows } = await supabase
      .from("vessels")
      .select("*")
      .eq("active", true)
      .order("name");

    const nextVessels = vesselRows ?? [];
    setProfile(me);
    setVessels(nextVessels);
    applyVesselDefault(me, nextVessels);
    setStatus("signed-in");
  }, [applyVesselDefault]);

  // Supabase emits INITIAL_SESSION as soon as the client has read whatever
  // session was persisted in local storage, so the first load is driven by the
  // auth client rather than by a bare call inside the effect. That is also what
  // keeps the reviewer signed in as the last-selected member across reloads.
  React.useEffect(() => {
    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        setProfile(null);
        setVessels([]);
        setActiveVesselIdState(null);
        setStatus("anonymous");
        return;
      }
      if (event === "INITIAL_SESSION") {
        void load();
      }
    });
    return () => listener.subscription.unsubscribe();
  }, [load]);

  const setActiveVesselId = React.useCallback((vesselId: string | null) => {
    setActiveVesselIdState(vesselId);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(VESSEL_STORAGE_KEY, vesselId ?? ALL_VESSELS);
    }
  }, []);

  const signInAs = React.useCallback(
    async (profileId: string) => {
      setSwitching(true);
      setError(null);
      try {
        const response = await fetch("/api/impersonate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ profileId }),
        });
        const payload = (await response.json()) as {
          access_token?: string;
          refresh_token?: string;
          error?: string;
        };

        if (!response.ok || !payload.access_token || !payload.refresh_token) {
          throw new Error(payload.error ?? "Could not switch identity.");
        }

        const { error: setSessionError } = await supabase.auth.setSession({
          access_token: payload.access_token,
          refresh_token: payload.refresh_token,
        });
        if (setSessionError) throw setSessionError;

        if (typeof window !== "undefined") {
          window.localStorage.removeItem(VESSEL_STORAGE_KEY);
        }
        await load();
      } catch (caught) {
        setError(parseError(caught).message);
        throw caught;
      } finally {
        setSwitching(false);
      }
    },
    [load],
  );

  const signOutIdentity = React.useCallback(async () => {
    await supabase.auth.signOut();
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(VESSEL_STORAGE_KEY);
    }
    setProfile(null);
    setVessels([]);
    setActiveVesselIdState(null);
    setStatus("anonymous");
  }, []);

  const activeVessel = React.useMemo(
    () => vessels.find((vessel) => vessel.id === activeVesselId) ?? null,
    [vessels, activeVesselId],
  );

  const value = React.useMemo<SessionValue>(
    () => ({
      status,
      profile,
      vessels,
      activeVesselId,
      activeVessel,
      setActiveVesselId,
      signInAs,
      signOutIdentity,
      refresh: load,
      switching,
      error,
    }),
    [
      status,
      profile,
      vessels,
      activeVesselId,
      activeVessel,
      setActiveVesselId,
      signInAs,
      signOutIdentity,
      load,
      switching,
      error,
    ],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
