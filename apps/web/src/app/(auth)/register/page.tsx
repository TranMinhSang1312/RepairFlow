import type { Metadata } from "next";

import { RegisterOwnerForm } from "@/components/auth/auth-forms";

export const metadata: Metadata = { title: "Tạo cửa hàng · RepairFlow" };

export default function RegisterPage() {
  return <RegisterOwnerForm />;
}
