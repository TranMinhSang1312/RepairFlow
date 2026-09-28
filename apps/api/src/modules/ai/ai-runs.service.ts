/* eslint-disable @typescript-eslint/consistent-type-imports -- Nest needs runtime constructor tokens. */

import { HttpStatus, Injectable } from "@nestjs/common";
import { AiReviewOutcome, AiRunStatus } from "@prisma/client";
import {
  isValidAiOutput,
  normalizedEditDistancePermille,
  type AiCapabilityName,
} from "@repairflow/contracts";

import { ApiException } from "../../common/api-exception.js";
import type { TenantContext } from "../../common/tenant/tenant-context.js";
import type { ReviewAiRunDto } from "./ai.dto.js";
import { AiRepository } from "./ai.repository.js";
import { toAiRunView, type AiRunResponse } from "./ai.types.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

@Injectable()
export class AiRunsService {
  constructor(private readonly repository: AiRepository) {}

  async get(tenant: TenantContext, rawRunId: string): Promise<AiRunResponse> {
    const runId = this.runId(rawRunId);
    const run = await this.repository.findRunForActor(
      tenant.shopId,
      runId,
      tenant.role,
      tenant.userId,
    );
    if (!run) throw this.notFound();
    return { data: toAiRunView(run) };
  }

  async review(
    tenant: TenantContext,
    rawRunId: string,
    dto: ReviewAiRunDto,
  ): Promise<AiRunResponse> {
    const runId = this.runId(rawRunId);
    const updated = await this.repository.withTransaction(async (transaction) => {
      const run = await this.repository.findRunForActor(
        tenant.shopId,
        runId,
        tenant.role,
        tenant.userId,
        transaction,
      );
      if (!run) throw this.notFound();
      if (run.reviewOutcome || run.status === AiRunStatus.REJECTED) {
        throw new ApiException(
          HttpStatus.CONFLICT,
          "AI_DRAFT_ALREADY_APPLIED",
          "This AI draft has already been reviewed.",
        );
      }
      if (run.status !== AiRunStatus.SUCCEEDED || run.output === null) {
        throw new ApiException(
          HttpStatus.CONFLICT,
          "AI_RUN_NOT_REVIEWABLE",
          "Only a successful AI draft can be reviewed.",
        );
      }

      const accepted = dto.outcome !== AiReviewOutcome.REJECTED;
      if (!accepted && (dto.reviewedOutput !== undefined || dto.timeSavedSeconds !== undefined)) {
        throw this.invalidReview("Rejected drafts cannot include reviewed output or time saved.");
      }
      if (accepted && !isValidAiOutput(run.capability as AiCapabilityName, dto.reviewedOutput)) {
        throw this.invalidReview("reviewedOutput does not match the capability schema.");
      }
      const editDistance = accepted
        ? normalizedEditDistancePermille(run.output, dto.reviewedOutput)
        : null;
      if (dto.outcome === AiReviewOutcome.ACCEPTED_UNCHANGED && editDistance !== 0) {
        throw this.invalidReview("ACCEPTED_UNCHANGED requires output with no edits.");
      }
      if (dto.outcome === AiReviewOutcome.ACCEPTED_EDITED && editDistance === 0) {
        throw this.invalidReview("ACCEPTED_EDITED requires at least one edit.");
      }

      const now = new Date();
      const result = await transaction.aiRun.updateMany({
        where: {
          shopId: tenant.shopId,
          id: run.id,
          status: AiRunStatus.SUCCEEDED,
          reviewOutcome: null,
        },
        data: {
          status: accepted ? AiRunStatus.SUCCEEDED : AiRunStatus.REJECTED,
          reviewOutcome: dto.outcome,
          reviewedByUserId: tenant.userId,
          reviewedAt: now,
          editDistancePermille: editDistance,
          timeSavedSeconds: accepted ? (dto.timeSavedSeconds ?? null) : null,
          acceptedByUserId: accepted ? tenant.userId : null,
          acceptedAt: accepted ? now : null,
        },
      });
      if (result.count !== 1) {
        throw new ApiException(
          HttpStatus.CONFLICT,
          "AI_DRAFT_ALREADY_APPLIED",
          "This AI draft has already been reviewed.",
        );
      }
      return transaction.aiRun.findUniqueOrThrow({ where: { id: run.id } });
    });
    return { data: toAiRunView(updated) };
  }

  private runId(value: string): string {
    if (!UUID_PATTERN.test(value)) throw this.notFound();
    return value.toLowerCase();
  }

  private invalidReview(message: string): ApiException {
    return new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "VALIDATION_FAILED", message);
  }

  private notFound(): ApiException {
    return new ApiException(HttpStatus.NOT_FOUND, "RESOURCE_NOT_FOUND", "Resource not found.");
  }
}
