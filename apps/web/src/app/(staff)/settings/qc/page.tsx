"use client";

import { useRouter, useSearchParams } from "next/navigation";

import { QcTemplateSettings } from "@/components/settings/qc-template-settings";
import { useAuth } from "@/lib/auth/auth-provider";

export default function QcTemplateSettingsPage() {
  const auth = useAuth();
  const router = useRouter();
  const params = useSearchParams();

  if (!auth.user) return null;

  return (
    <QcTemplateSettings
      api={auth.api}
      replaceUrl={(url) => router.replace(url, { scroll: false })}
      search={params.toString()}
      user={auth.user}
    />
  );
}
