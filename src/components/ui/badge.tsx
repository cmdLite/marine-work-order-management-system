import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import type { UserRole, WorkOrderStatus } from "@/lib/database.types";
import { ROLE_LABEL, STATUS_LABEL } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
  {
    variants: {
      tone: {
        neutral: "border-slate-200 bg-slate-50 text-slate-700",
        info: "border-sky-200 bg-sky-50 text-sky-800",
        warn: "border-amber-200 bg-amber-50 text-amber-800",
        success: "border-emerald-200 bg-emerald-50 text-emerald-800",
        danger: "border-rose-200 bg-rose-50 text-rose-800",
        hull: "border-hull-200 bg-hull-50 text-hull-800",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

const STATUS_TONE: Record<WorkOrderStatus, BadgeProps["tone"]> = {
  open: "info",
  in_progress: "warn",
  done: "success",
};

export function StatusBadge({
  status,
  attested,
}: {
  status: WorkOrderStatus;
  attested?: boolean;
}) {
  if (status === "done" && attested) {
    return <Badge tone="success">Done · Attested</Badge>;
  }
  if (status === "done") {
    return <Badge tone="warn">Done · Awaiting attestation</Badge>;
  }
  return <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>;
}

const ROLE_TONE: Record<UserRole, BadgeProps["tone"]> = {
  admin: "danger",
  captain: "hull",
  crew: "info",
};

export function RoleBadge({ role }: { role: UserRole }) {
  return <Badge tone={ROLE_TONE[role]}>{ROLE_LABEL[role]}</Badge>;
}

export function ActiveBadge({ active }: { active: boolean }) {
  return (
    <Badge tone={active ? "success" : "neutral"}>
      {active ? "Active" : "Inactive"}
    </Badge>
  );
}
