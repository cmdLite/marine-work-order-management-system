"use client";

import * as React from "react";
import { Compass, ShieldAlert } from "lucide-react";
import { useSession } from "@/lib/session";
import { Card } from "@/components/ui/card";
import { EmptyState, LoadingBlock } from "@/components/ui/data-state";

/** Renders children only once a member has been selected in the Identity Bar. */
export function RequireSession({ children }: { children: React.ReactNode }) {
  const { status } = useSession();

  if (status === "loading") {
    return (
      <Card>
        <LoadingBlock label="Restoring your session…" />
      </Card>
    );
  }

  if (status === "anonymous") {
    return (
      <Card>
        <EmptyState
          icon={Compass}
          title="Choose who you are"
          description="Use the three dropdowns above — vessel, then role, then member. Selecting a member signs you in as that person, with their exact permissions and data."
        />
      </Card>
    );
  }

  return <>{children}</>;
}

/** Admin-only screens. The database refuses admin actions regardless of this. */
export function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { profile } = useSession();

  return (
    <RequireSession>
      {profile?.role === "admin" ? (
        children
      ) : (
        <Card>
          <EmptyState
            icon={ShieldAlert}
            title="Admins only"
            description="This section manages users, vessels and assignments. Switch to an Admin in the Identity Bar to open it."
          />
        </Card>
      )}
    </RequireSession>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-xl font-semibold text-hull-900 sm:text-2xl">{title}</h1>
        {description ? (
          <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}
