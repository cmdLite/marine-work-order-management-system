"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Prev/next pager for the admin lists.
 *
 * Renders nothing when everything already fits on one page, so small fleets
 * never see controls they have no use for.
 */
export function Pagination({
  page,
  pageSize,
  total,
  loading,
  onPageChange,
  className,
  noun = "row",
}: {
  page: number;
  pageSize: number;
  total: number;
  loading?: boolean;
  onPageChange: (page: number) => void;
  className?: string;
  /** Singular noun for the summary line, e.g. "vessel". */
  noun?: string;
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;

  const first = page * pageSize + 1;
  const last = Math.min(total, (page + 1) * pageSize);

  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 p-3",
        className,
      )}
    >
      <span className="text-xs text-muted">
        Showing {first}–{last} of {total} {noun}
        {total === 1 ? "" : "s"}
      </span>
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted">
          Page {page + 1} of {pageCount}
        </span>
        <Button
          size="sm"
          variant="secondary"
          disabled={page === 0 || loading}
          onClick={() => onPageChange(Math.max(0, page - 1))}
        >
          Previous
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={page + 1 >= pageCount || loading}
          onClick={() => onPageChange(page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
