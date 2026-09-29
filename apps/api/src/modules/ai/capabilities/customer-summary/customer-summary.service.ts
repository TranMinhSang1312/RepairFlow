/* eslint-disable @typescript-eslint/consistent-type-imports -- Nest needs runtime constructor tokens. */

import { HttpStatus, Injectable } from "@nestjs/common";
import { AiCapability } from "@prisma/client";
import {
  CUSTOMER_SUMMARY_PROMPT_VERSION,
  CUSTOMER_SUMMARY_SCHEMA_VERSION,
  type CustomerSummaryFact,
} from "@repairflow/contracts";
import { redactAiInput } from "@repairflow/security";

import { ApiException } from "../../../../common/api-exception.js";
import type { TenantContext } from "../../../../common/tenant/tenant-context.js";
import { AiEnqueueService } from "../../ai-enqueue.service.js";
import type { CreateCustomerSummaryDto } from "./customer-summary.dto.js";
import { CustomerSummaryRepository } from "./customer-summary.repository.js";

const CUSTOMER_SUMMARY_UPPER_BOUND_MICROUSD = 2_000n;
const URL = /https?:\/\/\S+|www\.\S+/giu;
const HTML = /<[^>]*>/gu;
const LABELED_CREDENTIAL =
  /\b(?:mật khẩu|password|passcode|mã khóa|mã mở khóa|unlock(?:\s+code)?|pin\s*code)\b\s*[:=]?\s*[^\s,;.]{1,64}/giu;
const NUMERIC_PIN = /\bpin\b\s*[:=]\s*\d{3,12}/giu;
const COST_FRAGMENT =
  /(?:giá|chi phí|đơn giá|internal cost|unit cost)\s*[:=]?\s*(?:\$\s*)?\d[\d.,]*\s*(?:vnd|đ|₫|đồng|usd)?/giu;
const MONEY = /(?:\$\s*\d[\d.,]*|\b\d[\d.,]*\s*(?:vnd|đ|₫|đồng|usd)\b)/giu;

@Injectable()
export class CustomerSummaryService {
  constructor(
    private readonly repository: CustomerSummaryRepository,
    private readonly enqueueService: AiEnqueueService,
  ) {}

  async create(
    tenant: TenantContext,
    dto: CreateCustomerSummaryDto,
    idempotencyKey: string | undefined,
  ) {
    if (!dto.diagnosisId && dto.workLogIds.length === 0) {
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        "VALIDATION_FAILED",
        "At least one diagnosis or work log source is required.",
      );
    }
    const sourceIds = {
      repairOrderId: dto.repairOrderId,
      ...(dto.diagnosisId ? { diagnosisId: dto.diagnosisId } : {}),
      workLogIds: [...dto.workLogIds].sort(),
    };

    return this.enqueueService.enqueue({
      tenant,
      capability: AiCapability.CUSTOMER_SUMMARY,
      repairOrderId: dto.repairOrderId,
      promptVersion: CUSTOMER_SUMMARY_PROMPT_VERSION,
      schemaVersion: CUSTOMER_SUMMARY_SCHEMA_VERSION,
      inputReference: { ...sourceIds, tone: dto.tone, maxCharacters: dto.maxCharacters },
      buildInputReference: async (transaction) => {
        const sources = await this.repository.loadSources(transaction, tenant, sourceIds);
        if (!sources) throw this.notFound();
        const facts: CustomerSummaryFact[] = [];
        if (sources.diagnosis) {
          this.addFact(facts, "diagnosis-finding", "DIAGNOSIS_FINDING", sources.diagnosis.finding);
          this.addFact(
            facts,
            "diagnosis-recommendation",
            "DIAGNOSIS_RECOMMENDATION",
            sources.diagnosis.recommendation,
          );
        }
        for (const [index, workLog] of sources.workLogs.entries()) {
          this.addFact(facts, `work-log-${index + 1}`, "WORK_LOG", workLog.content);
        }
        if (facts.length === 0) {
          throw new ApiException(
            HttpStatus.UNPROCESSABLE_ENTITY,
            "VALIDATION_FAILED",
            "The selected sources contain no customer-safe facts.",
          );
        }
        return { tone: dto.tone, maxCharacters: dto.maxCharacters, facts };
      },
      upperBoundCostMicrousd: CUSTOMER_SUMMARY_UPPER_BOUND_MICROUSD,
      idempotencyKey,
    });
  }

  private addFact(
    target: CustomerSummaryFact[],
    id: string,
    kind: CustomerSummaryFact["kind"],
    rawText: string,
  ): void {
    const text = sanitizeCustomerSummaryFact(rawText);
    if (text) target.push({ id, kind, text });
  }

  private notFound(): ApiException {
    return new ApiException(HttpStatus.NOT_FOUND, "RESOURCE_NOT_FOUND", "Resource not found.");
  }
}

export function sanitizeCustomerSummaryFact(rawText: string): string {
  const normalized = rawText
    .normalize("NFKC")
    .replace(HTML, " ")
    .replace(URL, "[REDACTED]")
    .replace(LABELED_CREDENTIAL, "[REDACTED]")
    .replace(NUMERIC_PIN, "[REDACTED]")
    .replace(COST_FRAGMENT, "[REDACTED_COST]")
    .replace(MONEY, "[REDACTED_COST]")
    .split("")
    .map((character) => {
      const code = character.charCodeAt(0);
      return code <= 8 || code === 11 || code === 12 || (code >= 14 && code <= 31) || code === 127
        ? " "
        : character;
    })
    .join("")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 2000);
  const redacted = redactAiInput(normalized).value;
  return typeof redacted === "string"
    ? redacted
        .replace(/\[REDACTED(?:_COST)?\]/gu, " ")
        .replace(/(?:\s*[,;]){2,}/gu, ";")
        .replace(/\s+/gu, " ")
        .trim()
        .slice(0, 2000)
    : "";
}
