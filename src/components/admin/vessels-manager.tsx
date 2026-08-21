"use client";

import * as React from "react";
import { Pencil, Plus, RotateCcw, ShipWheel } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { parseError } from "@/lib/errors";
import { useList, useQuery } from "@/lib/hooks";
import { fetchAssignments, fetchProfiles, fetchVessels } from "@/lib/queries";
import type { VesselRow } from "@/lib/database.types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { ActiveBadge } from "@/components/ui/badge";
import {
  EmptyState,
  ErrorState,
  SkeletonRows,
} from "@/components/ui/data-state";
import { Table, TableWrapper, Td, Th, Tr } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";

interface FormState {
  id: string | null;
  name: string;
  imo: string;
  mmsi: string;
  flagState: string;
}

const EMPTY_FORM: FormState = {
  id: null,
  name: "",
  imo: "",
  mmsi: "",
  flagState: "",
};

export function VesselsManager() {
  const { toast } = useToast();
  const vesselsQuery = useQuery([], () => fetchVessels(true));
  const assignmentsQuery = useQuery([], () => fetchAssignments());
  const peopleQuery = useQuery([], () =>
    fetchProfiles({ includeInactive: true }),
  );

  const [open, setOpen] = React.useState(false);
  const [form, setForm] = React.useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = React.useState(false);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const crewCounts = React.useMemo(() => {
    const people = new Map(
      (peopleQuery.data ?? []).map((person) => [person.id, person]),
    );
    const map = new Map<string, { captains: string[]; crew: number }>();
    for (const assignment of assignmentsQuery.data ?? []) {
      if (!assignment.active) continue;
      const person = people.get(assignment.user_id);
      if (!person?.active) continue;
      const entry = map.get(assignment.vessel_id) ?? { captains: [], crew: 0 };
      if (person.role === "captain") entry.captains.push(person.name);
      if (person.role === "crew") entry.crew += 1;
      map.set(assignment.vessel_id, entry);
    }
    return map;
  }, [assignmentsQuery.data, peopleQuery.data]);

  function openCreate() {
    setForm(EMPTY_FORM);
    setOpen(true);
  }

  function openEdit(vessel: VesselRow) {
    setForm({
      id: vessel.id,
      name: vessel.name,
      imo: vessel.imo_number ?? "",
      mmsi: vessel.mmsi ?? "",
      flagState: vessel.flag_state ?? "",
    });
    setOpen(true);
  }

  async function save() {
    setSaving(true);
    try {
      const args = {
        p_name: form.name.trim(),
        p_imo_number: form.imo.trim() || null,
        p_mmsi: form.mmsi.trim() || null,
        p_flag_state: form.flagState.trim() || null,
      };

      const { error } = form.id
        ? await supabase.rpc("admin_update_vessel", { p_id: form.id, ...args })
        : await supabase.rpc("admin_create_vessel", args);

      if (error) throw error;

      toast({
        tone: "success",
        title: form.id ? "Vessel updated" : "Vessel added",
      });
      setOpen(false);
      vesselsQuery.refresh();
    } catch (caught) {
      toast({
        tone: "error",
        title: "Could not save the vessel",
        body: parseError(caught).message,
      });
    } finally {
      setSaving(false);
    }
  }

  async function setActive(vessel: VesselRow, active: boolean) {
    setBusyId(vessel.id);
    try {
      const { error } = await supabase.rpc("admin_set_vessel_active", {
        p_id: vessel.id,
        p_active: active,
      });
      if (error) throw error;
      toast({
        tone: "success",
        title: active
          ? `${vessel.name} reactivated`
          : `${vessel.name} deactivated`,
      });
      vesselsQuery.refresh();
      assignmentsQuery.refresh();
    } catch (caught) {
      const error = parseError(caught);
      toast({
        tone: error.kind === "BLOCKED" ? "conflict" : "error",
        title:
          error.kind === "BLOCKED"
            ? "Guardrail stopped that"
            : "Could not update",
        body: error.message,
      });
    } finally {
      setBusyId(null);
    }
  }

  const vessels = useList(vesselsQuery.data);

  const imoDuplicate = React.useMemo(() => {
    const imo = form.imo.trim();
    if (!imo) return null;
    return (
      vessels.find((v) => v.id !== form.id && v.imo_number === imo) ?? null
    );
  }, [vessels, form.imo, form.id]);
  const imoError = imoDuplicate
    ? `This IMO number is already used by ${imoDuplicate.name}.`
    : null;

  const mmsiDuplicate = React.useMemo(() => {
    const mmsi = form.mmsi.trim();
    if (!mmsi) return null;
    return vessels.find((v) => v.id !== form.id && v.mmsi === mmsi) ?? null;
  }, [vessels, form.mmsi, form.id]);
  const mmsiError = mmsiDuplicate
    ? `This MMSI is already used by ${mmsiDuplicate.name}.`
    : null;

  const valid = form.name.trim().length > 1 && !imoDuplicate && !mmsiDuplicate;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 p-3 sm:p-4">
          <p className="text-sm text-muted">
            IMO numbers and MMSI are both unique across the fleet.
          </p>
          <Button onClick={openCreate}>
            <Plus /> New vessel
          </Button>
        </div>
      </Card>

      <Card className="overflow-hidden">
        {vesselsQuery.loading && vessels.length === 0 ? (
          <SkeletonRows rows={4} />
        ) : vesselsQuery.error ? (
          <ErrorState message={vesselsQuery.error} />
        ) : vessels.length === 0 ? (
          <EmptyState icon={ShipWheel} title="No vessels yet" />
        ) : (
          <TableWrapper>
            <Table className="min-w-3xl">
              <thead>
                <tr>
                  <Th>Vessel</Th>
                  <Th className="w-32">IMO</Th>
                  <Th className="w-32">MMSI</Th>
                  <Th className="w-32">Flag</Th>
                  <Th>Complement</Th>
                  <Th className="w-24">Status</Th>
                  <Th className="w-44 text-right">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {vessels.map((vessel) => {
                  const complement = crewCounts.get(vessel.id);
                  return (
                    <Tr
                      key={vessel.id}
                      className={vessel.active ? undefined : "opacity-60"}
                    >
                      <Td className="font-medium text-hull-900">
                        {vessel.name}
                      </Td>
                      <Td className="font-mono text-xs">
                        {vessel.imo_number ?? "—"}
                      </Td>
                      <Td className="font-mono text-xs">
                        {vessel.mmsi ?? "—"}
                      </Td>
                      <Td className="text-sm">{vessel.flag_state ?? "—"}</Td>
                      <Td className="text-sm">
                        {complement && complement.captains.length > 0 ? (
                          <>
                            <span className="text-hull-900">
                              {complement.captains.join(", ")}
                            </span>
                            <span className="text-muted">
                              {" "}
                              · {complement.crew} crew
                            </span>
                          </>
                        ) : (
                          <span className="text-amber-700">
                            No active Captain
                          </span>
                        )}
                      </Td>
                      <Td>
                        <ActiveBadge active={vessel.active} />
                      </Td>
                      <Td>
                        <div className="flex justify-end gap-1.5">
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => openEdit(vessel)}
                          >
                            <Pencil /> Edit
                          </Button>
                          <Button
                            size="sm"
                            variant={vessel.active ? "danger" : "secondary"}
                            loading={busyId === vessel.id}
                            onClick={() =>
                              void setActive(vessel, !vessel.active)
                            }
                          >
                            {vessel.active ? null : <RotateCcw />}
                            {vessel.active ? "Deactivate" : "Restore"}
                          </Button>
                        </div>
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          </TableWrapper>
        )}
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          title={form.id ? "Edit vessel" : "New vessel"}
          description="Leave IMO blank for vessels under 100 GT — the name, MMSI and flag state then form the fallback key."
        >
          <div className="flex flex-col gap-4">
            <Field label="Vessel name" required htmlFor="vessel-name">
              <Input
                id="vessel-name"
                value={form.name}
                onChange={(event) =>
                  setForm((state) => ({ ...state, name: event.target.value }))
                }
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="IMO number"
                htmlFor="vessel-imo"
                error={imoError}
                hint="Exactly 7 digits, permanent for the hull and unique across the fleet."
              >
                <Input
                  id="vessel-imo"
                  inputMode="numeric"
                  value={form.imo}
                  onChange={(event) =>
                    setForm((state) => ({ ...state, imo: event.target.value }))
                  }
                  placeholder="9074729"
                />
              </Field>
              <Field
                label="MMSI"
                htmlFor="vessel-mmsi"
                error={mmsiError}
                hint="Exactly 9 digits and unique across the fleet; changes with flag or ownership."
              >
                <Input
                  id="vessel-mmsi"
                  inputMode="numeric"
                  value={form.mmsi}
                  onChange={(event) =>
                    setForm((state) => ({ ...state, mmsi: event.target.value }))
                  }
                  placeholder="215234000"
                />
              </Field>
            </div>
            <Field label="Flag state" htmlFor="vessel-flag">
              <Input
                id="vessel-flag"
                value={form.flagState}
                onChange={(event) =>
                  setForm((state) => ({
                    ...state,
                    flagState: event.target.value,
                  }))
                }
                placeholder="Malta"
              />
            </Field>
          </div>

          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={saving}
              disabled={!valid}
              onClick={() => void save()}
            >
              {form.id ? "Save changes" : "Add vessel"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
