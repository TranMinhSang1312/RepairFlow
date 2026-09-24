/* eslint-disable @typescript-eslint/consistent-type-imports -- Nest needs PrismaService at runtime for DI. */

import { HttpStatus, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";

import { PrismaService } from "../../infra/database/prisma.service.js";
import { ApiException } from "../api-exception.js";
import type { TenantContext } from "../tenant/tenant-context.js";

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

interface ExecuteIdempotentlyOptions<TResponse> {
  tenant: Pick<TenantContext, "shopId">;
  scope: string;
  key: string | undefined;
  request: unknown;
  responseStatus?: number;
  recordExpiresAt?: (response: TResponse) => Date;
  onReplay?: (transaction: Prisma.TransactionClient, response: TResponse) => Promise<void>;
  onExpiredReplay?: (transaction: Prisma.TransactionClient, response: TResponse) => Promise<never>;
  operation: (transaction: Prisma.TransactionClient) => Promise<TResponse>;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

@Injectable()
export class IdempotencyService {
  constructor(private readonly prisma: PrismaService) {}

  async execute<TResponse extends object>(
    options: ExecuteIdempotentlyOptions<TResponse>,
  ): Promise<TResponse> {
    return this.executeStored(options);
  }

  /**
   * Persists only the operation result supplied here. Callers that return secrets can store a
   * replay descriptor and reconstruct the secret response after this method returns.
   */
  async executeStored<TStored extends object>(
    options: ExecuteIdempotentlyOptions<TStored>,
  ): Promise<TStored> {
    const key = this.validatedKey(options.key);
    const keyHash = hash(key);
    const requestHash = hash(JSON.stringify(canonicalize(options.request)));

    try {
      return await this.prisma.$transaction(async (transaction) => {
        const lockKey = `${options.tenant.shopId}:${options.scope}:${keyHash}`;
        await transaction.$queryRaw`
          SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))::text AS locked
        `;

        const existing = await transaction.idempotencyRecord.findUnique({
          where: {
            shopId_scope_keyHash: {
              shopId: options.tenant.shopId,
              scope: options.scope,
              keyHash,
            },
          },
        });

        if (existing) {
          this.assertSameRequest(existing.requestHash, requestHash);
          const stored = existing.responseBody as TStored;
          if (existing.expiresAt > new Date()) {
            await options.onReplay?.(transaction, stored);
            return stored;
          }
          if (options.onExpiredReplay) {
            return options.onExpiredReplay(transaction, stored);
          }
          await transaction.idempotencyRecord.delete({ where: { id: existing.id } });
        }

        const response = await options.operation(transaction);
        const responseBody = JSON.parse(JSON.stringify(response)) as Prisma.InputJsonValue;
        await transaction.idempotencyRecord.create({
          data: {
            shopId: options.tenant.shopId,
            scope: options.scope,
            keyHash,
            requestHash,
            responseStatus: options.responseStatus ?? HttpStatus.CREATED,
            responseBody,
            expiresAt:
              options.recordExpiresAt?.(response) ?? new Date(Date.now() + IDEMPOTENCY_TTL_MS),
          },
        });
        return response;
      });
    } catch (error) {
      if (error instanceof ApiException) {
        throw error;
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const existing = await this.prisma.idempotencyRecord.findUnique({
          where: {
            shopId_scope_keyHash: {
              shopId: options.tenant.shopId,
              scope: options.scope,
              keyHash,
            },
          },
        });
        if (existing) {
          this.assertSameRequest(existing.requestHash, requestHash);
          const stored = existing.responseBody as TStored;
          if (existing.expiresAt <= new Date() && options.onExpiredReplay) {
            return this.prisma.$transaction((transaction) =>
              options.onExpiredReplay!(transaction, stored),
            );
          }
          if (existing.expiresAt > new Date()) {
            if (options.onReplay) {
              await this.prisma.$transaction((transaction) =>
                options.onReplay!(transaction, stored),
              );
            }
            return stored;
          }
        }
      }
      throw error;
    }
  }

  private validatedKey(key: string | undefined): string {
    if (!key || key.length < 16 || key.length > 128) {
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        "VALIDATION_FAILED",
        "One or more input fields are invalid.",
        [
          {
            field: "Idempotency-Key",
            code: !key ? "REQUIRED" : "INVALID_LENGTH",
            message: "Idempotency-Key must contain between 16 and 128 characters.",
          },
        ],
      );
    }
    return key;
  }

  private assertSameRequest(existingHash: string, requestHash: string): void {
    if (existingHash !== requestHash) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        "IDEMPOTENCY_KEY_REUSED",
        "The idempotency key was already used with a different request.",
      );
    }
  }
}
