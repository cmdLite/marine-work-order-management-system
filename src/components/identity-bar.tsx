"use client";

import * as React from "react";
import { Anchor, LogOut, ShieldCheck, UserRound } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { ALL_VESSELS, useSession } from "@/lib/session";
import type { IdentityMember, IdentityVessel, UserRole } from "@/lib/database.types";
import { Select, type SelectOption } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { RoleBadge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/data-state";
import { useToast } from "@/components/ui/toast";
import { useList, useQuery } from "@/lib/hooks";
import { ROLE_LABEL, cn, initials } from "@/lib/utils";

const ROLE_OPTIONS: SelectOption[] = [
  { value: "admin", label: "Admin", description: "Fleet-wide management" },
  { value: "captain", label: "Captain", description: "Commands one vessel" },
  { value: "crew", label: "Crew", description: "Carries out the work" },
];

/**
 * The Identity Bar *is* the login screen (§3). Its three dropdowns are
 * dependent: vessel narrows the roles in play, role narrows the member list,
 * and picking a member mints a real Supabase session for that person's hidden
 * backing account — from that moment the whole app behaves as if they had
 * signed in, because the database itself now sees them as the caller.
 */
export function IdentityBar() {
  const {
    status,
    profile,
    activeVesselId,
    setActiveVesselId,
    signInAs,
    signOutIdentity,
    switching,
  } = useSession();
  const { toast } = useToast();

  // Admins are not vessel-bound, so they (and an unclaimed session) may pick
  // "All Vessels"; a Captain or Crew member only ever sees their own ships.
  const canPickAllVessels = !profile || profile.role === "admin";

  // Before anyone is signed in there is no session to hold the vessel context,
  // so the bar keeps its own; afterwards the session is the single source of
  // truth and this stays derived from it.
  const [anonymousVessel, setAnonymousVessel] = React.useState<string>(ALL_VESSELS);
  const [roleOverride, setRoleOverride] = React.useState<UserRole | null>(null);

  const vesselChoice = profile ? (activeVesselId ?? ALL_VESSELS) : anonymousVessel;
  const roleChoice = roleOverride ?? profile?.role ?? null;

  // Dropdown 1 — vessels this identity is allowed to look at.
  const vesselsQuery = useQuery([profile?.id ?? null], async () => {
    const { data, error } = await supabase.rpc("identity_vessels", {
      p_profile_id: profile?.id ?? null,
    });
    if (error) throw error;
    return data ?? [];
  });

  // Dropdowns 2 → 3 — members matching the selected vessel and role.
  const membersQuery = useQuery([vesselChoice, roleChoice], async () => {
    const { data, error } = await supabase.rpc("identity_members", {
      p_vessel_id: vesselChoice === ALL_VESSELS ? null : vesselChoice,
      p_role: roleChoice,
    });
    if (error) throw error;
    return data ?? [];
  });

  const vessels: IdentityVessel[] = useList(vesselsQuery.data);
  const members: IdentityMember[] = useList(membersQuery.data);
  const loadingMembers = membersQuery.loading;

  const loadError = vesselsQuery.error ?? membersQuery.error;
  React.useEffect(() => {
    if (loadError) {
      toast({ tone: "error", title: "Could not load the directory", body: loadError });
    }
  }, [loadError, toast]);

  const vesselOptions = React.useMemo<SelectOption[]>(() => {
    const options = vessels.map((vessel) => ({
      value: vessel.id,
      label: vessel.name,
    }));
    return canPickAllVessels
      ? [
          {
            value: ALL_VESSELS,
            label: "All Vessels",
            description: "Fleet-wide view",
          },
          ...options,
        ]
      : options;
  }, [vessels, canPickAllVessels]);

  const memberOptions = React.useMemo<SelectOption[]>(
    () =>
      members.map((member) => ({
        value: member.id,
        label: member.name,
        description: ROLE_LABEL[member.role],
      })),
    [members],
  );

  function handleVesselChange(next: string) {
    if (profile) {
      // The vessel dropdown is also the app's data scope (§3.1).
      setActiveVesselId(next === ALL_VESSELS ? null : next);
    } else {
      setAnonymousVessel(next);
    }
  }

  async function handleMemberChange(profileId: string) {
    if (profileId === profile?.id) return;
    const member = members.find((candidate) => candidate.id === profileId);
    try {
      await signInAs(profileId);
      // The new identity's own role takes over the filter again.
      setRoleOverride(null);
      toast({
        tone: "success",
        title: `Now acting as ${member?.name ?? "the selected member"}`,
        body: member
          ? `${ROLE_LABEL[member.role]} permissions are in effect.`
          : undefined,
      });
    } catch (caught) {
      toast({
        tone: "error",
        title: "Could not switch identity",
        body: caught instanceof Error ? caught.message : undefined,
      });
    }
  }

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-3 py-2.5 sm:px-5 lg:flex-row lg:items-center lg:gap-4">
        <div className="flex items-center justify-between gap-3 lg:justify-start">
          <div className="flex items-center gap-2">
            <span className="grid size-8 place-items-center rounded-lg bg-hull-700 text-white">
              <Anchor className="size-4" aria-hidden />
            </span>
            <div className="leading-tight">
              <p className="text-sm font-semibold text-hull-900">Marine Ops</p>
              <p className="hidden text-[11px] text-muted sm:block">
                Work order management
              </p>
            </div>
          </div>
          <CurrentIdentity className="lg:hidden" />
        </div>

        <div className="grid flex-1 gap-2 sm:grid-cols-3 lg:max-w-3xl">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold tracking-wider text-muted uppercase">
              1 · Vessel
            </span>
            <Select
              aria-label="Vessel"
              value={vesselChoice}
              onValueChange={handleVesselChange}
              options={vesselOptions}
              placeholder="Select a vessel"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold tracking-wider text-muted uppercase">
              2 · Role
            </span>
            <Select
              aria-label="Role"
              value={roleChoice}
              onValueChange={(next) => setRoleOverride(next as UserRole)}
              options={ROLE_OPTIONS}
              placeholder="Any role"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold tracking-wider text-muted uppercase">
              3 · Member
            </span>
            <div className="relative">
              <Select
                aria-label="Member"
                value={profile?.id ?? null}
                onValueChange={(next) => void handleMemberChange(next)}
                options={memberOptions}
                placeholder={
                  loadingMembers
                    ? "Loading…"
                    : memberOptions.length === 0
                      ? "No one matches"
                      : "Sign in as…"
                }
                disabled={switching}
              />
              {switching ? (
                <span className="absolute inset-y-0 right-8 grid place-items-center">
                  <Spinner />
                </span>
              ) : null}
            </div>
          </label>
        </div>

        <div className="hidden items-center gap-2 lg:flex">
          <CurrentIdentity />
          {status === "signed-in" ? (
            <Button
              variant="ghost"
              size="icon"
              title="Leave this identity"
              aria-label="Leave this identity"
              onClick={() => void signOutIdentity()}
            >
              <LogOut />
            </Button>
          ) : null}
        </div>
      </div>

      {status === "anonymous" ? (
        <p className="border-t border-amber-200 bg-amber-50 px-4 py-1.5 text-center text-xs text-amber-900">
          Pick a member above to sign in — there is no login screen, the Identity
          Bar is the sign-in.
        </p>
      ) : null}
    </header>
  );
}

function CurrentIdentity({ className }: { className?: string }) {
  const { profile, status, signOutIdentity } = useSession();

  if (status === "loading") {
    return (
      <div className={cn("flex items-center gap-2 text-xs text-muted", className)}>
        <Spinner />
        Restoring session…
      </div>
    );
  }

  if (!profile) {
    return (
      <div className={cn("flex items-center gap-2 text-xs text-muted", className)}>
        <UserRound className="size-4" aria-hidden />
        Not signed in
      </div>
    );
  }

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <span
        className="grid size-8 shrink-0 place-items-center rounded-full bg-hull-100 text-xs font-semibold text-hull-800"
        aria-hidden
      >
        {initials(profile.name)}
      </span>
      <div className="hidden leading-tight sm:block">
        <p className="max-w-[10rem] truncate text-sm font-medium text-hull-900">
          {profile.name}
        </p>
        <span className="flex items-center gap-1 text-[11px] text-muted">
          <ShieldCheck className="size-3" aria-hidden />
          Live session
        </span>
      </div>
      <RoleBadge role={profile.role} />
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden"
        title="Leave this identity"
        aria-label="Leave this identity"
        onClick={() => void signOutIdentity()}
      >
        <LogOut />
      </Button>
    </div>
  );
}
