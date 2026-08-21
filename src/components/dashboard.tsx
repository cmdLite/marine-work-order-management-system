"use client";

import * as React from "react";
import Link from "next/link";
import {
  ClipboardCheck,
  ClipboardList,
  Hourglass,
  PlayCircle,
  Ship,
  Users,
} from "lucide-react";
import { useSession } from "@/lib/session";
import { useList, useQuery, useRealtimeRefresh } from "@/lib/hooks";
import { fetchProfiles, fetchVessels, fetchWorkOrders } from "@/lib/queries";
import type { WorkOrderExpandedRow } from "@/lib/database.types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badge";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/data-state";
import { WorkOrderActions } from "@/components/work-orders/work-order-actions";
import { CreateWorkOrderDialog } from "@/components/work-orders/create-work-order-dialog";
import { cn, relativeTime } from "@/lib/utils";

export function Dashboard() {
  const { profile, activeVesselId, activeVessel, vessels } = useSession();

  const workOrdersQuery = useQuery([activeVesselId], () =>
    fetchWorkOrders({ vesselId: activeVesselId, status: "all", attestation: "all" }),
  );
  useRealtimeRefresh("work_orders", workOrdersQuery.refresh);

  const isAdmin = profile?.role === "admin";
  const fleetQuery = useQuery([isAdmin], () => fetchVessels(true), {
    enabled: isAdmin,
  });
  const peopleQuery = useQuery([isAdmin], () => fetchProfiles({ includeInactive: true }), {
    enabled: isAdmin,
  });

  const workOrders = useList(workOrdersQuery.data);

  const counts = React.useMemo(() => {
    const open = workOrders.filter((row) => row.status === "open").length;
    const inProgress = workOrders.filter((row) => row.status === "in_progress").length;
    const awaiting = workOrders.filter(
      (row) => row.status === "done" && row.attested_at === null,
    ).length;
    const attested = workOrders.filter((row) => row.attested_at !== null).length;
    return { open, inProgress, awaiting, attested };
  }, [workOrders]);

  const myQueue = React.useMemo(() => {
    if (!profile) return [];
    if (profile.role === "crew") {
      return workOrders.filter(
        (row) => row.assigned_crew_id === profile.id && row.attested_at === null,
      );
    }
    if (profile.role === "captain") {
      return workOrders.filter(
        (row) => row.status === "done" && row.attested_at === null,
      );
    }
    return workOrders.filter((row) => row.attested_at === null);
  }, [workOrders, profile]);

  const queueTitle =
    profile?.role === "crew"
      ? "Your open jobs"
      : profile?.role === "captain"
        ? "Waiting on your attestation"
        : "Everything still in flight";

  return (
    <div className="flex flex-col gap-5">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Open"
          value={counts.open}
          icon={ClipboardList}
          tone="bg-sky-50 text-sky-700"
          loading={workOrdersQuery.loading}
        />
        <StatTile
          label="In progress"
          value={counts.inProgress}
          icon={PlayCircle}
          tone="bg-amber-50 text-amber-700"
          loading={workOrdersQuery.loading}
        />
        <StatTile
          label="Awaiting attestation"
          value={counts.awaiting}
          icon={Hourglass}
          tone="bg-violet-50 text-violet-700"
          loading={workOrdersQuery.loading}
        />
        <StatTile
          label="Attested"
          value={counts.attested}
          icon={ClipboardCheck}
          tone="bg-emerald-50 text-emerald-700"
          loading={workOrdersQuery.loading}
        />
      </section>

      {isAdmin ? (
        <section className="grid gap-3 sm:grid-cols-2">
          <StatTile
            label="Vessels"
            value={fleetQuery.data?.filter((vessel) => vessel.active).length ?? 0}
            secondary={`${fleetQuery.data?.filter((vessel) => !vessel.active).length ?? 0} inactive`}
            icon={Ship}
            tone="bg-hull-50 text-hull-700"
            loading={fleetQuery.loading}
            href="/admin/vessels"
          />
          <StatTile
            label="People"
            value={peopleQuery.data?.filter((person) => person.active).length ?? 0}
            secondary={`${peopleQuery.data?.filter((person) => !person.active).length ?? 0} deactivated`}
            icon={Users}
            tone="bg-rose-50 text-rose-700"
            loading={peopleQuery.loading}
            href="/admin/users"
          />
        </section>
      ) : null}

      <Card>
        <CardHeader className="sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>{queueTitle}</CardTitle>
            <p className="mt-0.5 text-xs text-muted">
              {activeVessel
                ? activeVessel.name
                : isAdmin
                  ? `All ${vessels.length} vessels`
                  : "All your vessels"}
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" asChild>
              <Link href="/work-orders">Open the board</Link>
            </Button>
            <CreateWorkOrderDialog onCreated={workOrdersQuery.refresh} />
          </div>
        </CardHeader>

        {workOrdersQuery.loading && workOrders.length === 0 ? (
          <SkeletonRows rows={3} />
        ) : workOrdersQuery.error ? (
          <ErrorState message={workOrdersQuery.error} />
        ) : myQueue.length === 0 ? (
          <EmptyState
            title="All clear"
            description="Nothing needs your attention on this scope right now."
          />
        ) : (
          <ul className="divide-y divide-slate-100">
            {myQueue.slice(0, 8).map((workOrder) => (
              <QueueRow
                key={workOrder.id}
                workOrder={workOrder}
                onChanged={workOrdersQuery.refresh}
              />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function QueueRow({
  workOrder,
  onChanged,
}: {
  workOrder: WorkOrderExpandedRow;
  onChanged: () => void;
}) {
  return (
    <li className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
      <div className="min-w-0">
        <Link
          href={`/work-orders/${workOrder.id}`}
          className="font-medium text-hull-900 hover:underline"
        >
          {workOrder.title}
        </Link>
        <p className="text-xs text-muted">
          <span className="font-mono">{workOrder.code}</span> ·{" "}
          {workOrder.vessel_name} · {workOrder.assigned_crew_name} · updated{" "}
          {relativeTime(workOrder.updated_at)}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
        <StatusBadge
          status={workOrder.status}
          attested={workOrder.attested_at !== null}
        />
        <WorkOrderActions workOrder={workOrder} onChanged={onChanged} />
      </div>
    </li>
  );
}

function StatTile({
  label,
  value,
  secondary,
  icon: Icon,
  tone,
  loading,
  href,
}: {
  label: string;
  value: number;
  secondary?: string;
  icon: React.ElementType;
  tone: string;
  loading?: boolean;
  href?: string;
}) {
  const body = (
    <Card
      className={cn(
        "h-full transition-shadow",
        href ? "hover:shadow-md" : undefined,
      )}
    >
      <CardContent className="flex items-center gap-3">
        <span className={cn("grid size-10 shrink-0 place-items-center rounded-lg", tone)}>
          <Icon className="size-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-medium tracking-wide text-muted uppercase">
            {label}
          </p>
          <p className="text-xl font-semibold text-hull-900 tabular-nums">
            {loading ? "—" : value}
          </p>
          {secondary ? <p className="text-[11px] text-muted">{secondary}</p> : null}
        </div>
      </CardContent>
    </Card>
  );

  return href ? (
    <Link href={href} className="block">
      {body}
    </Link>
  ) : (
    body
  );
}
