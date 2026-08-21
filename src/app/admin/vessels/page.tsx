import { PageHeader, RequireAdmin } from "@/components/guards";
import { VesselsManager } from "@/components/admin/vessels-manager";

export const metadata = { title: "Vessels · Marine Ops" };

export default function AdminVesselsPage() {
  return (
    <>
      <PageHeader
        title="Vessels"
        description="The fleet. A vessel cannot be deactivated while it still carries work that has not been attested."
      />
      <RequireAdmin>
        <VesselsManager />
      </RequireAdmin>
    </>
  );
}
