"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export type DialogSize = "sm" | "md" | "lg";

const DIALOG_SIZE_WIDTH: Record<DialogSize, string> = {
  sm: "sm:w-[min(24rem,calc(100vw-2rem))]",
  md: "sm:w-[min(34rem,calc(100vw-2rem))]",
  lg: "sm:w-[min(46rem,calc(100vw-2rem))]",
};

export function DialogContent({
  className,
  children,
  title,
  description,
  size = "md",
}: {
  className?: string;
  children: React.ReactNode;
  title: string;
  description?: string;
  size?: DialogSize;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="animate-in-fade fixed inset-0 z-40 bg-hull-950/40 backdrop-blur-[2px]" />
      <DialogPrimitive.Content
        className={cn(
          "animate-in-pop fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col rounded-t-2xl border border-slate-200 bg-white shadow-xl",
          "sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl",
          DIALOG_SIZE_WIDTH[size],
          className,
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
          <div className="flex flex-col gap-1">
            <DialogPrimitive.Title className="text-base font-semibold text-hull-900">
              {title}
            </DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="text-sm text-muted">
                {description}
              </DialogPrimitive.Description>
            ) : (
              <DialogPrimitive.Description className="sr-only">
                {title}
              </DialogPrimitive.Description>
            )}
          </div>
          <DialogPrimitive.Close
            aria-label="Close"
            className="rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="size-4" />
          </DialogPrimitive.Close>
        </div>
        <div className="scrollbar-thin overflow-y-auto px-5 py-4">{children}</div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className,
      )}
      {...props}
    />
  );
}
