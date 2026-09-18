-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "MembershipRole" AS ENUM ('OWNER', 'RECEPTIONIST', 'TECHNICIAN');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('INVITED', 'ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "DeviceType" AS ENUM ('PHONE', 'LAPTOP', 'TABLET', 'OTHER');

-- CreateEnum
CREATE TYPE "RepairOrderStatus" AS ENUM ('RECEIVED', 'DIAGNOSING', 'AWAITING_APPROVAL', 'APPROVED', 'WAITING_PARTS', 'REPAIRING', 'QUALITY_CHECK', 'READY_FOR_PICKUP', 'COMPLETED', 'VOIDED');

-- CreateEnum
CREATE TYPE "CompletionOutcome" AS ENUM ('REPAIRED', 'DECLINED_QUOTE', 'UNREPAIRABLE', 'NO_FAULT_FOUND', 'CUSTOMER_CANCELLED');

-- CreateEnum
CREATE TYPE "ServiceType" AS ENUM ('STANDARD', 'WARRANTY');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "MediaPurpose" AS ENUM ('INTAKE', 'DIAGNOSIS', 'REPAIR', 'QC', 'HANDOVER', 'SIGNATURE');

-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('DRAFT', 'SENT', 'ACCEPTED', 'PARTIALLY_ACCEPTED', 'DECLINED', 'EXPIRED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "QuoteItemKind" AS ENUM ('SERVICE', 'PART', 'FEE');

-- CreateEnum
CREATE TYPE "QuoteDecision" AS ENUM ('ACCEPTED', 'PARTIALLY_ACCEPTED', 'DECLINED');

-- CreateEnum
CREATE TYPE "WorkLogType" AS ENUM ('REPAIR', 'TEST', 'CUSTOMER_CONTACT', 'INTERNAL_NOTE', 'CORRECTION');

-- CreateEnum
CREATE TYPE "QcRunResult" AS ENUM ('PASS', 'FAIL');

-- CreateEnum
CREATE TYPE "QcItemResult" AS ENUM ('PASS', 'FAIL', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'BANK_TRANSFER', 'CARD', 'E_WALLET', 'OTHER');

-- CreateEnum
CREATE TYPE "PaymentDisposition" AS ENUM ('PAID', 'PARTIALLY_PAID', 'WAIVED', 'PAY_LATER');

-- CreateEnum
CREATE TYPE "TokenScope" AS ENUM ('TRACK_ORDER', 'DECIDE_QUOTE');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('USER', 'CUSTOMER_TOKEN', 'SYSTEM');

-- CreateEnum
CREATE TYPE "AiCapability" AS ENUM ('DEVICE_OCR', 'INTAKE_DRAFT', 'CHECKLIST_SUGGESTION', 'CUSTOMER_SUMMARY');

-- CreateEnum
CREATE TYPE "AiRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'REJECTED');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'DEAD_LETTER');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('EMAIL', 'ZALO', 'SMS');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_sessions" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "userAgent" TEXT,
    "ipHash" TEXT,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shops" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
    "contactPhone" TEXT,
    "orderCodePrefix" TEXT NOT NULL DEFAULT 'RF',
    "intakePhotoMinimum" INTEGER NOT NULL DEFAULT 1,
    "defaultQuoteExpiryHours" INTEGER NOT NULL DEFAULT 48,
    "defaultWarrantyTerms" TEXT,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "shops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branches" (
    "id" UUID NOT NULL,
    "shopId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shop_memberships" (
    "shopId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "MembershipRole" NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'INVITED',
    "invitedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "joinedAt" TIMESTAMPTZ(3),
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "shop_memberships_pkey" PRIMARY KEY ("shopId","userId")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL,
    "shopId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phoneRaw" TEXT NOT NULL,
    "phoneNormalized" TEXT NOT NULL,
    "email" TEXT,
    "notes" TEXT,
    "consentAt" TIMESTAMPTZ(3),
    "archivedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" UUID NOT NULL,
    "shopId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "type" "DeviceType" NOT NULL,
    "brand" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "color" TEXT,
    "serialNormalized" TEXT,
    "imeiNormalized" TEXT,
    "notes" TEXT,
    "archivedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repair_orders" (
    "id" UUID NOT NULL,
    "shopId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "sourceOrderId" UUID,
    "orderNo" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "serviceType" "ServiceType" NOT NULL DEFAULT 'STANDARD',
    "status" "RepairOrderStatus" NOT NULL DEFAULT 'RECEIVED',
    "completionOutcome" "CompletionOutcome",
    "priority" "Priority" NOT NULL DEFAULT 'NORMAL',
    "reportedProblem" TEXT NOT NULL,
    "intakeCondition" TEXT NOT NULL,
    "consentAcknowledgedAt" TIMESTAMPTZ(3) NOT NULL,
    "customerSnapshot" JSONB NOT NULL,
    "deviceSnapshot" JSONB NOT NULL,
    "promisedAt" TIMESTAMPTZ(3),
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readyAt" TIMESTAMPTZ(3),
    "returnedAt" TIMESTAMPTZ(3),
    "lockVersion" INTEGER NOT NULL DEFAULT 0,
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "repair_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "intake_accessories" (
    "id" UUID NOT NULL,
    "shopId" UUID NOT NULL,
    "repairOrderId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "conditionNote" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "intake_accessories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_assets" (
    "id" UUID NOT NULL,
    "shopId" UUID NOT NULL,
    "repairOrderId" UUID,
    "purpose" "MediaPurpose" NOT NULL,
    "objectKey" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "checksumSha256" TEXT,
    "uploadedByUserId" UUID NOT NULL,
    "uploadedAt" TIMESTAMPTZ(3),
    "expiresAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignments" (
    "id" UUID NOT NULL,
    "shopId" UUID NOT NULL,
    "repairOrderId" UUID NOT NULL,
    "technicianUserId" UUID NOT NULL,
    "assignedByUserId" UUID NOT NULL,
    "assignedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unassignedAt" TIMESTAMPTZ(3),

    CONSTRAINT "assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "diagnoses" (
    "id" UUID NOT NULL,
    "shopId" UUID NOT NULL,
    "repairOrderId" UUID NOT NULL,
    "revisionNo" INTEGER NOT NULL,
    "finding" TEXT NOT NULL,
    "recommendation" TEXT NOT NULL,
    "supersedesId" UUID,
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "diagnoses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_versions" (
    "id" UUID NOT NULL,
    "shopId" UUID NOT NULL,
    "repairOrderId" UUID NOT NULL,
    "diagnosisId" UUID,
    "versionNo" INTEGER NOT NULL,
    "status" "QuoteStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" TEXT NOT NULL DEFAULT 'VND',
    "subtotal" BIGINT NOT NULL DEFAULT 0,
    "discount" BIGINT NOT NULL DEFAULT 0,
    "total" BIGINT NOT NULL DEFAULT 0,
    "customerNote" TEXT,
    "expiresAt" TIMESTAMPTZ(3),
    "sentAt" TIMESTAMPTZ(3),
    "decidedAt" TIMESTAMPTZ(3),
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "quote_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_items" (
    "id" UUID NOT NULL,
    "shopId" UUID NOT NULL,
    "quoteVersionId" UUID NOT NULL,
    "kind" "QuoteItemKind" NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(12,2) NOT NULL,
    "unitPrice" BIGINT NOT NULL,
    "lineTotal" BIGINT NOT NULL,
    "isOptional" BOOLEAN NOT NULL DEFAULT false,
    "approvalGroup" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quote_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_approvals" (
    "id" UUID NOT NULL,
    "shopId" UUID NOT NULL,
    "quoteVersionId" UUID NOT NULL,
    "decision" "QuoteDecision" NOT NULL,
    "approvedItemSnapshot" JSONB NOT NULL,
    "approvedTotal" BIGINT NOT NULL,
    "customerNote" TEXT,
    "actorFingerprint" TEXT,
    "idempotencyKeyHash" TEXT NOT NULL,
    "decidedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quote_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_logs" (
    "id" UUID NOT NULL,
    "shopId" UUID NOT NULL,
    "repairOrderId" UUID NOT NULL,
    "quoteItemId" UUID,
    "supersedesId" UUID,
    "type" "WorkLogType" NOT NULL,
    "content" TEXT NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parts_used" (
    "id" UUID NOT NULL,
    "shopId" UUID NOT NULL,
    "repairOrderId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "quantity" DECIMAL(12,2) NOT NULL,
    "unitCost" BIGINT,
    "unitSalePrice" BIGINT,
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "parts_used_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qc_templates" (
    "id" UUID NOT NULL,
    "shopId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qc_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qc_template_items" (
    "id" UUID NOT NULL,
    "shopId" UUID NOT NULL,
    "qcTemplateId" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "isRequired" BOOLEAN NOT NULL DEFAULT true,
    "allowNa" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qc_template_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qc_runs" (
    "id" UUID NOT NULL,
    "shopId" UUID NOT NULL,
    "repairOrderId" UUID NOT NULL,
    "qcTemplateId" UUID NOT NULL,
    "result" "QcRunResult" NOT NULL,
    "notes" TEXT,
    "checkedByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qc_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qc_results" (
    "id" UUID NOT NULL,
    "shopId" UUID NOT NULL,
    "qcRunId" UUID NOT NULL,
    "qcTemplateItemId" UUID NOT NULL,
    "result" "QcItemResult" NOT NULL,
    "note" TEXT,

    CONSTRAINT "qc_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "handovers" (
    "id" UUID NOT NULL,
    "shopId" UUID NOT NULL,
    "repairOrderId" UUID NOT NULL,
    "recipientName" TEXT NOT NULL,
    "paymentDisposition" "PaymentDisposition" NOT NULL,
    "paymentNote" TEXT,
    "signatureMediaAssetId" UUID,
    "handedOverByUserId" UUID NOT NULL,
    "handedOverAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "handovers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "shopId" UUID NOT NULL,
    "repairOrderId" UUID NOT NULL,
    "amount" BIGINT NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "reference" TEXT,
    "receivedByUserId" UUID NOT NULL,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warranties" (
    "id" UUID NOT NULL,
    "shopId" UUID NOT NULL,
    "repairOrderId" UUID NOT NULL,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "termsSnapshot" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "warranties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_events" (
    "id" UUID NOT NULL,
    "shopId" UUID NOT NULL,
    "repairOrderId" UUID NOT NULL,
    "eventType" TEXT NOT NULL,
    "fromStatus" "RepairOrderStatus",
    "toStatus" "RepairOrderStatus",
    "actorType" "ActorType" NOT NULL,
    "actorUserId" UUID,
    "publicPayload" JSONB,
    "privatePayload" JSONB,
    "requestId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public_access_tokens" (
    "id" UUID NOT NULL,
    "shopId" UUID NOT NULL,
    "repairOrderId" UUID NOT NULL,
    "quoteVersionId" UUID,
    "scope" "TokenScope" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "lastUsedAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "public_access_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_runs" (
    "id" UUID NOT NULL,
    "shopId" UUID NOT NULL,
    "repairOrderId" UUID,
    "capability" "AiCapability" NOT NULL,
    "status" "AiRunStatus" NOT NULL DEFAULT 'QUEUED',
    "provider" TEXT,
    "model" TEXT,
    "promptVersion" TEXT NOT NULL,
    "inputReference" JSONB NOT NULL,
    "output" JSONB,
    "confidence" DECIMAL(5,4),
    "errorCode" TEXT,
    "requestedByUserId" UUID NOT NULL,
    "acceptedByUserId" UUID,
    "acceptedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(3),

    CONSTRAINT "ai_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "shopId" UUID NOT NULL,
    "actorUserId" UUID,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "beforeData" JSONB,
    "afterData" JSONB,
    "requestId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL,
    "shopId" UUID NOT NULL,
    "eventType" TEXT NOT NULL,
    "aggregateType" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMPTZ(3),
    "lockedBy" TEXT,
    "lastError" TEXT,
    "completedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_deliveries" (
    "id" UUID NOT NULL,
    "outboxEventId" UUID NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "destinationHash" TEXT NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "providerMessageId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastErrorCode" TEXT,
    "sentAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_records" (
    "id" UUID NOT NULL,
    "shopId" UUID NOT NULL,
    "scope" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "responseStatus" INTEGER NOT NULL,
    "responseBody" JSONB NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "auth_sessions_refreshTokenHash_key" ON "auth_sessions"("refreshTokenHash");

-- CreateIndex
CREATE INDEX "auth_sessions_userId_expiresAt_idx" ON "auth_sessions"("userId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "shops_slug_key" ON "shops"("slug");

-- CreateIndex
CREATE INDEX "branches_shopId_isActive_idx" ON "branches"("shopId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "branches_shopId_id_key" ON "branches"("shopId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "branches_shopId_name_key" ON "branches"("shopId", "name");

-- CreateIndex
CREATE INDEX "shop_memberships_userId_status_idx" ON "shop_memberships"("userId", "status");

-- CreateIndex
CREATE INDEX "customers_shopId_phoneNormalized_idx" ON "customers"("shopId", "phoneNormalized");

-- CreateIndex
CREATE INDEX "customers_shopId_name_idx" ON "customers"("shopId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "customers_shopId_id_key" ON "customers"("shopId", "id");

-- CreateIndex
CREATE INDEX "devices_shopId_customerId_idx" ON "devices"("shopId", "customerId");

-- CreateIndex
CREATE INDEX "devices_shopId_serialNormalized_idx" ON "devices"("shopId", "serialNormalized");

-- CreateIndex
CREATE INDEX "devices_shopId_imeiNormalized_idx" ON "devices"("shopId", "imeiNormalized");

-- CreateIndex
CREATE UNIQUE INDEX "devices_shopId_id_key" ON "devices"("shopId", "id");

-- CreateIndex
CREATE INDEX "repair_orders_shopId_branchId_status_updatedAt_idx" ON "repair_orders"("shopId", "branchId", "status", "updatedAt" DESC);

-- CreateIndex
CREATE INDEX "repair_orders_shopId_customerId_createdAt_idx" ON "repair_orders"("shopId", "customerId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "repair_orders_shopId_deviceId_createdAt_idx" ON "repair_orders"("shopId", "deviceId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "repair_orders_shopId_sourceOrderId_idx" ON "repair_orders"("shopId", "sourceOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "repair_orders_shopId_id_key" ON "repair_orders"("shopId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "repair_orders_shopId_code_key" ON "repair_orders"("shopId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "repair_orders_shopId_orderNo_key" ON "repair_orders"("shopId", "orderNo");

-- CreateIndex
CREATE INDEX "intake_accessories_shopId_repairOrderId_idx" ON "intake_accessories"("shopId", "repairOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "media_assets_objectKey_key" ON "media_assets"("objectKey");

-- CreateIndex
CREATE INDEX "media_assets_shopId_repairOrderId_purpose_idx" ON "media_assets"("shopId", "repairOrderId", "purpose");

-- CreateIndex
CREATE INDEX "media_assets_shopId_expiresAt_idx" ON "media_assets"("shopId", "expiresAt");

-- CreateIndex
CREATE INDEX "assignments_shopId_repairOrderId_unassignedAt_idx" ON "assignments"("shopId", "repairOrderId", "unassignedAt");

-- CreateIndex
CREATE INDEX "assignments_shopId_technicianUserId_unassignedAt_idx" ON "assignments"("shopId", "technicianUserId", "unassignedAt");

-- CreateIndex
CREATE INDEX "diagnoses_shopId_repairOrderId_createdAt_idx" ON "diagnoses"("shopId", "repairOrderId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "diagnoses_repairOrderId_revisionNo_key" ON "diagnoses"("repairOrderId", "revisionNo");

-- CreateIndex
CREATE INDEX "quote_versions_shopId_repairOrderId_status_idx" ON "quote_versions"("shopId", "repairOrderId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "quote_versions_shopId_id_key" ON "quote_versions"("shopId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "quote_versions_repairOrderId_versionNo_key" ON "quote_versions"("repairOrderId", "versionNo");

-- CreateIndex
CREATE INDEX "quote_items_shopId_quoteVersionId_sortOrder_idx" ON "quote_items"("shopId", "quoteVersionId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "quote_items_shopId_id_key" ON "quote_items"("shopId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "quote_approvals_quoteVersionId_key" ON "quote_approvals"("quoteVersionId");

-- CreateIndex
CREATE INDEX "quote_approvals_shopId_decidedAt_idx" ON "quote_approvals"("shopId", "decidedAt");

-- CreateIndex
CREATE UNIQUE INDEX "quote_approvals_shopId_quoteVersionId_key" ON "quote_approvals"("shopId", "quoteVersionId");

-- CreateIndex
CREATE INDEX "work_logs_shopId_repairOrderId_createdAt_idx" ON "work_logs"("shopId", "repairOrderId", "createdAt");

-- CreateIndex
CREATE INDEX "parts_used_shopId_repairOrderId_idx" ON "parts_used"("shopId", "repairOrderId");

-- CreateIndex
CREATE INDEX "qc_templates_shopId_isActive_idx" ON "qc_templates"("shopId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "qc_templates_shopId_id_key" ON "qc_templates"("shopId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "qc_templates_shopId_name_versionNo_key" ON "qc_templates"("shopId", "name", "versionNo");

-- CreateIndex
CREATE INDEX "qc_template_items_shopId_qcTemplateId_sortOrder_idx" ON "qc_template_items"("shopId", "qcTemplateId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "qc_template_items_shopId_id_key" ON "qc_template_items"("shopId", "id");

-- CreateIndex
CREATE INDEX "qc_runs_shopId_repairOrderId_createdAt_idx" ON "qc_runs"("shopId", "repairOrderId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "qc_runs_shopId_id_key" ON "qc_runs"("shopId", "id");

-- CreateIndex
CREATE INDEX "qc_results_shopId_qcRunId_idx" ON "qc_results"("shopId", "qcRunId");

-- CreateIndex
CREATE UNIQUE INDEX "qc_results_qcRunId_qcTemplateItemId_key" ON "qc_results"("qcRunId", "qcTemplateItemId");

-- CreateIndex
CREATE UNIQUE INDEX "handovers_repairOrderId_key" ON "handovers"("repairOrderId");

-- CreateIndex
CREATE INDEX "handovers_shopId_handedOverAt_idx" ON "handovers"("shopId", "handedOverAt");

-- CreateIndex
CREATE UNIQUE INDEX "handovers_shopId_repairOrderId_key" ON "handovers"("shopId", "repairOrderId");

-- CreateIndex
CREATE INDEX "payments_shopId_repairOrderId_receivedAt_idx" ON "payments"("shopId", "repairOrderId", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "warranties_repairOrderId_key" ON "warranties"("repairOrderId");

-- CreateIndex
CREATE INDEX "warranties_shopId_endsAt_idx" ON "warranties"("shopId", "endsAt");

-- CreateIndex
CREATE UNIQUE INDEX "warranties_shopId_repairOrderId_key" ON "warranties"("shopId", "repairOrderId");

-- CreateIndex
CREATE INDEX "order_events_shopId_repairOrderId_createdAt_idx" ON "order_events"("shopId", "repairOrderId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "public_access_tokens_tokenHash_key" ON "public_access_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "public_access_tokens_shopId_repairOrderId_scope_idx" ON "public_access_tokens"("shopId", "repairOrderId", "scope");

-- CreateIndex
CREATE INDEX "public_access_tokens_expiresAt_revokedAt_idx" ON "public_access_tokens"("expiresAt", "revokedAt");

-- CreateIndex
CREATE INDEX "ai_runs_shopId_repairOrderId_capability_createdAt_idx" ON "ai_runs"("shopId", "repairOrderId", "capability", "createdAt");

-- CreateIndex
CREATE INDEX "ai_runs_status_createdAt_idx" ON "ai_runs"("status", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_shopId_entityType_entityId_createdAt_idx" ON "audit_logs"("shopId", "entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_shopId_actorUserId_createdAt_idx" ON "audit_logs"("shopId", "actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "outbox_events_status_availableAt_idx" ON "outbox_events"("status", "availableAt");

-- CreateIndex
CREATE INDEX "outbox_events_shopId_aggregateType_aggregateId_idx" ON "outbox_events"("shopId", "aggregateType", "aggregateId");

-- CreateIndex
CREATE INDEX "notification_deliveries_status_createdAt_idx" ON "notification_deliveries"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "notification_deliveries_outboxEventId_channel_key" ON "notification_deliveries"("outboxEventId", "channel");

-- CreateIndex
CREATE INDEX "idempotency_records_expiresAt_idx" ON "idempotency_records"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_records_shopId_scope_keyHash_key" ON "idempotency_records"("shopId", "scope", "keyHash");

-- AddForeignKey
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_memberships" ADD CONSTRAINT "shop_memberships_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_memberships" ADD CONSTRAINT "shop_memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_shopId_customerId_fkey" FOREIGN KEY ("shopId", "customerId") REFERENCES "customers"("shopId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repair_orders" ADD CONSTRAINT "repair_orders_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repair_orders" ADD CONSTRAINT "repair_orders_shopId_branchId_fkey" FOREIGN KEY ("shopId", "branchId") REFERENCES "branches"("shopId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repair_orders" ADD CONSTRAINT "repair_orders_shopId_customerId_fkey" FOREIGN KEY ("shopId", "customerId") REFERENCES "customers"("shopId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repair_orders" ADD CONSTRAINT "repair_orders_shopId_deviceId_fkey" FOREIGN KEY ("shopId", "deviceId") REFERENCES "devices"("shopId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repair_orders" ADD CONSTRAINT "repair_orders_shopId_sourceOrderId_fkey" FOREIGN KEY ("shopId", "sourceOrderId") REFERENCES "repair_orders"("shopId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intake_accessories" ADD CONSTRAINT "intake_accessories_shopId_repairOrderId_fkey" FOREIGN KEY ("shopId", "repairOrderId") REFERENCES "repair_orders"("shopId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_shopId_repairOrderId_fkey" FOREIGN KEY ("shopId", "repairOrderId") REFERENCES "repair_orders"("shopId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_shopId_repairOrderId_fkey" FOREIGN KEY ("shopId", "repairOrderId") REFERENCES "repair_orders"("shopId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_shopId_technicianUserId_fkey" FOREIGN KEY ("shopId", "technicianUserId") REFERENCES "shop_memberships"("shopId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diagnoses" ADD CONSTRAINT "diagnoses_shopId_repairOrderId_fkey" FOREIGN KEY ("shopId", "repairOrderId") REFERENCES "repair_orders"("shopId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_versions" ADD CONSTRAINT "quote_versions_shopId_repairOrderId_fkey" FOREIGN KEY ("shopId", "repairOrderId") REFERENCES "repair_orders"("shopId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_items" ADD CONSTRAINT "quote_items_shopId_quoteVersionId_fkey" FOREIGN KEY ("shopId", "quoteVersionId") REFERENCES "quote_versions"("shopId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_approvals" ADD CONSTRAINT "quote_approvals_shopId_quoteVersionId_fkey" FOREIGN KEY ("shopId", "quoteVersionId") REFERENCES "quote_versions"("shopId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_logs" ADD CONSTRAINT "work_logs_shopId_repairOrderId_fkey" FOREIGN KEY ("shopId", "repairOrderId") REFERENCES "repair_orders"("shopId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_logs" ADD CONSTRAINT "work_logs_shopId_quoteItemId_fkey" FOREIGN KEY ("shopId", "quoteItemId") REFERENCES "quote_items"("shopId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parts_used" ADD CONSTRAINT "parts_used_shopId_repairOrderId_fkey" FOREIGN KEY ("shopId", "repairOrderId") REFERENCES "repair_orders"("shopId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_templates" ADD CONSTRAINT "qc_templates_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_template_items" ADD CONSTRAINT "qc_template_items_shopId_qcTemplateId_fkey" FOREIGN KEY ("shopId", "qcTemplateId") REFERENCES "qc_templates"("shopId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_runs" ADD CONSTRAINT "qc_runs_shopId_repairOrderId_fkey" FOREIGN KEY ("shopId", "repairOrderId") REFERENCES "repair_orders"("shopId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_runs" ADD CONSTRAINT "qc_runs_shopId_qcTemplateId_fkey" FOREIGN KEY ("shopId", "qcTemplateId") REFERENCES "qc_templates"("shopId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_results" ADD CONSTRAINT "qc_results_shopId_qcRunId_fkey" FOREIGN KEY ("shopId", "qcRunId") REFERENCES "qc_runs"("shopId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_results" ADD CONSTRAINT "qc_results_shopId_qcTemplateItemId_fkey" FOREIGN KEY ("shopId", "qcTemplateItemId") REFERENCES "qc_template_items"("shopId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "handovers" ADD CONSTRAINT "handovers_shopId_repairOrderId_fkey" FOREIGN KEY ("shopId", "repairOrderId") REFERENCES "repair_orders"("shopId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_shopId_repairOrderId_fkey" FOREIGN KEY ("shopId", "repairOrderId") REFERENCES "repair_orders"("shopId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warranties" ADD CONSTRAINT "warranties_shopId_repairOrderId_fkey" FOREIGN KEY ("shopId", "repairOrderId") REFERENCES "repair_orders"("shopId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_shopId_repairOrderId_fkey" FOREIGN KEY ("shopId", "repairOrderId") REFERENCES "repair_orders"("shopId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public_access_tokens" ADD CONSTRAINT "public_access_tokens_shopId_repairOrderId_fkey" FOREIGN KEY ("shopId", "repairOrderId") REFERENCES "repair_orders"("shopId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public_access_tokens" ADD CONSTRAINT "public_access_tokens_shopId_quoteVersionId_fkey" FOREIGN KEY ("shopId", "quoteVersionId") REFERENCES "quote_versions"("shopId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_shopId_repairOrderId_fkey" FOREIGN KEY ("shopId", "repairOrderId") REFERENCES "repair_orders"("shopId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_outboxEventId_fkey" FOREIGN KEY ("outboxEventId") REFERENCES "outbox_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
