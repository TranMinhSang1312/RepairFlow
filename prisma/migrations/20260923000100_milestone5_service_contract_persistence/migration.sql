-- RF-040: service execution, QC, handover, and warranty persistence.
-- This is a forward-only migration. Existing immutable business rows are preserved.

CREATE TYPE "QuoteQuantityUnit" AS ENUM ('EACH', 'HOUR');
CREATE TYPE "PartRequirementStatus" AS ENUM ('NEEDED', 'ORDERED', 'AVAILABLE', 'CANCELLED');

ALTER TABLE "quote_items"
  ADD COLUMN "scopeKey" UUID,
  ADD COLUMN "carriedFromQuoteItemId" UUID,
  ADD COLUMN "displayNote" TEXT,
  ADD COLUMN "quantityUnit" "QuoteQuantityUnit" NOT NULL DEFAULT 'EACH';

UPDATE "quote_items" SET "scopeKey" = gen_random_uuid() WHERE "scopeKey" IS NULL;
ALTER TABLE "quote_items" ALTER COLUMN "scopeKey" SET NOT NULL;

CREATE UNIQUE INDEX "quote_items_shopId_quoteVersionId_scopeKey_key"
  ON "quote_items"("shopId", "quoteVersionId", "scopeKey");
CREATE INDEX "quote_items_shopId_scopeKey_idx" ON "quote_items"("shopId", "scopeKey");
CREATE INDEX "quote_items_shopId_carriedFromQuoteItemId_idx"
  ON "quote_items"("shopId", "carriedFromQuoteItemId");
