/* eslint-disable @typescript-eslint/consistent-type-imports -- Nest needs constructor tokens at runtime for DI. */

import { HttpStatus, Injectable } from "@nestjs/common";
import {
  ActorType,
  MediaPurpose,
  MembershipRole,
  Prisma,
  QcItemResult,
  QcRunResult,
  RepairOrderStatus,
} from "@prisma/client";

import { ApiException } from "../../../common/api-exception.js";
import { IdempotencyService } from "../../../common/idempotency/idempotency.service.js";
import type { TenantContext } from "../../../common/tenant/tenant-context.js";
import { MediaUploadVerifier } from "../../media/media-upload-verifier.service.js";
import { RepairOrderStateMachineService } from "../../repair-orders/state-machine/repair-order-state-machine.service.js";
import type { CreateQcRunDto } from "./qc-run.dto.js";
import { toQcRunView, type QcRunResponse } from "./qc-run.types.js";
import { QcRunsRepository } from "./qc-runs.repository.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface NormalizedResult {
  qcTemplateItemId: string;
  result: QcItemResult;
  note: string | null;
  evidenceMediaAssetIds: string[];
}

@Injectable()
export class QcRunsService {
  constructor(
    private readonly repository: QcRunsRepository,
    private readonly idempotency: IdempotencyService,
    private readonly mediaVerifier: MediaUploadVerifier,
    private readonly stateMachine: RepairOrderStateMachineService,
  ) {}

