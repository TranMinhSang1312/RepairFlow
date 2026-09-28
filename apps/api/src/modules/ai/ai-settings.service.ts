/* eslint-disable @typescript-eslint/consistent-type-imports -- Nest needs runtime constructor tokens. */

import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import { AiCapability, Prisma } from "@prisma/client";

import { ApiException } from "../../common/api-exception.js";
import type { TenantContext } from "../../common/tenant/tenant-context.js";
import type { UpdateAiCapabilitySettingDto } from "./ai.dto.js";
import { AiRepository } from "./ai.repository.js";
import { AI_GLOBAL_ENABLED } from "./ai.tokens.js";
import { toAiSettingView, type AiSettingsResponse } from "./ai.types.js";

@Injectable()
export class AiSettingsService {
  constructor(
    private readonly repository: AiRepository,
    @Inject(AI_GLOBAL_ENABLED) private readonly globalEnabled: boolean,
  ) {}

  async list(tenant: TenantContext): Promise<AiSettingsResponse> {
    const records = await this.repository.listSettings(tenant.shopId);
    const byCapability = new Map(records.map((record) => [record.capability, record]));
    return {
      data: {
        globalEnabled: this.globalEnabled,
        capabilities: Object.values(AiCapability).map((capability) =>
          toAiSettingView(capability, byCapability.get(capability), this.globalEnabled),
        ),
      },
    };
  }

  async update(
    tenant: TenantContext,
    rawCapability: string,
    dto: UpdateAiCapabilitySettingDto,
  ): Promise<AiSettingsResponse> {
    const capability = this.capability(rawCapability);
    const monthlyBudgetMicrousd = BigInt(dto.monthlyBudgetMicrousd);
    const maxRunCostMicrousd = BigInt(dto.maxRunCostMicrousd);
    if (dto.enabled && (monthlyBudgetMicrousd <= 0n || maxRunCostMicrousd <= 0n)) {
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        "VALIDATION_FAILED",
        "Enabled AI capabilities require positive monthly and per-run budgets.",
      );
    }
    if (maxRunCostMicrousd > monthlyBudgetMicrousd) {
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        "VALIDATION_FAILED",
        "The per-run AI budget cannot exceed the monthly budget.",
      );
    }

    await this.repository.withTransaction(async (transaction) => {
      const current = await this.repository.lockSetting(transaction, tenant.shopId, capability);
      const currentVersion = current?.lockVersion ?? 0;
      if (currentVersion !== dto.expectedLockVersion) {
        throw new ApiException(
          HttpStatus.CONFLICT,
          "AI_SETTING_VERSION_CONFLICT",
          "The AI setting changed concurrently. Reload and try again.",
        );
      }
      const nextVersion = currentVersion + 1;
      const updated = current
        ? await transaction.aiCapabilitySetting.update({
            where: { shopId_capability: { shopId: tenant.shopId, capability } },
            data: {
              enabled: dto.enabled,
              monthlyBudgetMicrousd,
              maxRunCostMicrousd,
              updatedByUserId: tenant.userId,
              lockVersion: nextVersion,
            },
          })
        : await transaction.aiCapabilitySetting.create({
            data: {
              shopId: tenant.shopId,
              capability,
              enabled: dto.enabled,
              monthlyBudgetMicrousd,
              maxRunCostMicrousd,
              updatedByUserId: tenant.userId,
              lockVersion: nextVersion,
            },
          });
      await transaction.auditLog.create({
        data: {
          shopId: tenant.shopId,
          actorUserId: tenant.userId,
          action: "AI_CAPABILITY_SETTING_UPDATED",
          entityType: "AI_CAPABILITY_SETTING",
          entityId: `${tenant.shopId}:${capability}`,
          beforeData: current
            ? {
                enabled: current.enabled,
                monthlyBudgetMicrousd: current.monthlyBudgetMicrousd.toString(),
                maxRunCostMicrousd: current.maxRunCostMicrousd.toString(),
                lockVersion: current.lockVersion,
              }
            : Prisma.JsonNull,
          afterData: {
            enabled: updated.enabled,
            monthlyBudgetMicrousd: updated.monthlyBudgetMicrousd.toString(),
            maxRunCostMicrousd: updated.maxRunCostMicrousd.toString(),
            lockVersion: updated.lockVersion,
          },
          requestId: tenant.requestId,
        },
      });
    });
    return this.list(tenant);
  }

  private capability(value: string): AiCapability {
    if ((Object.values(AiCapability) as string[]).includes(value)) return value as AiCapability;
    throw new ApiException(HttpStatus.NOT_FOUND, "RESOURCE_NOT_FOUND", "Resource not found.");
  }
}
