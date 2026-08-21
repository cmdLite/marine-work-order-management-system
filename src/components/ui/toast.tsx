"use client";

import * as React from "react";
import { AlertTriangle, CheckCircle2, Info, RefreshCw, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type ToastTone = "success" | "error" | "info" | "conflict";

export interface ToastMessage {
  id: number;
  tone: ToastTone;
  title: string;
  body?: string;
}

interface ToastContextValue {
  toast: (message: Omit<ToastMessage, "id">) => void;
}

const ToastContext = React.createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const context = React.useContext(ToastContext);
  if (!context) throw new Error("useToast must be used inside <ToastProvider>");
  return context;
}

const ICONS: Record<ToastTone, React.ElementType> = {
  success: CheckCircle2,
  error: AlertTriangle,
  info: Info,
  conflict: RefreshCw,
};

const TONES: Record<ToastTone, string> = {
  success: "border-emerald-200 bg-emerald-50 text-emerald-900",
  error: "border-rose-200 bg-rose-50 text-rose-900",
  info: "border-sky-200 bg-sky-50 text-sky-900",
  conflict: "border-amber-200 bg-amber-50 text-amber-900",
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [messages, setMessages] = React.useState<ToastMessage[]>([]);
  const counter = React.useRef(0);

  const dismiss = React.useCallback((id: number) => {
    setMessages((current) => current.filter((message) => message.id !== id));
  }, []);

  const toast = React.useCallback(
    (message: Omit<ToastMessage, "id">) => {
      const id = ++counter.current;
      setMessages((current) => [...current.slice(-3), { ...message, id }]);
      window.setTimeout(() => dismiss(id), message.tone === "error" ? 7000 : 5000);
    },
    [dismiss],
  );

  const value = React.useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-3 bottom-3 z-[60] flex flex-col gap-2 sm:inset-x-auto sm:right-4 sm:bottom-4 sm:w-96"
      >
        {messages.map((message) => {
          const Icon = ICONS[message.tone];
          return (
            <div
              key={message.id}
              role="status"
              className={cn(
                "animate-in-pop pointer-events-auto flex items-start gap-3 rounded-xl border p-3 shadow-lg",
                TONES[message.tone],
              )}
            >
              <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{message.title}</p>
                {message.body ? (
                  <p className="mt-0.5 text-xs opacity-90">{message.body}</p>
                ) : null}
              </div>
              <button
                type="button"
                aria-label="Dismiss"
                onClick={() => dismiss(message.id)}
                className="rounded p-0.5 opacity-60 transition-opacity hover:opacity-100"
              >
                <X className="size-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
