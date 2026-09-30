"use client";

import { useAuth } from "@/lib/auth/auth-provider";
import { useSearchParams } from "next/navigation";
import { ShopSettings } from "@/components/settings/shop-settings";

export default function ShopSettingsPage() {
  const auth = useAuth();
  const params = useSearchParams();
  if (!auth.user) return null;
  const shopId =
    params.get("shopId") ??
    auth.user.memberships.find((item) => item.status === "ACTIVE" && item.role === "OWNER")
      ?.shopId ??
    "";
  return <ShopSettings api={auth.api} user={auth.user} shopId={shopId} />;
}
