import { PageHeader, RequireSession } from "@/components/guards";
import { WorkOrderBoard } from "@/components/work-orders/work-order-board";

export const metadata = { title: "Work Orders · Marine Ops" };

export default function WorkOrdersPage() {
  return (
    <>
      <PageHeader
        title="Work orders"
        description="Open → In Progress → Done, then attested by the Captain. You only ever see the vessels you are assigned to."
      />
      <RequireSession>
        <WorkOrderBoard />
      </RequireSession>
    </>
  );
}
