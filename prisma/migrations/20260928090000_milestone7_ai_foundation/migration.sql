-- CreateEnum
CREATE TYPE "AiReviewOutcome" AS ENUM ('ACCEPTED_UNCHANGED', 'ACCEPTED_EDITED', 'REJECTED');

-- ExtendTable
ALTER TABLE "ai_runs"
ADD COLUMN "schemaVersion" TEXT NOT NULL DEFAULT '1',
ADD COLUMN "startedAt" TIMESTAMPTZ(3),
ADD COLUMN "inputTokens" INTEGER,
ADD COLUMN "outputTokens" INTEGER,
ADD COLUMN "reservedCostMicrousd" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN "estimatedCostMicrousd" BIGINT,
ADD COLUMN "priceTableVersion" TEXT,
ADD COLUMN "latencyMs" INTEGER,
ADD COLUMN "reviewOutcome" "AiReviewOutcome",
ADD COLUMN "reviewedByUserId" UUID,
ADD COLUMN "reviewedAt" TIMESTAMPTZ(3),
ADD COLUMN "editDistancePermille" INTEGER,
ADD COLUMN "timeSavedSeconds" INTEGER;

-- CreateTable
CREATE TABLE "ai_capability_settings" (
    "shopId" UUID NOT NULL,
    "capability" "AiCapability" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "monthlyBudgetMicrousd" BIGINT NOT NULL DEFAULT 0,
    "maxRunCostMicrousd" BIGINT NOT NULL DEFAULT 0,
    "lockVersion" INTEGER NOT NULL DEFAULT 0,
    "updatedByUserId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ai_capability_settings_pkey" PRIMARY KEY ("shopId", "capability")
);

-- CreateTable
CREATE TABLE "ai_usage_periods" (
    "shopId" UUID NOT NULL,
    "capability" "AiCapability" NOT NULL,
    "periodStart" DATE NOT NULL,
    "reservedMicrousd" BIGINT NOT NULL DEFAULT 0,
    "spentMicrousd" BIGINT NOT NULL DEFAULT 0,
    "lockVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ai_usage_periods_pkey" PRIMARY KEY ("shopId", "capability", "periodStart")
);

-- CreateIndex
CREATE INDEX "ai_runs_shopId_status_createdAt_id_idx"
ON "ai_runs"("shopId", "status", "createdAt" DESC, "id" DESC);

CREATE INDEX "ai_capability_settings_shopId_enabled_idx"
ON "ai_capability_settings"("shopId", "enabled");

-- Checks
ALTER TABLE "ai_runs"
ADD CONSTRAINT "ai_runs_token_usage_check" CHECK (
  ("inputTokens" IS NULL OR "inputTokens" >= 0)
  AND ("outputTokens" IS NULL OR "outputTokens" >= 0)
),
ADD CONSTRAINT "ai_runs_cost_check" CHECK (
  "reservedCostMicrousd" >= 0
  AND ("estimatedCostMicrousd" IS NULL OR "estimatedCostMicrousd" >= 0)
),
ADD CONSTRAINT "ai_runs_latency_check" CHECK ("latencyMs" IS NULL OR "latencyMs" >= 0),
ADD CONSTRAINT "ai_runs_review_metrics_check" CHECK (
  ("editDistancePermille" IS NULL OR "editDistancePermille" BETWEEN 0 AND 1000)
  AND ("timeSavedSeconds" IS NULL OR "timeSavedSeconds" BETWEEN 0 AND 3600)
),
ADD CONSTRAINT "ai_runs_review_actor_check" CHECK (
  ("reviewOutcome" IS NULL AND "reviewedByUserId" IS NULL AND "reviewedAt" IS NULL)
  OR ("reviewOutcome" IS NOT NULL AND "reviewedByUserId" IS NOT NULL AND "reviewedAt" IS NOT NULL)
);

ALTER TABLE "ai_capability_settings"
ADD CONSTRAINT "ai_capability_settings_budget_check" CHECK (
  "monthlyBudgetMicrousd" >= 0 AND "maxRunCostMicrousd" >= 0
),
ADD CONSTRAINT "ai_capability_settings_lock_version_check" CHECK ("lockVersion" >= 0);

ALTER TABLE "ai_usage_periods"
ADD CONSTRAINT "ai_usage_periods_amount_check" CHECK (
  "reservedMicrousd" >= 0 AND "spentMicrousd" >= 0
),
ADD CONSTRAINT "ai_usage_periods_lock_version_check" CHECK ("lockVersion" >= 0);

-- Foreign keys
ALTER TABLE "ai_runs"
ADD CONSTRAINT "ai_runs_shopId_fkey"
FOREIGN KEY ("shopId") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ai_runs"
ADD CONSTRAINT "ai_runs_requestedByUserId_fkey"
FOREIGN KEY ("requestedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "ai_runs_acceptedByUserId_fkey"
FOREIGN KEY ("acceptedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "ai_runs_reviewedByUserId_fkey"
FOREIGN KEY ("reviewedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ai_capability_settings"
ADD CONSTRAINT "ai_capability_settings_shopId_fkey"
FOREIGN KEY ("shopId") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ai_capability_settings"
ADD CONSTRAINT "ai_capability_settings_updatedByUserId_fkey"
FOREIGN KEY ("updatedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ai_usage_periods"
ADD CONSTRAINT "ai_usage_periods_shopId_fkey"
FOREIGN KEY ("shopId") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
