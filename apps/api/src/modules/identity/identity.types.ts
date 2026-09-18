import type { Prisma } from "@prisma/client";

export const identityUserInclude = {
  memberships: {
    include: {
      shop: true,
    },
  },
} satisfies Prisma.UserInclude;

export type IdentityUser = Prisma.UserGetPayload<{ include: typeof identityUserInclude }>;

export interface AuthResponse {
  data: {
    accessToken: string;
    expiresInSeconds: number;
    user: CurrentUser;
  };
}

export interface CurrentUser {
  id: string;
  email: string;
  displayName: string;
  memberships: Array<{
    shopId: string;
    shopName: string;
    role: string;
    status: string;
  }>;
}

export interface IssuedAuth {
  response: AuthResponse;
  refreshToken: string;
}
