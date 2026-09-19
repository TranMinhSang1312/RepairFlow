/* eslint-disable @typescript-eslint/consistent-type-imports -- Nest needs constructor tokens at runtime for DI. */

import { HttpStatus, Injectable } from "@nestjs/common";
import type { Customer } from "@prisma/client";

import { ApiException } from "../../common/api-exception.js";
import { IdempotencyService } from "../../common/idempotency/idempotency.service.js";
import type { TenantContext } from "../../common/tenant/tenant-context.js";
import type { CreateCustomerDto, ListCustomersQueryDto } from "./customer.dto.js";
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
