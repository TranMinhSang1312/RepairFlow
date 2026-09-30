/* eslint-disable @typescript-eslint/consistent-type-imports -- Nest needs constructor tokens at runtime for DI. */

import { HttpStatus, Injectable } from "@nestjs/common";
import { Prisma, type Customer } from "@prisma/client";

import { ApiException } from "../../common/api-exception.js";
import { IdempotencyService } from "../../common/idempotency/idempotency.service.js";
import type { TenantContext } from "../../common/tenant/tenant-context.js";
import { PrismaService } from "../../infra/database/prisma.service.js";
import type {
  CreateCustomerDto,
  ListCustomersQueryDto,
  UpdateCustomerDto,
} from "./customer.dto.js";
import type { CustomerCursor } from "./customers.repository.js";
import { CustomersRepository } from "./customers.repository.js";
import {
  type CustomerListResponse,
  type CustomerResponse,
  toCustomerView,
} from "./customer.types.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function normalizePhone(value: string): string {
  const trimmed = value.trim();
  const hasInternationalPrefix = trimmed.startsWith("+") || trimmed.startsWith("00");
  const digits = trimmed.replace(/\D/g, "");
  if (hasInternationalPrefix) {
    return `+${digits.replace(/^00/, "")}`;
  }
  if (digits.startsWith("0")) {
    return `+84${digits.slice(1)}`;
  }
  return digits;
}

@Injectable()
export class CustomersService {
  constructor(
    private readonly repository: CustomersRepository,
    private readonly idempotency: IdempotencyService,
    private readonly prisma: PrismaService,
  ) {}

  async list(tenant: TenantContext, query: ListCustomersQueryDto): Promise<CustomerListResponse> {
    const cursor = query.cursor ? this.decodeCursor(query.cursor) : null;
    const rawSearch = query.query?.trim();
    const phoneSearch = rawSearch ? normalizePhone(rawSearch) : "";
    const search = rawSearch
      ? { name: rawSearch, phone: phoneSearch.replace(/\D/g, "").length >= 3 ? phoneSearch : null }
      : null;
    const page = await this.repository.list(tenant, search, cursor);
    const last = page.customers.at(-1);

    return {
      data: page.customers.map(toCustomerView),
      meta: { nextCursor: page.hasMore && last ? this.encodeCursor(last) : null },
    };
  }

  create(
    tenant: TenantContext,
    dto: CreateCustomerDto,
    idempotencyKey: string | undefined,
  ): Promise<CustomerResponse> {
    const phoneNormalized = normalizePhone(dto.phone);
    if (phoneNormalized.replace(/\D/g, "").length < 8) {
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        "VALIDATION_FAILED",
        "One or more input fields are invalid.",
        [{ field: "phone", code: "INVALID_PHONE", message: "phone is invalid" }],
      );
    }
    const data = {
      name: dto.name,
      phoneRaw: dto.phone,
      phoneNormalized,
      email: dto.email?.toLowerCase() ?? null,
      notes: dto.notes ?? null,
    };

