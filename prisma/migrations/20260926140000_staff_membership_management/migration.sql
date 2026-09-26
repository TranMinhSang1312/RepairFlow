-- CreateEnum
CREATE TYPE "StaffInvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED', 'SUPERSEDED', 'EXPIRED');

-- AlterTable
ALTER TABLE "shop_memberships"
ADD COLUMN "lockVersion" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "staff_invitations" (
    "id" UUID NOT NULL,
    "shopId" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "role" "MembershipRole" NOT NULL,
    "status" "StaffInvitationStatus" NOT NULL DEFAULT 'PENDING',
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "acceptedAt" TIMESTAMPTZ(3),
    "acceptedByUserId" UUID,
    "revokedAt" TIMESTAMPTZ(3),
    "revokedByUserId" UUID,
    "supersededAt" TIMESTAMPTZ(3),
    "createdByUserId" UUID NOT NULL,
    "lockVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "staff_invitations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "staff_invitations_role_check" CHECK ("role" IN ('RECEPTIONIST', 'TECHNICIAN')),
    CONSTRAINT "staff_invitations_lock_version_check" CHECK ("lockVersion" >= 0),
    CONSTRAINT "staff_invitations_terminal_state_check" CHECK (
      ("status" = 'PENDING' AND "acceptedAt" IS NULL AND "revokedAt" IS NULL AND "supersededAt" IS NULL)
      OR ("status" = 'ACCEPTED' AND "acceptedAt" IS NOT NULL AND "acceptedByUserId" IS NOT NULL AND "revokedAt" IS NULL AND "supersededAt" IS NULL)
      OR ("status" = 'REVOKED' AND "revokedAt" IS NOT NULL AND "revokedByUserId" IS NOT NULL AND "acceptedAt" IS NULL AND "supersededAt" IS NULL)
      OR ("status" = 'SUPERSEDED' AND "supersededAt" IS NOT NULL AND "acceptedAt" IS NULL AND "revokedAt" IS NULL)
      OR ("status" = 'EXPIRED' AND "acceptedAt" IS NULL AND "revokedAt" IS NULL AND "supersededAt" IS NULL)
    )
);

-- CreateIndex
CREATE UNIQUE INDEX "staff_invitations_tokenHash_key" ON "staff_invitations"("tokenHash");
CREATE INDEX "shop_memberships_shopId_updatedAt_userId_idx" ON "shop_memberships"("shopId", "updatedAt" DESC, "userId");
CREATE INDEX "staff_invitations_shopId_status_createdAt_idx" ON "staff_invitations"("shopId", "status", "createdAt" DESC);
CREATE INDEX "staff_invitations_shopId_email_createdAt_idx" ON "staff_invitations"("shopId", "email", "createdAt" DESC);
CREATE UNIQUE INDEX "staff_invitations_one_pending_per_shop_email" ON "staff_invitations"("shopId", "email") WHERE "status" = 'PENDING';

-- Constraints
ALTER TABLE "shop_memberships" ADD CONSTRAINT "shop_memberships_lock_version_check" CHECK ("lockVersion" >= 0);
ALTER TABLE "staff_invitations" ADD CONSTRAINT "staff_invitations_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "staff_invitations" ADD CONSTRAINT "staff_invitations_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "staff_invitations" ADD CONSTRAINT "staff_invitations_acceptedByUserId_fkey" FOREIGN KEY ("acceptedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "staff_invitations" ADD CONSTRAINT "staff_invitations_revokedByUserId_fkey" FOREIGN KEY ("revokedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
