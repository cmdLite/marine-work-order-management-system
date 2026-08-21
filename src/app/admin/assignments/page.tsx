import { PageHeader, RequireAdmin } from "@/components/guards";
import { AssignmentsManager } from "@/components/admin/assignments-manager";

export const metadata = { title: "Assignments · Marine Ops" };

export default function AdminAssignmentsPage() {
  return (
    <>
      <PageHeader
        title="Vessel assignments"
        description="Who serves on which ship. Assignment is what gives Captains and Crew sight of a vessel's work orders at all."
      />
      <RequireAdmin>
        <AssignmentsManager />
      </RequireAdmin>
    </>
  );
}