    return this.idempotency.execute({
      tenant,
      scope: "customers.create",
      key: idempotencyKey,
      request: data,
      operation: async (transaction) => ({
        data: toCustomerView(await this.repository.create(transaction, tenant, data)),
      }),
    });
  }

  async requireActiveCustomer(tenant: TenantContext, customerId: string): Promise<Customer> {
    if (!UUID_PATTERN.test(customerId)) {
      throw this.customerNotFound();
    }
    const customer = await this.repository.findActiveById(tenant, customerId);
    if (!customer) {
      throw this.customerNotFound();
    }
    return customer;
  }

  async update(
    tenant: TenantContext,
    customerId: string,
    dto: UpdateCustomerDto,
  ): Promise<CustomerResponse> {
    const id = this.validatedId(customerId);
    if (Object.values(dto).every((value) => value === undefined)) {
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        "VALIDATION_FAILED",
        "At least one change is required.",
      );
    }
    const phoneNormalized = dto.phone === undefined ? undefined : normalizePhone(dto.phone);
    if (phoneNormalized !== undefined && phoneNormalized.replace(/\D/g, "").length < 8) {
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        "VALIDATION_FAILED",
        "One or more input fields are invalid.",
        [{ field: "phone", code: "INVALID_PHONE", message: "phone is invalid" }],
      );
    }
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.customer.findFirst({
        where: { id, shopId: tenant.shopId, archivedAt: null },
      });
      if (!current) throw this.customerNotFound();
      const data: Prisma.CustomerUpdateInput = {};
      if (dto.name !== undefined) data.name = dto.name;
      if (dto.phone !== undefined && phoneNormalized !== undefined) {
        data.phoneRaw = dto.phone;
        data.phoneNormalized = phoneNormalized;
      }
      if (dto.email !== undefined) data.email = dto.email?.toLowerCase() || null;
      if (dto.notes !== undefined) data.notes = dto.notes || null;
      const updated = await tx.customer.update({ where: { id }, data });
      await this.audit(
        tx,
        tenant,
        "customer.updated",
        id,
        this.auditView(current),
        this.auditView(updated),
      );
      return { data: toCustomerView(updated) };
    });
  }

  async archive(tenant: TenantContext, customerId: string): Promise<CustomerResponse> {
    const id = this.validatedId(customerId);
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.customer.findFirst({
        where: { id, shopId: tenant.shopId, archivedAt: null },
      });
      if (!current) throw this.customerNotFound();
      const archivedAt = new Date();
      await tx.device.updateMany({
        where: { shopId: tenant.shopId, customerId: id, archivedAt: null },
        data: { archivedAt },
      });
      const updated = await tx.customer.update({ where: { id }, data: { archivedAt } });
      await this.audit(tx, tenant, "customer.archived", id, this.auditView(current), {
        ...this.auditView(updated),
        archivedAt: archivedAt.toISOString(),
      });
      return { data: toCustomerView(updated) };
    });
  }

  private validatedId(value: string): string {
    if (!UUID_PATTERN.test(value)) throw this.customerNotFound();
    return value.toLowerCase();
  }

  private audit(
    tx: Prisma.TransactionClient,
    tenant: TenantContext,
    action: string,
    entityId: string,
    beforeData: Prisma.InputJsonValue,
    afterData: Prisma.InputJsonValue,
  ) {
    return tx.auditLog.create({
      data: {
        shopId: tenant.shopId,
        actorUserId: tenant.userId,
        action,
        entityType: "CUSTOMER",
        entityId,
        beforeData,
        afterData,
        requestId: tenant.requestId,
      },
    });
  }

  private auditView(customer: Customer) {
    return {
      name: customer.name,
      phone: customer.phoneRaw,
      email: customer.email,
      notes: customer.notes,
      archivedAt: customer.archivedAt?.toISOString() ?? null,
    };
  }

  private encodeCursor(customer: Customer): string {
    return Buffer.from(
      JSON.stringify({ id: customer.id, createdAt: customer.createdAt.toISOString() }),
    ).toString("base64url");
  }

  private decodeCursor(value: string): CustomerCursor {
    try {
      const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as {
        id?: unknown;
        createdAt?: unknown;
      };
      const createdAt = typeof parsed.createdAt === "string" ? new Date(parsed.createdAt) : null;
      if (
        typeof parsed.id !== "string" ||
        !UUID_PATTERN.test(parsed.id) ||
        !createdAt ||
        Number.isNaN(createdAt.getTime())
      ) {
        throw new Error("Invalid cursor");
      }
      return { id: parsed.id, createdAt };
    } catch {
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        "VALIDATION_FAILED",
        "One or more input fields are invalid.",
        [{ field: "cursor", code: "INVALID_CURSOR", message: "cursor is invalid" }],
      );
    }
  }

  private customerNotFound(): ApiException {
    return new ApiException(HttpStatus.NOT_FOUND, "RESOURCE_NOT_FOUND", "Resource not found.");
  }
}
