import * as React from "react";
import { cn } from "@/lib/utils";

export function TableWrapper({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("scrollbar-thin w-full overflow-x-auto", className)}
      {...props}
    />
  );
}

export function Table({
  className,
  ...props
}: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <table
      className={cn("w-full min-w-[36rem] border-collapse text-sm", className)}
      {...props}
    />
  );
}

export function Th({
  className,
  ...props
}: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope="col"
      className={cn(
        "border-b border-slate-200 bg-slate-50/80 px-4 py-2.5 text-left text-xs font-semibold tracking-wide text-hull-700 uppercase",
        className,
      )}
      {...props}
    />
  );
}

export function Td({
  className,
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      className={cn("border-b border-slate-100 px-4 py-3 align-middle", className)}
      {...props}
    />
  );
}

export function Tr({
  className,
  ...props
}: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr className={cn("transition-colors hover:bg-slate-50/70", className)} {...props} />
  );
}
