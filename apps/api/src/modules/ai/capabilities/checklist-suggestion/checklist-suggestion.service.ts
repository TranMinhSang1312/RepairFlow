/* eslint-disable @typescript-eslint/consistent-type-imports -- Nest needs runtime metadata. */

import { HttpStatus, Injectable } from "@nestjs/common";
import { AiCapability } from "@prisma/client";
import {
  CHECKLIST_SUGGESTION_PROMPT_VERSION,
  CHECKLIST_SUGGESTION_SCHEMA_VERSION,
  normalizePlainText,
} from "@repairflow/contracts";
import { redactAiInput } from "@repairflow/security";

import { ApiException } from "../../../../common/api-exception.js";
import type { TenantContext } from "../../../../common/tenant/tenant-context.js";
import { AiEnqueueService } from "../../ai-enqueue.service.js";
import type { CreateChecklistSuggestionDto } from "./checklist-suggestion.dto.js";
import { ChecklistSuggestionRepository } from "./checklist-suggestion.repository.js";

const CHECKLIST_UPPER_BOUND_MICROUSD = 2_000n;
const CHECKLIST_CREDENTIAL =
  /(?:\bbearer\s+[a-z0-9._~+/=-]+|(?:password|passcode|mật\s*khẩu|api[_ -]?key|token|pin)\s*[:=]\s*\S+)/giu;
const CHECKLIST_PROMPT_INJECTION =
  /(?:ignore\s+(?:all\s+)?(?:previous|prior)\s+instructions?|system\s+prompt|developer\s+message)/iu;

@Injectable()
export class ChecklistSuggestionService {
  constructor(
    private readonly repository: ChecklistSuggestionRepository,
    private readonly enqueueService: AiEnqueueService,
  ) {}

  create(
    tenant: TenantContext,
    dto: CreateChecklistSuggestionDto,
    idempotencyKey: string | undefined,
  ) {
    const sourceIds = {
      repairOrderId: dto.repairOrderId.toLowerCase(),
      qcTemplateId: dto.qcTemplateId.toLowerCase(),
      phase: dto.phase,
    };
    return this.enqueueService.enqueue({
      tenant,
      capability: AiCapability.CHECKLIST_SUGGESTION,
      repairOrderId: sourceIds.repairOrderId,
      promptVersion: CHECKLIST_SUGGESTION_PROMPT_VERSION,
      schemaVersion: CHECKLIST_SUGGESTION_SCHEMA_VERSION,
      inputReference: sourceIds,
      serverOwnedInputReference: true,
      buildInputReference: async (transaction) => {
        const context = await this.repository.loadContext(transaction, tenant, sourceIds);
        if (!context || context.template.items.length === 0) throw this.notFound();
        const reportedProblem = sanitizeChecklistText(context.order.reportedProblem, 2_000);
        const allowedChecklistItems = context.template.items.map((item) => ({
          id: item.id,
          label: sanitizeChecklistText(item.label, 300),
          isRequired: item.isRequired,
          allowNa: item.allowNa,
        }));
        if (!reportedProblem || allowedChecklistItems.some((item) => !item.label)) {
          throw new ApiException(
            HttpStatus.UNPROCESSABLE_ENTITY,
            "AI_INPUT_PROHIBITED",
            "The order or template contains no safe checklist context.",
          );
        }
        return {
          phase: dto.phase,
          deviceType: context.order.device.type,
          reportedProblem,
          allowedChecklistItems,
        };
      },
      upperBoundCostMicrousd: CHECKLIST_UPPER_BOUND_MICROUSD,
      idempotencyKey,
    });
  }

  private notFound(): ApiException {
    return new ApiException(HttpStatus.NOT_FOUND, "RESOURCE_NOT_FOUND", "Resource not found.");
  }
}

export function sanitizeChecklistText(value: string, maxLength: number): string {
  const normalized = normalizePlainText(value).replace(CHECKLIST_CREDENTIAL, "[REDACTED]");
  if (CHECKLIST_PROMPT_INJECTION.test(normalized)) return "";
  const redacted = redactAiInput(normalized).value;
  return typeof redacted === "string"
    ? normalizePlainText(redacted).replaceAll("[REDACTED]", "").trim().slice(0, maxLength)
    : "";
}
