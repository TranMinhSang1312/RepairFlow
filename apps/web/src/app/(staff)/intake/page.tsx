import type { Metadata } from "next";

import { NewIntakeFlow } from "@/components/intake/new-intake-flow";

export const metadata: Metadata = {
  title: "Tiếp nhận thiết bị · RepairFlow",
  description: "Tạo khách hàng, thiết bị và phiếu tiếp nhận sửa chữa.",
};

export default function NewIntakePage() {
  return <NewIntakeFlow />;
}
