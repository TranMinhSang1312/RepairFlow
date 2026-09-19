import { Suspense } from "react";

import { RepairOrderWorkspace } from "@/components/repair-orders/repair-order-workspace";

interface RepairOrderPageProps {
  params: Promise<{ repairOrderId: string }>;
}

export default async function RepairOrderPage({ params }: RepairOrderPageProps) {
  const { repairOrderId } = await params;
  return (
    <Suspense
      fallback={
        <main className="workspace-shell centered-state" aria-busy="true">
          <span className="spinner" aria-hidden="true" />
          <h1>Đang mở workspace</h1>
        </main>
      }
    >
      <RepairOrderWorkspace repairOrderId={repairOrderId} />
    </Suspense>
  );
}
