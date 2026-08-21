import type { Metadata, Viewport } from "next";
import "./globals.css";
import { SessionProvider } from "@/lib/session";
import { ToastProvider } from "@/components/ui/toast";
import { IdentityBar } from "@/components/identity-bar";
import { AppNav } from "@/components/app-nav";

export const metadata: Metadata = {
  title: "Marine Ops — Work Order Management",
  description:
    "Vessel-scoped work orders, crew management and role-based operations for a small fleet.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#2d4a6a",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-dvh">
        <ToastProvider>
          <SessionProvider>
            <a
              href="#main"
              className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-hull-800 focus:px-3 focus:py-2 focus:text-sm focus:text-white"
            >
              Skip to content
            </a>
            <IdentityBar />
            <AppNav />
            <main id="main" className="mx-auto max-w-7xl px-3 py-5 sm:px-5 sm:py-7">
              {children}
            </main>
            <footer className="mx-auto max-w-7xl px-3 pb-8 text-xs text-muted sm:px-5">
              Authorization is enforced by PostgreSQL Row Level Security — the
              interface only mirrors it.
            </footer>
          </SessionProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
