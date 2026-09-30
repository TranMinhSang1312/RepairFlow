"use client";

import { useRouter, useSearchParams } from "next/navigation";

import { AiSettings } from "@/components/settings/ai-settings";
import { useAuth } from "@/lib/auth/auth-provider";

export default function AiSettingsPage() {
  const auth = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  if (!auth.user) return null;
  return (
    <AiSettings
      api={auth.api}
      user={auth.user}
      search={params.toString()}
      replaceUrl={(url) => router.replace(url, { scroll: false })}
    />
  );
}
