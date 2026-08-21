"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ClipboardList,
  LayoutDashboard,
  Link2,
  Ship,
  Users,
} from "lucide-react";
import { useSession } from "@/lib/session";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  icon: React.ElementType;
  adminOnly?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/work-orders", label: "Work Orders", icon: ClipboardList },
  { href: "/admin/users", label: "Users", icon: Users, adminOnly: true },
  { href: "/admin/vessels", label: "Vessels", icon: Ship, adminOnly: true },
  { href: "/admin/assignments", label: "Assignments", icon: Link2, adminOnly: true },
];

export function AppNav() {
  const pathname = usePathname();
  const { profile, status } = useSession();

  if (status !== "signed-in" || !profile) return null;

  const items = NAV_ITEMS.filter(
    (item) => !item.adminOnly || profile.role === "admin",
  );

  return (
    <nav
      aria-label="Primary"
      className="border-b border-slate-200 bg-white/70 backdrop-blur"
    >
      <ul className="scrollbar-thin mx-auto flex max-w-7xl gap-1 overflow-x-auto px-2 sm:px-4">
        {items.map((item) => {
          const active =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap transition-colors",
                  active
                    ? "border-hull-700 text-hull-900"
                    : "border-transparent text-slate-500 hover:border-slate-300 hover:text-hull-800",
                )}
              >
                <Icon className="size-4" aria-hidden />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
