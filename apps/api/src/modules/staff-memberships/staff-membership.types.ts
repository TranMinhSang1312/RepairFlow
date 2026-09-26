import type { MembershipRole, MembershipStatus, StaffInvitationStatus } from "@prisma/client";

export interface StaffMembershipView {
  userId: string;
  email: string;
  displayName: string;
  role: MembershipRole;
  status: MembershipStatus;
  joinedAt: string | null;
  updatedAt: string;
  lockVersion: number;
}

export interface StaffInvitationView {
  id: string;
  email: string;
  role: MembershipRole;
  status: StaffInvitationStatus;
  expiresAt: string;
  createdAt: string;
  lockVersion: number;
}

export interface InvitationCommandView extends StaffInvitationView {
  setupUrl: string;
}

export interface PublicStaffInvitationView {
  shopName: string;
  maskedEmail: string;
  role: MembershipRole;
  expiresAt: string;
  acceptanceMode: "CREATE_ACCOUNT" | "SIGN_IN";
}
