/* eslint-disable @typescript-eslint/consistent-type-imports -- Nest needs runtime constructor tokens. */

import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import { AiCapability, MembershipRole, Prisma } from "@prisma/client";
import { redactAiInput } from "@repairflow/security";

import { ApiException } from "../../common/api-exception.js";
import { IdempotencyService } from "../../common/idempotency/idempotency.service.js";
import type { TenantContext } from "../../common/tenant/tenant-context.js";
import { AI_GLOBAL_ENABLED } from "./ai.tokens.js";
import type { AiRunResponse } from "./ai.types.js";

export interface EnqueueAiRunInput {
  tenant: TenantContext;
  capability: AiCapability;
  repairOrderId?: string;
  promptVersion: string;
  schemaVersion: string;
  inputReference: Record<string, unknown>;
  buildInputReference?: (transaction: Prisma.TransactionClient) => Promise<Record<string, unknown>>;
  upperBoundCostMicrousd: bigint;
  idempotencyKey: string | undefined;
}

interface StoredAiRunResponse {
  data: AiRunResponse["data"];
}

@Injectable()
export class AiEnqueueService {
  constructor(
    private readonly idempotency: IdempotencyService,
    @Inject(AI_GLOBAL_ENABLED) private readonly globalEnabled: boolean,
  ) {}

  enqueue(input: EnqueueAiRunInput): Promise<StoredAiRunResponse> {
    if (!this.globalEnabled) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        "AI_FEATURE_DISABLED",
        "AI assistance is disabled.",
      );
    }
    if (input.upperBoundCostMicrousd <= 0n) throw this.budgetExceeded();
    return this.idempotency.executeStored({
      tenant: input.tenant,
      scope: `ai.enqueue:${input.tenant.userId}:${input.capability}`,
      key: input.idempotencyKey,
      request: {
        capability: input.capability,
        repairOrderId: input.repairOrderId ?? null,
        promptVersion: input.promptVersion,
        schemaVersion: input.schemaVersion,
        // Idempotency persists only the digest of this request. Hash the exact source IDs so two
        // distinct server-owned source selections cannot collapse after generic redaction.
        inputReference: input.inputReference,
        upperBoundCostMicrousd: input.upperBoundCostMicrousd.toString(),
      },
      responseStatus: HttpStatus.ACCEPTED,
      onReplay: async (transaction) => this.assertRepairOrderAccess(transaction, input),
      operation: async (transaction) => {
        await this.assertRepairOrderAccess(transaction, input);
        const inputReference = this.safeJson(
          input.buildInputReference
            ? await input.buildInputReference(transaction)
            : input.inputReference,
        );
        const settingLockKey = `ai-setting:${input.tenant.shopId}:${input.capability}`;
        await transaction.$queryRaw`
          SELECT pg_advisory_xact_lock(hashtextextended(${settingLockKey}, 0))::text AS locked
        `;
        const setting = await transaction.aiCapabilitySetting.findUnique({
          where: {
            shopId_capability: {
              shopId: input.tenant.shopId,
              capability: input.capability,
            },
          },
        });
        if (!setting?.enabled) {
          throw new ApiException(
            HttpStatus.CONFLICT,
            "AI_FEATURE_DISABLED",
            "AI assistance is disabled for this capability.",
          );
        }
        if (
          input.upperBoundCostMicrousd > setting.maxRunCostMicrousd ||
          input.upperBoundCostMicrousd > setting.monthlyBudgetMicrousd
        ) {
          throw this.budgetExceeded();
        }
        const periodStart = this.periodStart(new Date());
        const lockKey = `ai-budget:${input.tenant.shopId}:${input.capability}:${periodStart.toISOString()}`;
        await transaction.$queryRaw`
          SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))::text AS locked
        `;
        await transaction.aiUsagePeriod.upsert({
          where: {
            shopId_capability_periodStart: {
              shopId: input.tenant.shopId,
              capability: input.capability,
              periodStart,
            },
          },
          update: {},
          create: {
            shopId: input.tenant.shopId,
            capability: input.capability,
            periodStart,
          },
        });
        const usage = await transaction.aiUsagePeriod.findUniqueOrThrow({
          where: {
            shopId_capability_periodStart: {
              shopId: input.tenant.shopId,
              capability: input.capability,
              periodStart,
            },
          },
        });
        if (
          usage.spentMicrousd + usage.reservedMicrousd + input.upperBoundCostMicrousd >
          setting.monthlyBudgetMicrousd
        ) {
          throw this.budgetExceeded();
        }
        const run = await transaction.aiRun.create({
          data: {
            shopId: input.tenant.shopId,
            ...(input.repairOrderId ? { repairOrderId: input.repairOrderId } : {}),
            capability: input.capability,
            promptVersion: input.promptVersion,
            schemaVersion: input.schemaVersion,
            inputReference,
            requestedByUserId: input.tenant.userId,
            reservedCostMicrousd: input.upperBoundCostMicrousd,
          },
        });
        await transaction.aiUsagePeriod.update({
          where: {
            shopId_capability_periodStart: {
              shopId: input.tenant.shopId,
              capability: input.capability,
              periodStart,
            },
          },
          data: {
            reservedMicrousd: { increment: input.upperBoundCostMicrousd },
            lockVersion: { increment: 1 },
          },
        });
        await transaction.outboxEvent.create({
          data: {
            shopId: input.tenant.shopId,
            eventType: "AI_RUN_REQUESTED_V1",
            aggregateType: "AI_RUN",
            aggregateId: run.id,
            payload: {
              schemaVersion: 1,
              aiRunId: run.id,
              shopId: input.tenant.shopId,
              capability: input.capability,
            },
          },
        });
        return {
          data: {
            id: run.id,
            capability: run.capability,
            status: run.status,
            promptVersion: run.promptVersion,
            schemaVersion: run.schemaVersion,
            output: null,
            confidence: null,
            errorCode: null,
            review: null,
            createdAt: run.createdAt.toISOString(),
            startedAt: null,
            completedAt: null,
          },
        };
      },
    });
  }

  private async assertRepairOrderAccess(
    transaction: Prisma.TransactionClient,
    input: EnqueueAiRunInput,
  ): Promise<void> {
    if (!input.repairOrderId && input.tenant.role !== MembershipRole.TECHNICIAN) return;
    if (!input.repairOrderId) throw this.notFound();
    const order = await transaction.repairOrder.findFirst({
      where: {
        shopId: input.tenant.shopId,
        id: input.repairOrderId,
        ...(input.tenant.role === MembershipRole.TECHNICIAN
          ? {
              assignments: {
                some: { technicianUserId: input.tenant.userId, unassignedAt: null },
              },
            }
          : {}),
      },
      select: { id: true },
    });
    if (!order) throw this.notFound();
  }

  private periodStart(now: Date): Date {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  }

  private safeJson(value: Record<string, unknown>): Prisma.InputJsonObject {
    const redacted = redactAiInput(value).value;
    return JSON.parse(JSON.stringify(redacted)) as Prisma.InputJsonObject;
  }

  private budgetExceeded(): ApiException {
    return new ApiException(
      HttpStatus.TOO_MANY_REQUESTS,
      "AI_BUDGET_EXCEEDED",
      "The AI budget for this capability has been exhausted.",
    );
  }

  private notFound(): ApiException {
    return new ApiException(HttpStatus.NOT_FOUND, "RESOURCE_NOT_FOUND", "Resource not found.");
  }
}
