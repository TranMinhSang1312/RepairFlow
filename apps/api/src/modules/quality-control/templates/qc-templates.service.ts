/* eslint-disable @typescript-eslint/consistent-type-imports -- Nest needs constructor tokens at runtime for DI. */

import { HttpStatus, Injectable } from "@nestjs/common";
import { MembershipRole, Prisma } from "@prisma/client";

import { ApiException } from "../../../common/api-exception.js";
import { IdempotencyService } from "../../../common/idempotency/idempotency.service.js";
import type { TenantContext } from "../../../common/tenant/tenant-context.js";
import type { CreateQcTemplateDto } from "./qc-template.dto.js";
import {
  toQcTemplateView,
  type QcTemplateListResponse,
  type QcTemplateResponse,
} from "./qc-template.types.js";
import { QcTemplatesRepository } from "./qc-templates.repository.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class QcTemplatesService {
  constructor(
    private readonly repository: QcTemplatesRepository,
    private readonly idempotency: IdempotencyService,
  ) {}

  async list(tenant: TenantContext, includeInactive: boolean): Promise<QcTemplateListResponse> {
    if (includeInactive && tenant.role !== MembershipRole.OWNER) {
      throw this.permissionDenied("Only owners can list inactive QC template history.");
    }
    const templates = await this.repository.list(tenant.shopId, includeInactive);
    return { data: templates.map(toQcTemplateView) };
  }

  async publish(
    tenant: TenantContext,
    dto: CreateQcTemplateDto,
    idempotencyKey: string | undefined,
  ): Promise<QcTemplateResponse> {
    const normalizedName = this.normalizeFamilyName(dto.name);
    this.assertUniquePositions(dto.items.map((item) => item.sortOrder));
    const request = {
      name: dto.name,
      normalizedName,
      items: dto.items.map((item) => ({
        label: item.label,
        isRequired: item.isRequired,
        allowNa: item.allowNa,
        sortOrder: item.sortOrder,
      })),
    };

    try {
      return await this.idempotency.execute({
        tenant,
        scope: "quality-control.templates.publish",
        key: idempotencyKey,
        request,
        operation: async (transaction) => {
          await this.repository.lockFamily(transaction, tenant.shopId, normalizedName);
          const previous = await this.repository.findActive(
            transaction,
            tenant.shopId,
            normalizedName,
          );
          const versionNo = await this.repository.allocateVersion(
            transaction,
            tenant.shopId,
            normalizedName,
          );
          await this.repository.deactivateFamily(transaction, tenant.shopId, normalizedName);
          const created = await this.repository.createVersion(transaction, {
            shopId: tenant.shopId,
            name: dto.name,
            normalizedName,
            versionNo,
            items: request.items,
          });
          await this.repository.appendAudit(transaction, {
            shopId: tenant.shopId,
            actorUserId: tenant.userId,
            action: "QC_TEMPLATE_PUBLISHED",
            entityId: created.id,
            requestId: tenant.requestId,
            beforeData: previous
              ? { id: previous.id, versionNo: previous.versionNo, isActive: previous.isActive }
              : Prisma.JsonNull,
            afterData: {
              id: created.id,
              name: created.name,
              normalizedName: created.normalizedName,
              versionNo: created.versionNo,
              isActive: created.isActive,
            },
          });
          return { data: toQcTemplateView(created) };
        },
      });
    } catch (error) {
      this.rethrowVersionConflict(error);
    }
  }

  async deactivate(
    tenant: TenantContext,
    qcTemplateId: string,
    idempotencyKey: string | undefined,
  ): Promise<QcTemplateResponse> {
    if (!UUID_PATTERN.test(qcTemplateId)) throw this.notFound();
    const id = qcTemplateId.toLowerCase();

    try {
      return await this.idempotency.execute({
        tenant,
        scope: "quality-control.templates.deactivate",
        key: idempotencyKey,
        request: { qcTemplateId: id },
        responseStatus: HttpStatus.OK,
        operation: async (transaction) => {
          const initial = await this.repository.findById(transaction, tenant.shopId, id);
          if (!initial) throw this.notFound();
          await this.repository.lockFamily(transaction, tenant.shopId, initial.normalizedName);
          const current = await this.repository.findById(transaction, tenant.shopId, id);
          if (!current) throw this.notFound();
          if (!current.isActive) {
            throw new ApiException(
              HttpStatus.CONFLICT,
              "QC_TEMPLATE_INACTIVE",
              "The QC template version is already inactive.",
            );
          }

          const updated = await this.repository.deactivateById(transaction, tenant.shopId, id);
          await this.repository.appendAudit(transaction, {
            shopId: tenant.shopId,
            actorUserId: tenant.userId,
            action: "QC_TEMPLATE_DEACTIVATED",
            entityId: updated.id,
            requestId: tenant.requestId,
            beforeData: { id: current.id, versionNo: current.versionNo, isActive: true },
            afterData: { id: updated.id, versionNo: updated.versionNo, isActive: false },
          });
          return { data: toQcTemplateView(updated) };
        },
      });
    } catch (error) {
      this.rethrowVersionConflict(error);
    }
  }

  private normalizeFamilyName(name: string): string {
    return name.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
  }

  private assertUniquePositions(positions: number[]): void {
    if (new Set(positions).size !== positions.length) {
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        "VALIDATION_FAILED",
        "One or more input fields are invalid.",
        [
          {
            field: "items.sortOrder",
            code: "DUPLICATE_POSITION",
            message: "Each template item must have a unique sortOrder.",
          },
        ],
      );
    }
  }

  private rethrowVersionConflict(error: unknown): never {
    if (error instanceof ApiException) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new ApiException(
        HttpStatus.CONFLICT,
        "QC_TEMPLATE_VERSION_CONFLICT",
        "The QC template family changed concurrently. Retry the request.",
      );
    }
    throw error;
  }

  private permissionDenied(message: string): ApiException {
    return new ApiException(HttpStatus.FORBIDDEN, "PERMISSION_DENIED", message);
  }

  private notFound(): ApiException {
    return new ApiException(HttpStatus.NOT_FOUND, "RESOURCE_NOT_FOUND", "Resource not found.");
  }
}
