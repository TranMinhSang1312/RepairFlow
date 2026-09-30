/* eslint-disable @typescript-eslint/consistent-type-imports -- Nest needs runtime metadata. */

import { HttpStatus, Injectable } from "@nestjs/common";
import { AiCapability } from "@prisma/client";

import { ApiException } from "../../common/api-exception.js";
import type { TenantContext } from "../../common/tenant/tenant-context.js";
import type { AiAnalyticsQueryDto } from "./ai.dto.js";
import { AiRepository, type AiAnalyticsCursor } from "./ai.repository.js";
import type { AiAnalyticsResponse, AiAnalyticsView } from "./ai.types.js";

const DAY_MS = 86_400_000;
const MAX_RANGE_DAYS = 90;

@Injectable()
export class AiAnalyticsService {
  constructor(private readonly repository: AiRepository) {}

  async list(tenant: TenantContext, query: AiAnalyticsQueryDto): Promise<AiAnalyticsResponse> {
    const today = startOfUtcDay(new Date());
    const to = query.to ? parseDate(query.to, "to") : today;
    const from = query.from ? parseDate(query.from, "from") : new Date(to.getTime() - 29 * DAY_MS);
    const rangeDays = Math.floor((to.getTime() - from.getTime()) / DAY_MS) + 1;
    if (rangeDays < 1 || rangeDays > MAX_RANGE_DAYS) {
      throw validation("from", "Analytics date range must contain between 1 and 90 days.");
    }
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    const rows = await this.repository.listAnalytics({
      shopId: tenant.shopId,
      from,
      toExclusive: new Date(to.getTime() + DAY_MS),
      ...(query.capability ? { capability: query.capability } : {}),
      cursor,
      take: query.limit + 1,
    });
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const data = page.map(toView);
    const last = page.at(-1);
    return {
      data,
      meta: {
        nextCursor:
          hasMore && last
            ? encodeCursor({ date: asDate(last.date), capability: last.capability })
            : null,
      },
    };
  }
}

function toView(row: Awaited<ReturnType<AiRepository["listAnalytics"]>>[number]): AiAnalyticsView {
  return {
    date: formatDate(asDate(row.date)),
    capability: row.capability,
    requestedCount: Number(row.requestedCount),
    succeededCount: Number(row.succeededCount),
    failedCount: Number(row.failedCount),
    reviewedCount: Number(row.reviewedCount),
    acceptedUnchangedCount: Number(row.acceptedUnchangedCount),
    acceptedEditedCount: Number(row.acceptedEditedCount),
    rejectedCount: Number(row.rejectedCount),
    p50LatencyMs: nullableNumber(row.p50LatencyMs),
    p95LatencyMs: nullableNumber(row.p95LatencyMs),
    inputTokens: Number(row.inputTokens),
    outputTokens: Number(row.outputTokens),
    estimatedCostMicrousd: String(row.estimatedCostMicrousd),
    averageEditDistancePermille: nullableNumber(row.averageEditDistancePermille),
    averageTimeSavedSeconds: nullableNumber(row.averageTimeSavedSeconds),
  };
}

function parseDate(value: string, field: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) throw validation(field, "Date must use YYYY-MM-DD.");
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || formatDate(date) !== value) {
    throw validation(field, "Date is invalid.");
  }
  return date;
}

function decodeCursor(value: string): AiAnalyticsCursor {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as {
      date?: unknown;
      capability?: unknown;
    };
    if (
      typeof parsed.date !== "string" ||
      typeof parsed.capability !== "string" ||
      !(Object.values(AiCapability) as string[]).includes(parsed.capability)
    ) {
      throw new Error("invalid");
    }
    return {
      date: parseDate(parsed.date, "cursor"),
      capability: parsed.capability as AiCapability,
    };
  } catch {
    throw validation("cursor", "Cursor is invalid.", "INVALID_CURSOR");
  }
}

function encodeCursor(value: AiAnalyticsCursor): string {
  return Buffer.from(
    JSON.stringify({ date: formatDate(value.date), capability: value.capability }),
    "utf8",
  ).toString("base64url");
}

function startOfUtcDay(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(`${value}T00:00:00.000Z`);
}

function nullableNumber(value: number | null): number | null {
  return value === null ? null : Number(value);
}

function validation(field: string, message: string, code = "VALIDATION_FAILED"): ApiException {
  return new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "VALIDATION_FAILED", message, [
    { field, code, message },
  ]);
}
