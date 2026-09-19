import type { MembershipRole } from "@prisma/client";

export interface TenantContext {
  userId: string;
  shopId: string;
  role: MembershipRole;
  requestId: string;
}
