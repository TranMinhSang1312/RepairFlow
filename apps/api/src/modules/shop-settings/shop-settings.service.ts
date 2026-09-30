/* eslint-disable @typescript-eslint/consistent-type-imports -- Nest needs constructor tokens at runtime for DI. */

import { HttpStatus, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { ApiException } from "../../common/api-exception.js";
import type { TenantContext } from "../../common/tenant/tenant-context.js";
import { PrismaService } from "../../infra/database/prisma.service.js";
import type {
  CreateBranchDto,
  UpdateBranchDto,
  UpdateShopSettingsDto,
} from "./shop-settings.dto.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class ShopSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async get(tenant: TenantContext) {
    const shop = await this.prisma.shop.findUnique({
      where: { id: tenant.shopId },
      include: { branches: { orderBy: [{ isActive: "desc" }, { name: "asc" }] } },
    });
    if (!shop) throw this.notFound();
    return { data: this.view(shop) };
  }

  async update(tenant: TenantContext, dto: UpdateShopSettingsDto) {
    if (dto.timezone) this.assertTimezone(dto.timezone);
    const response = await this.prisma.$transaction(async (tx) => {
      const current = await tx.shop.findUnique({ where: { id: tenant.shopId } });
      if (!current) throw this.notFound();
      if (current.lockVersion !== dto.expectedLockVersion) throw this.concurrent();
      const data = {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.timezone !== undefined ? { timezone: dto.timezone } : {}),
        ...(dto.contactPhone !== undefined ? { contactPhone: dto.contactPhone || null } : {}),
        ...(dto.orderCodePrefix !== undefined ? { orderCodePrefix: dto.orderCodePrefix } : {}),
        ...(dto.intakePhotoMinimum !== undefined
          ? { intakePhotoMinimum: dto.intakePhotoMinimum }
          : {}),
        ...(dto.defaultQuoteExpiryHours !== undefined
          ? { defaultQuoteExpiryHours: dto.defaultQuoteExpiryHours }
          : {}),
        ...(dto.defaultWarrantyTerms !== undefined
          ? { defaultWarrantyTerms: dto.defaultWarrantyTerms || null }
          : {}),
      };
      if (Object.keys(data).length === 0) throw this.emptyPatch();
      const changed = await tx.shop.updateMany({
        where: { id: tenant.shopId, lockVersion: dto.expectedLockVersion },
        data: { ...data, lockVersion: { increment: 1 } },
      });
      if (changed.count !== 1) throw this.concurrent();
      const updated = await tx.shop.findUniqueOrThrow({
        where: { id: tenant.shopId },
        include: { branches: { orderBy: [{ isActive: "desc" }, { name: "asc" }] } },
      });
      await this.audit(
        tx,
        tenant,
        "shop.settings_updated",
        "SHOP",
        updated.id,
        this.shopSnapshot(current),
        this.shopSnapshot(updated),
      );
      return updated;
    });
    return { data: this.view(response) };
  }

  async createBranch(tenant: TenantContext, dto: CreateBranchDto) {
    try {
      const branch = await this.prisma.$transaction(async (tx) => {
        const created = await tx.branch.create({
          data: { shopId: tenant.shopId, name: dto.name, address: dto.address || null },
        });
        await this.audit(
          tx,
          tenant,
          "branch.created",
          "BRANCH",
          created.id,
          null,
          this.branchView(created),
        );
        return created;
      });
      return { data: this.branchView(branch) };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ApiException(
          HttpStatus.CONFLICT,
          "BRANCH_NAME_ALREADY_EXISTS",
          "An active shop branch already uses this name.",
        );
      }
      throw error;
    }
  }

  async updateBranch(tenant: TenantContext, branchId: string, dto: UpdateBranchDto) {
    if (!UUID_PATTERN.test(branchId)) throw this.notFound();
    const id = branchId.toLowerCase();
    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        const current = await tx.branch.findFirst({ where: { id, shopId: tenant.shopId } });
        if (!current) throw this.notFound();
        if (current.lockVersion !== dto.expectedLockVersion) throw this.concurrent();
        const data = {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.address !== undefined ? { address: dto.address || null } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        };
        if (Object.keys(data).length === 0) throw this.emptyPatch();
        if (dto.isActive === false && current.isActive) {
          const activeCount = await tx.branch.count({
            where: { shopId: tenant.shopId, isActive: true },
          });
          if (activeCount <= 1) {
            throw new ApiException(
              HttpStatus.CONFLICT,
              "LAST_ACTIVE_BRANCH_REQUIRED",
              "At least one active branch is required.",
            );
          }
        }
        const changed = await tx.branch.updateMany({
          where: { id, shopId: tenant.shopId, lockVersion: dto.expectedLockVersion },
          data: { ...data, lockVersion: { increment: 1 } },
        });
        if (changed.count !== 1) throw this.concurrent();
        const next = await tx.branch.findFirstOrThrow({ where: { id, shopId: tenant.shopId } });
        await this.audit(
          tx,
          tenant,
          "branch.updated",
          "BRANCH",
          id,
          this.branchView(current),
          this.branchView(next),
        );
        return next;
      });
      return { data: this.branchView(updated) };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ApiException(
          HttpStatus.CONFLICT,
          "BRANCH_NAME_ALREADY_EXISTS",
          "A shop branch already uses this name.",
        );
      }
      throw error;
    }
  }

  private view(shop: Prisma.ShopGetPayload<{ include: { branches: true } }>) {
    return {
      id: shop.id,
      name: shop.name,
      timezone: shop.timezone,
      contactPhone: shop.contactPhone,
      orderCodePrefix: shop.orderCodePrefix,
      intakePhotoMinimum: shop.intakePhotoMinimum,
      defaultQuoteExpiryHours: shop.defaultQuoteExpiryHours,
      defaultWarrantyTerms: shop.defaultWarrantyTerms,
      lockVersion: shop.lockVersion,
      branches: shop.branches.map((branch) => this.branchView(branch)),
    };
  }

  private branchView(branch: {
    id: string;
    name: string;
    address: string | null;
    isActive: boolean;
    lockVersion: number;
  }) {
    return {
      id: branch.id,
      name: branch.name,
      address: branch.address,
      isActive: branch.isActive,
      lockVersion: branch.lockVersion,
    };
  }

  private shopSnapshot(shop: {
    name: string;
    timezone: string;
    contactPhone: string | null;
    orderCodePrefix: string;
    intakePhotoMinimum: number;
    defaultQuoteExpiryHours: number;
    defaultWarrantyTerms: string | null;
    lockVersion: number;
  }) {
    return {
      name: shop.name,
      timezone: shop.timezone,
      contactPhone: shop.contactPhone,
      orderCodePrefix: shop.orderCodePrefix,
      intakePhotoMinimum: shop.intakePhotoMinimum,
      defaultQuoteExpiryHours: shop.defaultQuoteExpiryHours,
      defaultWarrantyTerms: shop.defaultWarrantyTerms,
      lockVersion: shop.lockVersion,
    };
  }

  private audit(
    tx: Prisma.TransactionClient,
    tenant: TenantContext,
    action: string,
    entityType: string,
    entityId: string,
    beforeData: Prisma.InputJsonValue | null,
    afterData: Prisma.InputJsonValue | null,
  ) {
    return tx.auditLog.create({
      data: {
        shopId: tenant.shopId,
        actorUserId: tenant.userId,
        action,
        entityType,
        entityId,
        beforeData: beforeData ?? Prisma.JsonNull,
        afterData: afterData ?? Prisma.JsonNull,
        requestId: tenant.requestId,
      },
    });
  }

  private assertTimezone(value: string): void {
    try {
      new Intl.DateTimeFormat("en", { timeZone: value }).format();
    } catch {
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        "VALIDATION_FAILED",
        "One or more input fields are invalid.",
        [
          {
            field: "timezone",
            code: "INVALID_TIMEZONE",
            message: "timezone must be a valid IANA timezone",
          },
        ],
      );
    }
  }

  private emptyPatch(): ApiException {
    return new ApiException(
      HttpStatus.UNPROCESSABLE_ENTITY,
      "VALIDATION_FAILED",
      "At least one change is required.",
    );
  }

  private concurrent(): ApiException {
    return new ApiException(
      HttpStatus.CONFLICT,
      "CONCURRENT_UPDATE",
      "The settings changed concurrently. Reload and try again.",
    );
  }

  private notFound(): ApiException {
    return new ApiException(HttpStatus.NOT_FOUND, "RESOURCE_NOT_FOUND", "Resource not found.");
  }
}
