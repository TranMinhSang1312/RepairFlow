/* eslint-disable @typescript-eslint/consistent-type-imports -- Nest needs constructor tokens at runtime. */

import { HttpStatus, Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";

import { ApiException } from "../../common/api-exception.js";
import type { TenantContext } from "../../common/tenant/tenant-context.js";
import { PrismaService } from "../../infra/database/prisma.service.js";
import type { ListAuditLogsQueryDto } from "./audit-logs.dto.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SENSITIVE_KEY =
  /(token|password|secret|credential|destination|payload|providerbody|rawtoken|apikey|authorization|cookie|objectkey)/iu;

function safeJson(value: Prisma.JsonValue | null | undefined): Prisma.JsonValue | null {
  if (value === undefined) return null;
  if (value === null) return null;
  if (Array.isArray(value)) return value.map((item) => safeJson(item)) as Prisma.JsonValue;
  if (typeof value === "object") {
    const result: Record<string, Prisma.JsonValue> = {};
    for (const [key, child] of Object.entries(value)) {
      if (SENSITIVE_KEY.test(key)) continue;
      result[key] = safeJson(child) as Prisma.JsonValue;
    }
    return result;
  }
  return value;
}

@Injectable()
export class AuditLogsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(tenant: TenantContext, query: ListAuditLogsQueryDto) {
    const cursor = query.cursor ? this.decodeCursor(query.cursor) : null;
    const where: Prisma.AuditLogWhereInput = {
      shopId: tenant.shopId,
      ...(query.action ? { action: query.action } : {}),
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.actorUserId && UUID_PATTERN.test(query.actorUserId)
        ? { actorUserId: query.actorUserId.toLowerCase() }
        : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
      ...(cursor
        ? {
            OR: [
              { createdAt: { lt: cursor.createdAt } },
              { createdAt: cursor.createdAt, id: { lt: cursor.id } },
            ],
          }
        : {}),
    };
    const rows = await this.prisma.auditLog.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
      select: {
        id: true,
        actorUserId: true,
        action: true,
        entityType: true,
        entityId: true,
        beforeData: true,
        afterData: true,
        requestId: true,
        createdAt: true,
      },
    });
    const data = rows.slice(0, query.limit).map((row) => this.view(row));
    const last = rows[query.limit - 1];
    return {
      data,
      meta: { nextCursor: rows.length > query.limit && last ? this.encodeCursor(last) : null },
    };
  }

  async detail(tenant: TenantContext, id: string) {
    if (!UUID_PATTERN.test(id)) throw this.notFound();
    const row = await this.prisma.auditLog.findFirst({
      where: { id: id.toLowerCase(), shopId: tenant.shopId },
      select: {
        id: true,
        actorUserId: true,
        action: true,
        entityType: true,
        entityId: true,
        beforeData: true,
        afterData: true,
        requestId: true,
        createdAt: true,
      },
    });
    if (!row) throw this.notFound();
    return { data: this.view(row) };
  }

  private view(row: {
    id: string;
    actorUserId: string | null;
    action: string;
    entityType: string;
    entityId: string;
    beforeData: Prisma.JsonValue | null;
    afterData: Prisma.JsonValue | null;
    requestId: string;
    createdAt: Date;
  }) {
    return {
      id: row.id,
      actorUserId: row.actorUserId,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      before: safeJson(row.beforeData),
      after: safeJson(row.afterData),
      requestId: row.requestId,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private encodeCursor(row: { id: string; createdAt: Date }): string {
    return Buffer.from(
      JSON.stringify({ id: row.id, createdAt: row.createdAt.toISOString() }),
    ).toString("base64url");
  }

  private decodeCursor(value: string): { id: string; createdAt: Date } {
    try {
      const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as {
        id?: unknown;
        createdAt?: unknown;
      };
      const date = typeof parsed.createdAt === "string" ? new Date(parsed.createdAt) : null;
      if (
        typeof parsed.id !== "string" ||
        !UUID_PATTERN.test(parsed.id) ||
        !date ||
        Number.isNaN(date.getTime())
      )
        throw new Error("invalid cursor");
      return { id: parsed.id.toLowerCase(), createdAt: date };
    } catch {
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        "VALIDATION_FAILED",
        "One or more input fields are invalid.",
        [{ field: "cursor", code: "INVALID_CURSOR", message: "cursor is invalid" }],
      );
    }
  }

  private notFound(): ApiException {
    return new ApiException(HttpStatus.NOT_FOUND, "RESOURCE_NOT_FOUND", "Resource not found.");
  }
}
