"use client";

import * as React from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SelectOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

interface SelectProps {
  value: string | null;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
  "aria-label"?: string;
}

/**
 * Thin wrapper over Radix Select. Radix is used rather than a native `<select>`
 * so option rows can carry a secondary line (role, vessel) and so the control
 * looks and behaves the same on every platform.
 */
export function Select({
  value,
  onValueChange,
  options,
  placeholder = "Select…",
  disabled,
  id,
  className,
  ...rest
}: SelectProps) {
  return (
    <SelectPrimitive.Root
      value={value ?? undefined}
      onValueChange={onValueChange}
      disabled={disabled || options.length === 0}
    >
      <SelectPrimitive.Trigger
        id={id}
        aria-label={rest["aria-label"]}
        className={cn(
          "flex h-9 w-full items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm text-hull-900 shadow-sm transition-colors hover:border-slate-300 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400 data-placeholder:text-slate-400",
          className,
        )}
      >
        <SelectPrimitive.Value placeholder={placeholder} />
        <SelectPrimitive.Icon>
          <ChevronDown className="size-4 shrink-0 text-slate-400" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>

      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={6}
          className="animate-in-pop z-50 max-h-72 min-w-(--radix-select-trigger-width) overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg"
        >
          <SelectPrimitive.Viewport className="scrollbar-thin p-1">
            {options.map((option) => (
              <SelectPrimitive.Item
                key={option.value}
                value={option.value}
                disabled={option.disabled}
                className="relative flex cursor-pointer select-none flex-col rounded-md py-1.5 pr-8 pl-3 text-sm text-hull-900 outline-none data-disabled:pointer-events-none data-disabled:opacity-50 data-highlighted:bg-hull-50"
              >
                <SelectPrimitive.ItemText>
                  {option.label}
                </SelectPrimitive.ItemText>
                {option.description ? (
                  <span className="text-xs text-muted">
                    {option.description}
                  </span>
                ) : null}
                <SelectPrimitive.ItemIndicator className="absolute top-2 right-2">
                  <Check className="size-4 text-hull-600" />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
