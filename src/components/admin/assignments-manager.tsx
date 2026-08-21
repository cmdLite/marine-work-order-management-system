"use client";

import * as React from "react";
import { Link2Off, Plus, UserPlus } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { parseError } from "@/lib/errors";
import { useList, useQuery } from "@/lib/hooks";
import {
  ADMIN_PAGE_SIZE,
  fetchAssignmentsForVessels,
  fetchProfiles,
  fetchVessels,
} from "@/lib/queries";
import { Pagination } from "@/components/ui/pagination";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { RoleBadge } from "@/components/ui/badge";
import {
  EmptyState,
  ErrorState,
  SkeletonRows,
} from "@/components/ui/data-state";
import { useToast } from "@/components/ui/toast";
import { ROLE_LABEL } from "@/lib/utils";

/**
 * Vessel assignment is a many-to-many join. Crew may serve several vessels at
 * once (relief pools); a Captain holds one active command at a time, which the
 * database enforces with a trigger rather than trusting this screen.
 */
export function AssignmentsManager() {
  const { toast } = useToast();
  // `vessels` and `profiles` are the small dimension tables here and both feed
  // the pickers in the Assign dialog, so they are fetched whole. The table that
  // actually grows with the fleet is vessel_assignments — vessels × crew — and
  // that one is only ever fetched for the vessels currently on screen.
  const vesselsQuery = useQuery([], () => fetchVessels(true));
  const peopleQuery = useQuery([], () => fetchProfiles());

  const [open, setOpen] = React.useState(false);
  const [vesselId, setVesselId] = React.useState<string | null>(null);
  const [userId, setUserId] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [busyKey, setBusyKey] = React.useState<string | null>(null);
  const [page, setPage] = React.useState(0);

  const vessels = useList(vesselsQuery.data);
  const people = useList(peopleQuery.data);

  const visibleVessels = React.useMemo(
    () => vessels.slice(page * ADMIN_PAGE_SIZE, (page + 1) * ADMIN_PAGE_SIZE),
    [vessels, page],
  );
  const visibleVesselIds = visibleVessels.map((vessel) => vessel.id).join(",");

  const assignmentsQuery = useQuery([visibleVesselIds], () =>
    fetchAssignmentsForVessels(visibleVesselIds ? visibleVesselIds.split(",") : []),
  );
  const assignments = useList(assignmentsQuery.data);

  /**
   * The dialog can target a vessel that is not on the current page, so it reads
   * that vessel's assignments directly instead of the page's. Without this the
   * Captain-first rule and the already-assigned filter would both be judging a
   * vessel they had no rows for.
   */
  const dialogAssignmentsQuery = useQuery(
    [vesselId],
    () => fetchAssignmentsForVessels(vesselId ? [vesselId] : []),
    { enabled: open && Boolean(vesselId) },
  );
  const dialogAssignments = useList(dialogAssignmentsQuery.data);

  const peopleById = React.useMemo(
    () => new Map(people.map((person) => [person.id, person])),
    [people],
  );

  const byVessel = React.useMemo(() => {
    const map = new Map<string, typeof assignments>();
    for (const assignment of assignments) {
      if (!assignment.active) continue;
      if (!peopleById.has(assignment.user_id)) continue;
      const list = map.get(assignment.vessel_id) ?? [];
      list.push(assignment);
      map.set(assignment.vessel_id, list);
    }
    return map;
  }, [assignments, peopleById]);

  const activeDialogAssignments = React.useMemo(
    () =>
      dialogAssignments.filter(
        (assignment) => assignment.active && peopleById.has(assignment.user_id),
      ),
    [dialogAssignments, peopleById],
  );

  const vesselHasCaptain = activeDialogAssignments.some(
    (assignment) => peopleById.get(assignment.user_id)?.role === "captain",
  );

  // An empty vessel must get its Captain first — the Person list only offers
  // Captains until one is assigned, then opens up to Captains and Crew alike.
  const assignableToVessel = React.useMemo(() => {
    if (!vesselId) return [];
    const already = new Set(
      activeDialogAssignments.map((assignment) => assignment.user_id),
    );
    return people.filter((person) => {
      if (already.has(person.id)) return false;
      if (person.role === "admin") return false;
      return vesselHasCaptain || person.role === "captain";
    });
  }, [people, activeDialogAssignments, vesselId, vesselHasCaptain]);

  function refreshAll() {
    assignmentsQuery.refresh();
    dialogAssignmentsQuery.refresh();
  }

  function openAssign(preselectedVesselId: string | null) {
    setVesselId(preselectedVesselId);
    setUserId(null);
    setOpen(true);
  }

  async function assign() {
    if (!vesselId || !userId) return;
    setSaving(true);
    try {
      const { error } = await supabase.rpc("admin_assign_vessel", {
        p_user_id: userId,
        p_vessel_id: vesselId,
      });
      if (error) throw error;
      toast({ tone: "success", title: "Assignment added" });
      setOpen(false);
      setUserId(null);
      refreshAll();
    } catch (caught) {
      const error = parseError(caught);
      toast({
        tone:
          error.kind === "BLOCKED" || error.kind === "INVALID"
            ? "conflict"
            : "error",
        title: "Could not assign",
        body: error.message,
      });
    } finally {
      setSaving(false);
    }
  }

  async function unassign(userIdToRemove: string, vesselIdToRemove: string) {
    const key = `${userIdToRemove}:${vesselIdToRemove}`;
    setBusyKey(key);
    try {
      const { error } = await supabase.rpc("admin_unassign_vessel", {
        p_user_id: userIdToRemove,
        p_vessel_id: vesselIdToRemove,
      });
      if (error) throw error;
      toast({ tone: "success", title: "Assignment removed" });
      refreshAll();
    } catch (caught) {
      const error = parseError(caught);
      toast({
        tone: error.kind === "BLOCKED" ? "conflict" : "error",
        title:
          error.kind === "BLOCKED"
            ? "Guardrail stopped that"
            : "Could not remove",
        body: error.message,
      });
    } finally {
      setBusyKey(null);
    }
  }

  const loading =
    vesselsQuery.loading || peopleQuery.loading || assignmentsQuery.loading;
  const error =
    vesselsQuery.error ?? peopleQuery.error ?? assignmentsQuery.error;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 p-3 sm:p-4">
          <p className="text-sm text-muted">
            Crew may hold several assignments; a Captain may hold only one
            active command.
          </p>
          <Button onClick={() => openAssign(vessels[0]?.id ?? null)}>
            <Plus /> Assign someone
          </Button>
        </div>
      </Card>

      {error ? (
        <Card>
          <ErrorState message={error} />
        </Card>
      ) : loading && vessels.length === 0 ? (
        <Card>
          <SkeletonRows rows={4} />
        </Card>
      ) : vessels.length === 0 ? (
        <Card>
          <EmptyState
            title="No active vessels"
            description="Add a vessel first."
          />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {visibleVessels.map((vessel) => {
            const crew = byVessel.get(vessel.id) ?? [];
            const captains = crew.filter(
              (assignment) =>
                peopleById.get(assignment.user_id)?.role === "captain",
            );
            return (
              <Card key={vessel.id}>
                <CardHeader className="flex-row items-center justify-between gap-2">
                  <div className="min-w-0">
                    <CardTitle className="truncate">{vessel.name}</CardTitle>
                    <p className="mt-0.5 text-xs text-muted">
                      {crew.length} assigned ·{" "}
                      {captains.length === 0 ? (
                        <span className="text-amber-700">
                          no active Captain
                        </span>
                      ) : (
                        `${captains.length} Captain${captains.length === 1 ? "" : "s"}`
                      )}
                    </p>
                  </div>
                  {crew.length > 0 ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      className="shrink-0"
                      title={`Assign someone to ${vessel.name}`}
                      onClick={() => openAssign(vessel.id)}
                    >
                      <UserPlus />
                    </Button>
                  ) : null}
                </CardHeader>
                {crew.length === 0 ? (
                  <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
                    <Button
                      size="icon"
                      variant="secondary"
                      className="rounded-full"
                      title={`Assign someone to ${vessel.name}`}
                      onClick={() => openAssign(vessel.id)}
                    >
                      <UserPlus />
                    </Button>
                    <p className="text-sm font-medium text-hull-900">
                      Nobody assigned
                    </p>
                    <p className="max-w-sm text-sm text-muted">
                      Assign a Captain before raising work orders here.
                    </p>
                  </div>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {[...crew]
                      .sort((a, b) => {
                        const roleA = peopleById.get(a.user_id)?.role;
                        const roleB = peopleById.get(b.user_id)?.role;
                        return (
                          Number(roleB === "captain") -
                          Number(roleA === "captain")
                        );
                      })
                      .map((assignment) => {
                        const person = peopleById.get(assignment.user_id);
                        if (!person) return null;
                        const key = `${person.id}:${vessel.id}`;
                        return (
                          <li
                            key={assignment.id}
                            className="flex items-center justify-between gap-3 px-4 py-2.5 sm:px-5"
                          >
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-hull-900">
                                {person.name}
                              </p>
                              <p className="truncate text-xs text-muted">
                                {person.email}
                              </p>
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                              <RoleBadge role={person.role} />
                              <Button
                                size="sm"
                                variant="ghost"
                                loading={busyKey === key}
                                title="Remove assignment"
                                onClick={() =>
                                  void unassign(person.id, vessel.id)
                                }
                              >
                                <Link2Off />
                              </Button>
                            </div>
                          </li>
                        );
                      })}
                  </ul>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {vessels.length > ADMIN_PAGE_SIZE ? (
        <Card>
          <Pagination
            page={page}
            pageSize={ADMIN_PAGE_SIZE}
            total={vessels.length}
            loading={assignmentsQuery.loading}
            onPageChange={setPage}
            noun="vessel"
            className="border-t-0"
          />
        </Card>
      ) : null}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          title="Assign to a vessel"
          description="Admins are not vessel-bound and cannot be assigned."
        >
          <div className="flex flex-col gap-4">
            <Field label="Vessel" required>
              <Select
                value={vesselId}
                onValueChange={(next) => {
                  setVesselId(next);
                  setUserId(null);
                }}
                options={vessels.map((vessel) => ({
                  value: vessel.id,
                  label: vessel.name,
                }))}
              />
            </Field>
            <Field
              label="Person"
              required
              hint={
                dialogAssignmentsQuery.loading
                  ? "Checking who is already aboard…"
                  : assignableToVessel.length > 0
                    ? undefined
                    : !vesselHasCaptain
                      ? "This vessel needs a Captain assigned before any Crew."
                      : "Everyone eligible is already assigned to this vessel."
              }
            >
              <Select
                value={userId}
                onValueChange={setUserId}
                // Held shut until this vessel's current crew is known, so the
                // Captain-first rule is never applied against an empty list.
                disabled={dialogAssignmentsQuery.loading}
                options={assignableToVessel.map((person) => ({
                  value: person.id,
                  label: person.name,
                  description: `${ROLE_LABEL[person.role]} / ${person.email}`,
                }))}
                placeholder={
                  dialogAssignmentsQuery.loading ? "Loading…" : "Select a person"
                }
              />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={saving}
              disabled={!vesselId || !userId}
              onClick={() => void assign()}
            >
              Assign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
