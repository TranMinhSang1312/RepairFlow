import type { Metadata } from "next";

import { StaffInvitationAcceptance } from "@/components/auth/staff-invitation-acceptance";

export const metadata: Metadata = {
  title: "Lời mời nhân viên · RepairFlow",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default async function StaffInvitationPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <StaffInvitationAcceptance token={token} />;
}
