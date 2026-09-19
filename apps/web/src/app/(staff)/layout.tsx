import { Suspense, type ReactNode } from "react";

import { ProtectedStaffLayout } from "@/components/layout/staff-shell";

export default function StaffLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <main className="session-state" aria-busy="true">
          <span className="spinner" aria-hidden="true" />
          <h1>Đang mở khu vực nhân viên</h1>
        </main>
      }
    >
      <ProtectedStaffLayout>{children}</ProtectedStaffLayout>
    </Suspense>
  );
}
