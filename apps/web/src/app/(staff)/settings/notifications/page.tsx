"use client";

import { useRouter, useSearchParams } from "next/navigation";

import { NotificationOperations } from "@/components/settings/notification-operations";
import { useAuth } from "@/lib/auth/auth-provider";

export default function NotificationOperationsPage() {
  const auth = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  if (!auth.user) return null;
  return (
    <NotificationOperations
      api={auth.api}
      user={auth.user}
      search={params.toString()}
      replaceUrl={(url) => router.replace(url, { scroll: false })}
    />
  );
}
