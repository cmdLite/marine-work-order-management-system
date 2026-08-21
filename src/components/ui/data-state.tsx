import * as React from "react";
import { Inbox, Loader2, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";

export function Spinner({ className }: { className?: string }) {
  return (
    <Loader2
      className={cn("size-4 animate-spin text-hull-500", className)}
      aria-hidden
    />
  );
}

export function LoadingBlock({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted">
      <Spinner />
      {label}
    </div>
  );
}

export function SkeletonRows({ rows = 4 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2 p-4">
      {Array.from({ length: rows }).map((_, index) => (
        <div
          key={index}
          className="h-10 animate-pulse rounded-lg bg-slate-100"
          style={{ animationDelay: `${index * 60}ms` }}
        />
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  icon: Icon = Inbox,
  action,
}: {
  title: string;
  description?: string;
  icon?: React.ElementType;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <div className="rounded-full bg-slate-100 p-3">
        <Icon className="size-5 text-slate-500" aria-hidden />
      </div>
      <p className="text-sm font-medium text-hull-900">{title}</p>
      {description ? (
        <p className="max-w-sm text-sm text-muted">{description}</p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <div className="rounded-full bg-rose-50 p-3">
        <ShieldAlert className="size-5 text-rose-600" aria-hidden />
      </div>
      <p className="text-sm font-medium text-hull-900">Could not load this</p>
      <p className="max-w-sm text-sm text-muted">{message}</p>
    </div>
  );
}
