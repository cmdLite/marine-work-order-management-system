"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowLeft,
  CircleDot,
  FileText,
  History,
  RefreshCw,
  ShieldCheck,
  Undo2,
  UserRoundCog,
} from "lucide-react";
import { useQuery, useRealtimeRefresh } from "@/lib/hooks";
import { fetchProfileNames, fetchWorkOrder, fetchWorkOrderEvents } from "@/lib/queries";
import type { WorkOrderEventRow, WorkOrderEventType } from "@/lib/database.types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badge";
import { EmptyState, ErrorState, LoadingBlock } from "@/components/ui/data-state";
import { WorkOrderActions } from "@/components/work-orders/work-order-actions";
import { formatDateTime, relativeTime } from "@/lib/utils";

const EVENT_ICON: Record<WorkOrderEventType, React.ElementType> = {
  created: FileText,
  assigned: UserRoundCog,
  status_change: CircleDot,
  attested: ShieldCheck,
  rejected: Undo2,
};

const EVENT_LABEL: Record<WorkOrderEventType, string> = {
  created: "Raised",
  assigned: "Assigned",
  status_change: "Status changed",
  attested: "Attested",
  rejected: "Rejected",
};

const EVENT_TONE: Record<WorkOrderEventType, string> = {
  created: "bg-slate-100 text-slate-600",
  assigned: "bg-sky-100 text-sky-700",
  status_change: "bg-hull-100 text-hull-700",
  attested: "bg-emerald-100 text-emerald-700",
  rejected: "bg-rose-100 text-rose-700",
};

export function WorkOrderDetail({ workOrderId }: { workOrderId: string }) {
  const workOrderQuery = useQuery([workOrderId], () => fetchWorkOrder(workOrderId));
  const eventsQuery = useQuery([workOrderId], () => fetchWorkOrderEvents(workOrderId));
  const namesQuery = useQuery([], () => fetchProfileNames());

  const refreshAll = React.useCallback(() => {
    workOrderQuery.refresh();
    eventsQuery.refresh();
  }, [workOrderQuery, eventsQuery]);

  useRealtimeRefresh("work_orders", refreshAll);

  if (workOrderQuery.loading && !workOrderQuery.data) {
    return (
      <Card>
        <LoadingBlock />
      </Card>
    );
  }

  if (workOrderQuery.error) {
    return (
      <Card>
        <ErrorState message={workOrderQuery.error} />
      </Card>
    );
  }

  const workOrder = workOrderQuery.data;

  if (!workOrder) {
    return (
      <Card>
        <EmptyState
          title="Not visible to you"
          description="Either this work order does not exist, or it belongs to a vessel you are not assigned to. Row Level Security hides it either way."
          action={
            <Button variant="secondary" asChild>
              <Link href="/work-orders">Back to work orders</Link>
            </Button>
          }
        />
      </Card>
    );
  }

  const events = eventsQuery.data ?? [];
  const names = namesQuery.data ?? new Map<string, string>();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/work-orders"
          className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-hull-800"
        >
          <ArrowLeft className="size-4" aria-hidden />
          All work orders
        </Link>
        <Button variant="secondary" size="sm" onClick={refreshAll}>
          <RefreshCw /> Refresh
        </Button>
      </div>

      <Card>
        <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="font-mono text-xs text-muted">{workOrder.code}</p>
            <CardTitle className="mt-0.5 text-lg sm:text-xl">
              {workOrder.title}
            </CardTitle>
            <p className="mt-1 text-sm text-muted">
              {workOrder.vessel_name} · raised by {workOrder.created_by_name} ·{" "}
              {relativeTime(workOrder.created_at)}
            </p>
          </div>
          <StatusBadge
            status={workOrder.status}
            attested={workOrder.attested_at !== null}
          />
        </CardHeader>

        <CardContent className="flex flex-col gap-5">
          <dl className="grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs font-semibold tracking-wide text-muted uppercase">
                Issue
              </dt>
              <dd className="mt-1 text-sm whitespace-pre-wrap text-hull-900">
                {workOrder.issue}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold tracking-wide text-muted uppercase">
                Solution
              </dt>
              <dd className="mt-1 text-sm whitespace-pre-wrap text-hull-900">
                {workOrder.solution ?? (
                  <span className="text-muted">Not documented yet.</span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold tracking-wide text-muted uppercase">
                Assigned crew
              </dt>
              <dd className="mt-1 text-sm text-hull-900">
                {workOrder.assigned_crew_name}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold tracking-wide text-muted uppercase">
                Attestation
              </dt>
              <dd className="mt-1 text-sm text-hull-900">
                {workOrder.attested_at ? (
                  <>
                    Attested by {workOrder.attested_by_name} on{" "}
                    {formatDateTime(workOrder.attested_at)}
                  </>
                ) : (
                  <span className="text-muted">Not attested.</span>
                )}
              </dd>
            </div>
          </dl>

          <div className="border-t border-slate-100 pt-4">
            <WorkOrderActions
              workOrder={workOrder}
              onChanged={refreshAll}
              size="md"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="size-4" aria-hidden />
            History
          </CardTitle>
        </CardHeader>
        <CardContent>
          {eventsQuery.loading && events.length === 0 ? (
            <LoadingBlock label="Loading history…" />
          ) : events.length === 0 ? (
            <p className="text-sm text-muted">No events recorded.</p>
          ) : (
            <ol className="relative flex flex-col gap-4 border-l border-slate-200 pl-6">
              {events.map((event) => (
                <TimelineEntry
                  key={event.id}
                  event={event}
                  actorName={
                    event.actor_id ? (names.get(event.actor_id) ?? "Unknown") : "System"
                  }
                />
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function TimelineEntry({
  event,
  actorName,
}: {
  event: WorkOrderEventRow;
  actorName: string;
}) {
  const Icon = EVENT_ICON[event.type];
  return (
    <li className="relative">
      <span
        className={`absolute top-0.5 -left-[2.05rem] grid size-6 place-items-center rounded-full ring-4 ring-white ${EVENT_TONE[event.type]}`}
        aria-hidden
      >
        <Icon className="size-3.5" />
      </span>
      <p className="text-sm font-medium text-hull-900">
        {EVENT_LABEL[event.type]}
        {event.from_status && event.to_status && event.from_status !== event.to_status ? (
          <span className="font-normal text-muted">
            {" "}
            · {event.from_status.replace("_", " ")} → {event.to_status.replace("_", " ")}
          </span>
        ) : null}
      </p>
      <p className="text-xs text-muted">
        {actorName} · {formatDateTime(event.created_at)}
      </p>
      {event.note ? (
        <p className="mt-1 rounded-lg bg-slate-50 px-3 py-2 text-sm whitespace-pre-wrap text-hull-900">
          {event.note}
        </p>
      ) : null}
    </li>
  );
}