ALTER TABLE "quote_items"
  ADD CONSTRAINT "quote_items_shopId_carriedFromQuoteItemId_fkey"
  FOREIGN KEY ("shopId", "carriedFromQuoteItemId")
  REFERENCES "quote_items"("shopId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quote_items"
  ADD CONSTRAINT "quote_items_quantity_positive_check" CHECK ("quantity" > 0),
  ADD CONSTRAINT "quote_items_money_nonnegative_check"
    CHECK ("unitPrice" >= 0 AND "lineTotal" >= 0);

CREATE UNIQUE INDEX "work_logs_shopId_id_key" ON "work_logs"("shopId", "id");
CREATE UNIQUE INDEX "work_logs_shopId_supersedesId_key"
  ON "work_logs"("shopId", "supersedesId");
ALTER TABLE "work_logs"
  ADD CONSTRAINT "work_logs_shopId_supersedesId_fkey"
  FOREIGN KEY ("shopId", "supersedesId")
  REFERENCES "work_logs"("shopId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "part_requirements" (
  "id" UUID NOT NULL,
  "shopId" UUID NOT NULL,
  "repairOrderId" UUID NOT NULL,
  "quoteItemId" UUID NOT NULL,
  "scopeKey" UUID NOT NULL,
  "nameSnapshot" TEXT NOT NULL,
  "sku" TEXT,
  "quantity" DECIMAL(12,2) NOT NULL,
  "quantityUnit" "QuoteQuantityUnit" NOT NULL,
  "status" "PartRequirementStatus" NOT NULL DEFAULT 'NEEDED',
  "lockVersion" INTEGER NOT NULL DEFAULT 0,
  "createdByUserId" UUID NOT NULL,
  "updatedByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "part_requirements_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "part_requirements_quantity_positive_check" CHECK ("quantity" > 0),
  CONSTRAINT "part_requirements_lock_version_nonnegative_check" CHECK ("lockVersion" >= 0)
);
CREATE UNIQUE INDEX "part_requirements_shopId_id_key" ON "part_requirements"("shopId", "id");
CREATE INDEX "part_requirements_shopId_repairOrderId_status_idx"
  ON "part_requirements"("shopId", "repairOrderId", "status");
CREATE INDEX "part_requirements_shopId_repairOrderId_scopeKey_idx"
  ON "part_requirements"("shopId", "repairOrderId", "scopeKey");
CREATE UNIQUE INDEX "part_requirements_one_current_scope_idx"
  ON "part_requirements"("shopId", "repairOrderId", "scopeKey")
  WHERE "status" <> 'CANCELLED';
ALTER TABLE "part_requirements"
  ADD CONSTRAINT "part_requirements_shopId_repairOrderId_fkey"
    FOREIGN KEY ("shopId", "repairOrderId") REFERENCES "repair_orders"("shopId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "part_requirements_shopId_quoteItemId_fkey"
    FOREIGN KEY ("shopId", "quoteItemId") REFERENCES "quote_items"("shopId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

DROP INDEX "parts_used_shopId_repairOrderId_idx";
ALTER TABLE "parts_used"
  ADD COLUMN "quoteItemId" UUID,
  ADD COLUMN "scopeKey" UUID,
  ADD COLUMN "supersedesId" UUID;
CREATE UNIQUE INDEX "parts_used_shopId_id_key" ON "parts_used"("shopId", "id");
CREATE UNIQUE INDEX "parts_used_shopId_supersedesId_key"
  ON "parts_used"("shopId", "supersedesId");
CREATE INDEX "parts_used_shopId_repairOrderId_scopeKey_createdAt_idx"
  ON "parts_used"("shopId", "repairOrderId", "scopeKey", "createdAt");
ALTER TABLE "parts_used"
  ADD CONSTRAINT "parts_used_shopId_quoteItemId_fkey"
    FOREIGN KEY ("shopId", "quoteItemId") REFERENCES "quote_items"("shopId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "parts_used_shopId_supersedesId_fkey"
    FOREIGN KEY ("shopId", "supersedesId") REFERENCES "parts_used"("shopId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "parts_used_scope_binding_pair_check"
    CHECK (("quoteItemId" IS NULL) = ("scopeKey" IS NULL)),
  ADD CONSTRAINT "parts_used_quantity_positive_check" CHECK ("quantity" > 0),
  ADD CONSTRAINT "parts_used_money_nonnegative_check"
    CHECK (("unitCost" IS NULL OR "unitCost" >= 0) AND ("unitSalePrice" IS NULL OR "unitSalePrice" >= 0));

ALTER TABLE "qc_templates" ADD COLUMN "normalizedName" TEXT;
UPDATE "qc_templates"
SET "normalizedName" = lower(regexp_replace(btrim("name"), '[[:space:]]+', ' ', 'g'))
WHERE "normalizedName" IS NULL;
ALTER TABLE "qc_templates" ALTER COLUMN "normalizedName" SET NOT NULL;
DROP INDEX "qc_templates_shopId_name_versionNo_key";
CREATE UNIQUE INDEX "qc_templates_shopId_normalizedName_versionNo_key"
  ON "qc_templates"("shopId", "normalizedName", "versionNo");
CREATE UNIQUE INDEX "qc_templates_one_active_family_idx"
  ON "qc_templates"("shopId", "normalizedName") WHERE "isActive";
CREATE UNIQUE INDEX "qc_template_items_shopId_qcTemplateId_sortOrder_key"
  ON "qc_template_items"("shopId", "qcTemplateId", "sortOrder");

ALTER TABLE "qc_runs" ADD COLUMN "runNo" INTEGER;
WITH numbered AS (
  SELECT "id", row_number() OVER (
    PARTITION BY "shopId", "repairOrderId" ORDER BY "createdAt", "id"
  )::integer AS run_no
  FROM "qc_runs"
)
UPDATE "qc_runs" q SET "runNo" = numbered.run_no FROM numbered WHERE q."id" = numbered."id";
ALTER TABLE "qc_runs" ALTER COLUMN "runNo" SET NOT NULL;
DROP INDEX "qc_runs_shopId_repairOrderId_createdAt_idx";
CREATE UNIQUE INDEX "qc_runs_shopId_repairOrderId_runNo_key"
  ON "qc_runs"("shopId", "repairOrderId", "runNo");
CREATE INDEX "qc_runs_shopId_repairOrderId_runNo_idx"
  ON "qc_runs"("shopId", "repairOrderId", "runNo" DESC);

CREATE UNIQUE INDEX "media_assets_shopId_id_key" ON "media_assets"("shopId", "id");
CREATE UNIQUE INDEX "qc_results_shopId_id_key" ON "qc_results"("shopId", "id");
CREATE TABLE "qc_result_evidence" (
  "id" UUID NOT NULL,
  "shopId" UUID NOT NULL,
  "qcResultId" UUID NOT NULL,
  "mediaAssetId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "qc_result_evidence_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "qc_result_evidence_shopId_qcResultId_mediaAssetId_key"
  ON "qc_result_evidence"("shopId", "qcResultId", "mediaAssetId");
CREATE UNIQUE INDEX "qc_result_evidence_shopId_mediaAssetId_key"
  ON "qc_result_evidence"("shopId", "mediaAssetId");
CREATE INDEX "qc_result_evidence_shopId_qcResultId_idx"
  ON "qc_result_evidence"("shopId", "qcResultId");
ALTER TABLE "qc_result_evidence"
  ADD CONSTRAINT "qc_result_evidence_shopId_qcResultId_fkey"
    FOREIGN KEY ("shopId", "qcResultId") REFERENCES "qc_results"("shopId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "qc_result_evidence_shopId_mediaAssetId_fkey"
    FOREIGN KEY ("shopId", "mediaAssetId") REFERENCES "media_assets"("shopId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "handovers_shopId_signatureMediaAssetId_key"
  ON "handovers"("shopId", "signatureMediaAssetId");
ALTER TABLE "handovers"
  ADD CONSTRAINT "handovers_shopId_signatureMediaAssetId_fkey"
  FOREIGN KEY ("shopId", "signatureMediaAssetId")
  REFERENCES "media_assets"("shopId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_amount_positive_check" CHECK ("amount" > 0);
ALTER TABLE "warranties"
  ADD CONSTRAINT "warranties_dates_ordered_check" CHECK ("endsAt" > "startsAt");
