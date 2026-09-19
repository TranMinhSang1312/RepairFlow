import type { Prisma } from "@prisma/client";

export const identityUserInclude = {
  memberships: {
    include: {
      shop: {
        include: {
          branches: {
            where: { isActive: true },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          },
        },
      },
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
    timezone: string;
    intakePhotoMinimum: number;
    branches: Array<{
      id: string;
      name: string;
    }>;
  }>;
}

export interface IssuedAuth {
  response: AuthResponse;
  refreshToken: string;
}
