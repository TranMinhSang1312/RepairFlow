"use client";

import { useRouter, useSearchParams } from "next/navigation";

import { StaffMembershipSettings } from "@/components/settings/staff-membership-settings";
import { useAuth } from "@/lib/auth/auth-provider";

export default function StaffSettingsPage() {
  const auth = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  if (!auth.user) return null;
  return (
    <StaffMembershipSettings
      api={auth.api}
      user={auth.user}
      search={params.toString()}
      replaceUrl={(url) => router.replace(url, { scroll: false })}
    />
  );
}
