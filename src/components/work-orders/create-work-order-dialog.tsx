"use client";

import * as React from "react";
import { Plus } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { useSession } from "@/lib/session";
import { parseError } from "@/lib/errors";
import { fetchAssignableCrew } from "@/lib/queries";
import type { IdentityMember } from "@/lib/database.types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { useList, useQuery } from "@/lib/hooks";

/**
 * Step 1 of the workflow: a Captain raises a work order for their vessel and
 * assigns it to available Crew. Only Captains see this button, and the database
 * refuses the call from anyone else regardless.
 */
export function CreateWorkOrderDialog({ onCreated }: { onCreated: () => void }) {
  const { profile, vessels, activeVesselId } = useSession();
  const { toast } = useToast();

  const [open, setOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [vesselId, setVesselId] = React.useState<string | null>(activeVesselId);
  const [title, setTitle] = React.useState("");
  const [issue, setIssue] = React.useState("");
  const [crewId, setCrewId] = React.useState<string | null>(null);

  const commandVessels = vessels;
  const effectiveVesselId = vesselId ?? activeVesselId ?? commandVessels[0]?.id ?? null;

  const crewQuery = useQuery(
    [effectiveVesselId, open],
    () => fetchAssignableCrew(effectiveVesselId as string),
    { enabled: open && Boolean(effectiveVesselId) },
  );
  const crew: IdentityMember[] = useList(crewQuery.data);
  const loadingCrew = crewQuery.loading;

  const crewError = crewQuery.error;
  React.useEffect(() => {
    if (crewError) {
      toast({ tone: "error", title: "Could not load crew", body: crewError });
    }
  }, [crewError, toast]);

  if (profile?.role !== "captain") return null;

  async function submit() {
    if (!effectiveVesselId || !crewId) return;
    setSaving(true);
    try {
      const { error } = await supabase.rpc("wo_create", {
        p_vessel_id: effectiveVesselId,
        p_title: title,
        p_issue: issue,
        p_assigned_crew_id: crewId,
      });
      if (error) throw error;

      setOpen(false);
      setTitle("");
      setIssue("");
      setCrewId(null);
      toast({ tone: "success", title: "Work order raised" });
      onCreated();
    } catch (caught) {
      toast({
        tone: "error",
        title: "Could not raise the work order",
        body: parseError(caught).message,
      });
    } finally {
      setSaving(false);
    }
  }

  const ready =
    Boolean(effectiveVesselId) &&
    Boolean(crewId) &&
    title.trim().length > 0 &&
    issue.trim().length > 0;

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus /> New work order
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          title="Raise a work order"
          description="It starts Open and lands on the assigned crew member's board."
        >
          <div className="flex flex-col gap-4">
            {commandVessels.length > 1 ? (
              <Field label="Vessel" required>
                <Select
                  value={effectiveVesselId}
                  onValueChange={(next) => {
                    setVesselId(next);
                    setCrewId(null);
                  }}
                  options={commandVessels.map((vessel) => ({
                    value: vessel.id,
                    label: vessel.name,
                  }))}
                />
              </Field>
            ) : null}

            <Field label="Title" required htmlFor="wo-title">
              <Input
                id="wo-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Replace bilge pump seal"
                maxLength={140}
              />
            </Field>

            <Field
              label="Issue"
              required
              htmlFor="wo-issue"
              hint="What is wrong, where, and how urgent."
            >
              <Textarea
                id="wo-issue"
                value={issue}
                onChange={(event) => setIssue(event.target.value)}
                rows={5}
                placeholder="Seal is weeping in the forward bilge; pump cycles every 20 minutes."
              />
            </Field>

            <Field
              label="Assign to"
              required
              hint={
                loadingCrew
                  ? "Loading crew…"
                  : crew.length === 0
                    ? "No active crew is assigned to this vessel yet."
                    : undefined
              }
            >
              <Select
                value={crewId}
                onValueChange={setCrewId}
                options={crew.map((member) => ({
                  value: member.id,
                  label: member.name,
                }))}
                placeholder="Select a crew member"
              />
            </Field>
          </div>

          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button loading={saving} disabled={!ready} onClick={() => void submit()}>
              Raise work order
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
