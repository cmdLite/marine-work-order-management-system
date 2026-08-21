import { RequireSession } from "@/components/guards";
import { WorkOrderDetail } from "@/components/work-orders/work-order-detail";

export const metadata = { title: "Work Order · Marine Ops" };

export default async function WorkOrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <RequireSession>
      <WorkOrderDetail workOrderId={id} />
    </RequireSession>
  );
}
