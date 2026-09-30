"use client";

import { useSearchParams } from "next/navigation";

import { AuditLogSettings } from "@/components/settings/audit-log-settings";
import { useAuth } from "@/lib/auth/auth-provider";

export default function AuditSettingsPage() {
  const auth = useAuth();
  const params = useSearchParams();
  if (!auth.user) return null;
  const membership =
    auth.user.memberships.find(
      (item) =>
        item.status === "ACTIVE" && item.role === "OWNER" && item.shopId === params.get("shopId"),
    ) ?? auth.user.memberships.find((item) => item.status === "ACTIVE" && item.role === "OWNER");
  if (!membership)
    return (
      <AuditLogSettings api={auth.api} user={auth.user} shopId="" timezone="Asia/Ho_Chi_Minh" />
    );
  return (
    <AuditLogSettings
      api={auth.api}
      user={auth.user}
      shopId={membership.shopId}
      timezone={membership.timezone}
    />
  );
}