  async submit(
    tenant: TenantContext,
    repairOrderId: string,
    dto: CreateQcRunDto,
    idempotencyKey: string | undefined,
  ): Promise<QcRunResponse> {
    if (!UUID_PATTERN.test(repairOrderId)) throw this.notFound();
    const orderId = repairOrderId.toLowerCase();
    const results = dto.results
      .map((result) => ({
        qcTemplateItemId: result.qcTemplateItemId,
        result: result.result,
        note: result.note?.trim() || null,
        evidenceMediaAssetIds: [...result.evidenceMediaAssetIds].sort((left, right) =>
          left.localeCompare(right),
        ),
      }))
      .sort((left, right) => left.qcTemplateItemId.localeCompare(right.qcTemplateItemId));
    this.assertNoDuplicateItemResults(results);
    this.assertNoDuplicateEvidence(results);
    const notes = dto.notes?.trim() || null;
    const request = {
      repairOrderId: orderId,
      qcTemplateId: dto.qcTemplateId,
      expectedLockVersion: dto.expectedLockVersion,
      notes,
      results,
    };

    try {
      return await this.idempotency.execute({
        tenant,
        scope: "quality-control.runs.submit",
        key: idempotencyKey,
        request,
        operation: async (transaction) => {
          await this.repository.lockOrder(transaction, tenant.shopId, orderId);
          const order = await this.repository.findOrder(transaction, tenant.shopId, orderId);
          if (!order || !this.actorCanSee(order.assignments[0]?.technicianUserId, tenant)) {
            throw this.notFound();
          }
          if (order.status !== RepairOrderStatus.QUALITY_CHECK) {
            throw new ApiException(
              HttpStatus.CONFLICT,
              "REPAIR_ORDER_GUARD_FAILED",
              "QC can only be submitted while the order is in quality check.",
            );
          }
          if (order.lockVersion !== dto.expectedLockVersion) {
            throw new ApiException(
              HttpStatus.CONFLICT,
              "CONCURRENT_UPDATE",
              "The repair order was changed by another request.",
            );
          }

          const template = await this.repository.findTemplate(
            transaction,
            tenant.shopId,
            dto.qcTemplateId,
          );
          if (!template) throw this.notFound();
          if (!template.isActive) {
            throw new ApiException(
              HttpStatus.CONFLICT,
              "QC_TEMPLATE_INACTIVE",
              "An inactive QC template cannot start a new run.",
            );
          }
          this.assertCompleteCoverage(template.items, results);
          const derivedResult = this.deriveResult(template.items, results);
          if (derivedResult === QcRunResult.FAIL && !notes) {
            throw new ApiException(
              HttpStatus.UNPROCESSABLE_ENTITY,
              "QC_FAILURE_NOTE_REQUIRED",
              "A failed QC run requires a non-blank failure note.",
              [{ field: "notes", code: "REQUIRED" }],
            );
          }

          const evidenceMediaAssetIds = results.flatMap((result) => result.evidenceMediaAssetIds);
          const now = new Date();
          if (evidenceMediaAssetIds.length > 0) {
            const media = await this.repository.findEvidence(
              transaction,
              tenant.shopId,
              evidenceMediaAssetIds,
            );
            if (
              media.length !== evidenceMediaAssetIds.length ||
              media.some(
                (asset) => asset.repairOrderId !== orderId || asset.purpose !== MediaPurpose.QC,
              )
            ) {
              throw this.notFound();
            }
            let complete: boolean[];
            try {
              complete = await Promise.all(
                media.map((asset) => this.mediaVerifier.isCompleteForOrder(asset, orderId, now)),
              );
            } catch {
              throw new ApiException(
                HttpStatus.SERVICE_UNAVAILABLE,
                "STORAGE_UNAVAILABLE",
                "The upload service is temporarily unavailable.",
              );
            }
            if (complete.some((value) => !value)) throw this.mediaIncomplete();
            const finalized = await this.repository.finalizeEvidence(transaction, {
              shopId: tenant.shopId,
              repairOrderId: orderId,
              mediaAssetIds: evidenceMediaAssetIds,
              now,
            });
            if (finalized.count !== evidenceMediaAssetIds.length) throw this.mediaIncomplete();
          }

          const run = await this.repository.createRun(transaction, {
            shopId: tenant.shopId,
            repairOrderId: orderId,
            qcTemplateId: template.id,
            runNo: await this.repository.allocateRunNo(transaction, tenant.shopId, orderId),
            result: derivedResult,
            notes,
            actorUserId: tenant.userId,
            results,
          });
          const transitionCommand = {
            shopId: tenant.shopId,
            repairOrderId: orderId,
            targetStatus:
              derivedResult === QcRunResult.FAIL
                ? RepairOrderStatus.REPAIRING
                : RepairOrderStatus.QUALITY_CHECK,
            completionOutcome: null,
            reason: derivedResult === QcRunResult.FAIL ? "QC failed" : null,
            expectedLockVersion: dto.expectedLockVersion,
            evidenceId: run.id,
            actor: { type: ActorType.USER, userId: tenant.userId, role: tenant.role },
            requestId: tenant.requestId,
          };
          const updatedOrder =
            derivedResult === QcRunResult.FAIL
              ? await this.stateMachine.transitionAfterQcFailure(transaction, transitionCommand)
              : await this.stateMachine.advanceAfterQcPass(transaction, transitionCommand);

          await this.repository.appendCompletedEvent(transaction, {
            shopId: tenant.shopId,
            repairOrderId: orderId,
            qcRunId: run.id,
            qcTemplateId: template.id,
            templateVersionNo: template.versionNo,
            runNo: run.runNo,
            result: derivedResult,
            evidenceCount: evidenceMediaAssetIds.length,
            actorUserId: tenant.userId,
            requestId: tenant.requestId,
          });
          return {
            data: {
              run: toQcRunView(run),
              orderStatus: updatedOrder.status,
              orderLockVersion: updatedOrder.lockVersion,
            },
          };
        },
      });
    } catch (error) {
      if (error instanceof ApiException) throw error;
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ApiException(
          HttpStatus.CONFLICT,
          "CONCURRENT_UPDATE",
          "The QC submission conflicted with another request.",
        );
      }
      throw error;
    }
  }

  private actorCanSee(assignedTechnicianUserId: string | undefined, tenant: TenantContext) {
    return tenant.role !== MembershipRole.TECHNICIAN || assignedTechnicianUserId === tenant.userId;
  }

  private assertNoDuplicateItemResults(results: NormalizedResult[]): void {
    const ids = results.map((result) => result.qcTemplateItemId);
    if (new Set(ids).size !== ids.length) throw this.incompleteResults("Duplicate item results.");
  }

  private assertNoDuplicateEvidence(results: NormalizedResult[]): void {
    const ids = results.flatMap((result) => result.evidenceMediaAssetIds);
    if (new Set(ids).size !== ids.length) {
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        "VALIDATION_FAILED",
        "One or more input fields are invalid.",
        [
          {
            field: "results.evidenceMediaAssetIds",
            code: "DUPLICATE_MEDIA",
            message: "An evidence media asset can be used only once.",
          },
        ],
      );
    }
  }

  private assertCompleteCoverage(
    templateItems: Array<{ id: string }>,
    results: NormalizedResult[],
  ): void {
    const templateIds = new Set(templateItems.map((item) => item.id));
    if (results.some((result) => !templateIds.has(result.qcTemplateItemId))) {
      throw this.notFound();
    }
    if (results.length !== templateItems.length) {
      throw this.incompleteResults("Results must cover every template item exactly once.");
    }
  }

  private deriveResult(
    templateItems: Array<{ id: string; isRequired: boolean; allowNa: boolean }>,
    results: NormalizedResult[],
  ): QcRunResult {
    const byItem = new Map(results.map((result) => [result.qcTemplateItemId, result]));
    let failed = false;
    for (const item of templateItems) {
      const result = byItem.get(item.id)!;
      if (result.result === QcItemResult.NOT_APPLICABLE && !item.allowNa) {
        throw this.incompleteResults("NOT_APPLICABLE is not allowed for this template item.");
      }
      if (
        result.result === QcItemResult.FAIL ||
        (item.isRequired && result.result !== QcItemResult.PASS)
      ) {
        failed = true;
      }
    }
    return failed ? QcRunResult.FAIL : QcRunResult.PASS;
  }

  private incompleteResults(message: string): ApiException {
    return new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "QC_RESULTS_INCOMPLETE", message);
  }

  private mediaIncomplete(): ApiException {
    return new ApiException(
      HttpStatus.CONFLICT,
      "MEDIA_UPLOAD_INCOMPLETE",
      "One or more QC evidence uploads are incomplete or expired.",
    );
  }

  private notFound(): ApiException {
    return new ApiException(HttpStatus.NOT_FOUND, "RESOURCE_NOT_FOUND", "Resource not found.");
  }
}
