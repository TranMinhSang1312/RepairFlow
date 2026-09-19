import { Suspense } from "react";

import { RepairOrderBoard } from "@/components/repair-orders/repair-order-board";

function BoardFallback() {
  return (
    <main className="board-shell centered-state" aria-busy="true">
      <span className="spinner" aria-hidden="true" />
      <h1>Đang mở bảng sửa chữa</h1>
    </main>
  );
}

export default function RepairOrdersPage() {
  return (
    <Suspense fallback={<BoardFallback />}>
      <RepairOrderBoard />
    </Suspense>
  );
}
