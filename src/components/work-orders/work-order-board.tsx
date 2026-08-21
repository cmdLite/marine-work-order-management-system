"use client";

import * as React from "react";
import Link from "next/link";
import { ClipboardList, RefreshCw, Search } from "lucide-react";
import { useSession } from "@/lib/session";
import { useList, useQuery, useRealtimeRefresh } from "@/lib/hooks";
import { fetchWorkOrders, type WorkOrderFilters } from "@/lib/queries";
import type { WorkOrderStatus } from "@/lib/database.types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/badge";
import {
  EmptyState,
  ErrorState,
  SkeletonRows,
} from "@/components/ui/data-state";
import { Table, TableWrapper, Td, Th, Tr } from "@/components/ui/table";
import { WorkOrderActions } from "@/components/work-orders/work-order-actions";
import { CreateWorkOrderDialog } from "@/components/work-orders/create-work-order-dialog";
import { relativeTime } from "@/lib/utils";

const STATUS_OPTIONS = [
  { value: "all", label: "Any status" },
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In Progress" },
  { value: "done", label: "Done" },
];

const ATTESTATION_OPTIONS = [
  { value: "all", label: "Attested or not" },
  { value: "unattested", label: "Awaiting attestation" },
  { value: "attested", label: "Attested" },
];

export function WorkOrderBoard() {
  const { profile, activeVesselId, activeVessel } = useSession();

  const [status, setStatus] = React.useState<WorkOrderStatus | "all">("all");
  const [attestation, setAttestation] =
    React.useState<WorkOrderFilters["attestation"]>("all");
  const [mineOnly, setMineOnly] = React.useState(profile?.role === "crew");
  const [search, setSearch] = React.useState("");
  const [debounced, setDebounced] = React.useState("");

  React.useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(search), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const assignedTo = mineOnly ? (profile?.id ?? null) : null;

  const { data, loading, error, refresh } = useQuery(
    [activeVesselId, status, attestation, assignedTo, debounced],
    () =>
      fetchWorkOrders({
        vesselId: activeVesselId,
        status,
        attestation,
        assignedTo,
        search: debounced,
      }),
  );

  useRealtimeRefresh("work_orders", refresh);

  const workOrders = useList(data);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex flex-col gap-3 p-3 sm:p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="relative flex-1">
              <Search
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400"
                aria-hidden
              />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search by code, title or issue…"
                className="pl-9"
                aria-label="Search work orders"
              />
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-2 lg:w-96">
              <Select
                aria-label="Filter by status"
                value={status}
                onValueChange={(next) => setStatus(next as WorkOrderStatus | "all")}
                options={STATUS_OPTIONS}
              />
              <Select
                aria-label="Filter by attestation"
                value={attestation}
                onValueChange={(next) =>
                  setAttestation(next as WorkOrderFilters["attestation"])
                }
                options={ATTESTATION_OPTIONS}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-3 text-xs text-muted">
              <span>
                {activeVessel ? activeVessel.name : "All vessels"} ·{" "}
                {loading ? "…" : `${workOrders.length} work order${workOrders.length === 1 ? "" : "s"}`}
              </span>
              {profile?.role !== "admin" ? (
                <label className="flex cursor-pointer items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={mineOnly}
                    onChange={(event) => setMineOnly(event.target.checked)}
                    className="size-3.5 accent-hull-700"
                  />
                  Only mine
                </label>
              ) : null}
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={refresh}>
                <RefreshCw /> Refresh
              </Button>
              <CreateWorkOrderDialog onCreated={refresh} />
            </div>
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden">
        {loading && workOrders.length === 0 ? (
          <SkeletonRows rows={5} />
        ) : error ? (
          <ErrorState message={error} />
        ) : workOrders.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title="Nothing here"
            description={
              profile?.role === "captain"
                ? "Raise a work order to get the first job on the board."
                : "No work orders match these filters for the vessels you are assigned to."
            }
          />
        ) : (
          <>
            {/* Table for tablet and desktop */}
            <TableWrapper className="hidden md:block">
              <Table>
                <thead>
                  <tr>
                    <Th className="w-28">Code</Th>
                    <Th>Work order</Th>
                    <Th className="w-40">Vessel</Th>
                    <Th className="w-40">Assignee</Th>
                    <Th className="w-48">Status</Th>
                    <Th className="w-64 text-right">Actions</Th>
                  </tr>
                </thead>
                <tbody>
                  {workOrders.map((workOrder) => (
                    <Tr key={workOrder.id}>
                      <Td className="font-mono text-xs text-muted">
                        <Link
                          href={`/work-orders/${workOrder.id}`}
                          className="hover:text-hull-800 hover:underline"
                        >
                          {workOrder.code}
                        </Link>
                      </Td>
                      <Td>
                        <Link
                          href={`/work-orders/${workOrder.id}`}
                          className="font-medium text-hull-900 hover:underline"
                        >
                          {workOrder.title}
                        </Link>
                        <p className="mt-0.5 line-clamp-1 text-xs text-muted">
                          {workOrder.issue}
                        </p>
                      </Td>
                      <Td className="text-sm">{workOrder.vessel_name}</Td>
                      <Td className="text-sm">{workOrder.assigned_crew_name}</Td>
                      <Td>
                        <StatusBadge
                          status={workOrder.status}
                          attested={workOrder.attested_at !== null}
                        />
                        <p className="mt-1 text-[11px] text-muted">
                          updated {relativeTime(workOrder.updated_at)}
                        </p>
                      </Td>
                      <Td>
                        <div className="flex justify-end">
                          <WorkOrderActions
                            workOrder={workOrder}
                            onChanged={refresh}
                          />
                        </div>
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </TableWrapper>

            {/* Cards for phones */}
            <ul className="divide-y divide-slate-100 md:hidden">
              {workOrders.map((workOrder) => (
                <li key={workOrder.id} className="flex flex-col gap-2 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link
                        href={`/work-orders/${workOrder.id}`}
                        className="font-medium text-hull-900 hover:underline"
                      >
                        {workOrder.title}
                      </Link>
                      <p className="font-mono text-[11px] text-muted">
                        {workOrder.code} · {workOrder.vessel_name}
                      </p>
                    </div>
                    <StatusBadge
                      status={workOrder.status}
                      attested={workOrder.attested_at !== null}
                    />
                  </div>
                  <p className="line-clamp-2 text-sm text-muted">{workOrder.issue}</p>
                  <p className="text-xs text-muted">
                    Assigned to {workOrder.assigned_crew_name} · updated{" "}
                    {relativeTime(workOrder.updated_at)}
                  </p>
                  <WorkOrderActions workOrder={workOrder} onChanged={refresh} />
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
    </div>
  );
}
