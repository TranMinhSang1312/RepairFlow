CREATE TABLE "rate_limit_buckets" (
    "keyHash" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "resetAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "rate_limit_buckets_pkey" PRIMARY KEY ("keyHash")
);

CREATE INDEX "rate_limit_buckets_resetAt_idx" ON "rate_limit_buckets"("resetAt");

ALTER TABLE "shops" ADD COLUMN "lockVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "branches" ADD COLUMN "lockVersion" INTEGER NOT NULL DEFAULT 0;
