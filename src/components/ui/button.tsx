"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary:
          "bg-hull-700 text-white hover:bg-hull-800 active:bg-hull-900 shadow-sm",
        secondary:
          "bg-white text-hull-800 border border-slate-200 hover:bg-slate-50 active:bg-slate-100 shadow-sm",
        ghost: "text-hull-700 hover:bg-hull-50 active:bg-hull-100",
        danger:
          "bg-rose-600 text-white hover:bg-rose-700 active:bg-rose-800 shadow-sm",
        success:
          "bg-emerald-600 text-white hover:bg-emerald-700 active:bg-emerald-800 shadow-sm",
        signal:
          "bg-signal-600 text-white hover:bg-signal-700 active:bg-signal-800 shadow-sm",
      },
      size: {
        sm: "h-8 px-3 text-xs",
        md: "h-9 px-4",
        lg: "h-11 px-5 text-base",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    { className, variant, size, asChild, loading, children, disabled, ...props },
    ref,
  ) {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        disabled={disabled || loading}
        {...props}
      >
        {asChild ? (
          children
        ) : (
          <>
            {loading ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {children}
          </>
        )}
      </Comp>
    );
  },
);

export { buttonVariants };
