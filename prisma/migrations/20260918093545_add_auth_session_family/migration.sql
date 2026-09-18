-- AlterTable
ALTER TABLE "auth_sessions" ADD COLUMN "familyId" UUID;

-- Existing sessions begin as independent families. New sessions receive a UUID from Prisma.
UPDATE "auth_sessions" SET "familyId" = "id";

ALTER TABLE "auth_sessions" ALTER COLUMN "familyId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "auth_sessions_familyId_idx" ON "auth_sessions"("familyId");
