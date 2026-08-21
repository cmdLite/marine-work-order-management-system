"use client";

import * as React from "react";
import {
  CheckCheck,
  PlayCircle,
  Repeat2,
  ShieldCheck,
  Undo2,
} from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { useSession } from "@/lib/session";
import { parseError } from "@/lib/errors";
import { fetchAssignableCrew } from "@/lib/queries";
import type { IdentityMember, WorkOrderExpandedRow } from "@/lib/database.types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field, Textarea } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { usePending } from "@/lib/hooks";

interface Props {
  workOrder: WorkOrderExpandedRow;
  onChanged: () => void;
  size?: "sm" | "md";
}

/**
 * Every button here sends the state the UI *believed* was current alongside the
 * request. If another device already moved the work order on, the database
 * refuses the write and we tell the user to refresh rather than silently
 * clobbering their colleague (§4.3).
 */
export function WorkOrderActions({ workOrder, onChanged, size = "sm" }: Props) {
  const { profile } = useSession();
  const { toast } = useToast();
  const { run, isPending } = usePending();

  const [completeOpen, setCompleteOpen] = React.useState(false);
  const [rejectOpen, setRejectOpen] = React.useState(false);
  const [reassignOpen, setReassignOpen] = React.useState(false);

  const [solution, setSolution] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [newCrewId, setNewCrewId] = React.useState<string | null>(null);
  const [crew, setCrew] = React.useState<IdentityMember[]>([]);

  const attested = workOrder.attested_at !== null;
  const isAssignee = profile?.id === workOrder.assigned_crew_id;
  const isCaptainOfVessel = profile?.role === "captain";
  const isAdmin = profile?.role === "admin";

  const canStart = isAssignee && workOrder.status === "open";
  const canComplete = isAssignee && workOrder.status === "in_progress";
  const canReview = isCaptainOfVessel && workOrder.status === "done" && !attested;
  const canReassign = (isAdmin || isCaptainOfVessel) && !attested;

  const handleError = React.useCallback(
    (caught: unknown) => {
      const error = parseError(caught);
      toast({
        tone: error.kind === "CONFLICT" ? "conflict" : "error",
        title:
          error.kind === "CONFLICT"
            ? "Already updated elsewhere"
            : "Action refused",
        body: error.message,
      });
      if (error.kind === "CONFLICT" || error.kind === "NOT_FOUND") onChanged();
    },
    [onChanged, toast],
  );

  async function start() {
    await run("start", async () => {
      const { error } = await supabase.rpc("wo_start", {
        p_id: workOrder.id,
        p_expected_status: workOrder.status,
      });
      if (error) return handleError(error);
      toast({ tone: "success", title: `${workOrder.code} is now In Progress` });
      onChanged();
    });
  }

  async function complete() {
    await run("complete", async () => {
      const { error } = await supabase.rpc("wo_complete", {
        p_id: workOrder.id,
        p_solution: solution,
        p_expected_status: workOrder.status,
      });
      if (error) return handleError(error);
      setCompleteOpen(false);
      setSolution("");
      toast({
        tone: "success",
        title: `${workOrder.code} marked Done`,
        body: "Waiting on the Captain to attest it.",
      });
      onChanged();
    });
  }

  async function attest() {
    await run("attest", async () => {
      const { error } = await supabase.rpc("wo_attest", {
        p_id: workOrder.id,
        p_expected_status: workOrder.status,
        p_expected_attested: attested,
      });
      if (error) return handleError(error);
      toast({
        tone: "success",
        title: `${workOrder.code} attested`,
        body: "The work order is closed.",
      });
      onChanged();
    });
  }

  async function reject() {
    await run("reject", async () => {
      const { error } = await supabase.rpc("wo_reject", {
        p_id: workOrder.id,
        p_reason: reason,
        p_expected_status: workOrder.status,
        p_expected_attested: attested,
      });
      if (error) return handleError(error);
      setRejectOpen(false);
      setReason("");
      toast({
        tone: "info",
        title: `${workOrder.code} sent back`,
        body: "It is In Progress again, with your reason on the record.",
      });
      onChanged();
    });
  }

  async function openReassign() {
    setReassignOpen(true);
    try {
      setCrew(await fetchAssignableCrew(workOrder.vessel_id));
    } catch (caught) {
      handleError(caught);
    }
  }

  async function reassign() {
    if (!newCrewId) return;
    await run("reassign", async () => {
      const { error } = await supabase.rpc("wo_reassign", {
        p_id: workOrder.id,
        p_new_crew_id: newCrewId,
        p_expected_status: workOrder.status,
      });
      if (error) return handleError(error);
      setReassignOpen(false);
      setNewCrewId(null);
      toast({ tone: "success", title: `${workOrder.code} reassigned` });
      onChanged();
    });
  }

  if (!canStart && !canComplete && !canReview && !canReassign) {
    return (
      <span className="text-xs text-muted">
        {attested ? "Closed" : "No action for you"}
      </span>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {canStart ? (
        <Button size={size} loading={isPending("start")} onClick={() => void start()}>
          <PlayCircle /> Pick up
        </Button>
      ) : null}

      {canComplete ? (
        <Button
          size={size}
          variant="success"
          onClick={() => {
            setSolution(workOrder.solution ?? "");
            setCompleteOpen(true);
          }}
        >
          <CheckCheck /> Complete
        </Button>
      ) : null}

      {canReview ? (
        <>
          <Button
            size={size}
            variant="success"
            loading={isPending("attest")}
            onClick={() => void attest()}
          >
            <ShieldCheck /> Attest
          </Button>
          <Button size={size} variant="danger" onClick={() => setRejectOpen(true)}>
            <Undo2 /> Reject
          </Button>
        </>
      ) : null}

      {canReassign ? (
        <Button size={size} variant="secondary" onClick={() => void openReassign()}>
          <Repeat2 /> Reassign
        </Button>
      ) : null}

      <Dialog open={completeOpen} onOpenChange={setCompleteOpen}>
        <DialogContent
          title={`Complete ${workOrder.code}`}
          description="Document what you did. The Captain reviews this before attesting."
        >
          <Field label="Solution" required htmlFor="solution">
            <Textarea
              id="solution"
              value={solution}
              onChange={(event) => setSolution(event.target.value)}
              placeholder="Parts replaced, tests run, anything the next watch should know…"
              rows={6}
            />
          </Field>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setCompleteOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="success"
              loading={isPending("complete")}
              disabled={solution.trim().length === 0}
              onClick={() => void complete()}
            >
              Mark Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent
          title={`Reject ${workOrder.code}`}
          description="This returns the work order to In Progress. The reason is kept on the record permanently."
        >
          <Field label="Reason for rejection" required htmlFor="reason">
            <Textarea
              id="reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="What still needs doing?"
              rows={5}
            />
          </Field>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setRejectOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={isPending("reject")}
              disabled={reason.trim().length === 0}
              onClick={() => void reject()}
            >
              Send back
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={reassignOpen} onOpenChange={setReassignOpen}>
        <DialogContent
          title={`Reassign ${workOrder.code}`}
          description="Hand this work order to another active crew member on the same vessel."
        >
          <Field label="New assignee" required>
            <Select
              value={newCrewId}
              onValueChange={setNewCrewId}
              options={crew
                .filter((member) => member.id !== workOrder.assigned_crew_id)
                .map((member) => ({ value: member.id, label: member.name }))}
              placeholder="Select crew"
            />
          </Field>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setReassignOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={isPending("reassign")}
              disabled={!newCrewId}
              onClick={() => void reassign()}
            >
              Reassign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
