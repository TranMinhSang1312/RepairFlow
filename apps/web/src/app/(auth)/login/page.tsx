import type { Metadata } from "next";

import { LoginForm } from "@/components/auth/auth-forms";

export const metadata: Metadata = { title: "Đăng nhập · RepairFlow" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : undefined;
  return <LoginForm {...(next ? { next } : {})} />;
}
