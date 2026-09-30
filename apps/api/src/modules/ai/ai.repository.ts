/* eslint-disable @typescript-eslint/consistent-type-imports -- Nest needs PrismaService at runtime for DI. */

import { Injectable } from "@nestjs/common";
import { AiCapability, MembershipRole, Prisma } from "@prisma/client";

import { PrismaService } from "../../infra/database/prisma.service.js";

export interface AiAnalyticsCursor {
  date: Date;
  capability: AiCapability;
}

export interface AiAnalyticsRecord {
  date: Date;
  capability: AiCapability;
  requestedCount: bigint;
  succeededCount: bigint;
  failedCount: bigint;
  reviewedCount: bigint;
  acceptedUnchangedCount: bigint;
  acceptedEditedCount: bigint;
  rejectedCount: bigint;
  p50LatencyMs: number | null;
  p95LatencyMs: number | null;
  inputTokens: bigint;
  outputTokens: bigint;
  estimatedCostMicrousd: bigint;
  averageEditDistancePermille: number | null;
  averageTimeSavedSeconds: number | null;
}

@Injectable()
export class AiRepository {
  constructor(private readonly prisma: PrismaService) {}

  listSettings(shopId: string) {
    return this.prisma.aiCapabilitySetting.findMany({
      where: { shopId },
      orderBy: { capability: "asc" },
    });
  }

  listUsagePeriods(shopId: string, periodStart: Date) {
    return this.prisma.aiUsagePeriod.findMany({ where: { shopId, periodStart } });
  }

  listAnalytics(input: {
    shopId: string;
    from: Date;
    toExclusive: Date;
    capability?: AiCapability;
    cursor: AiAnalyticsCursor | null;
    take: number;
  }): Promise<AiAnalyticsRecord[]> {
    const capability = input.capability
      ? Prisma.sql`AND "capability" = ${input.capability}::"AiCapability"`
      : Prisma.empty;
    const cursor = input.cursor
      ? Prisma.sql`AND (
          "date" < ${input.cursor.date}::date OR
          ("date" = ${input.cursor.date}::date AND "capability"::text > ${input.cursor.capability})
        )`
      : Prisma.empty;
    return this.prisma.$queryRaw<AiAnalyticsRecord[]>(Prisma.sql`
      WITH aggregate_rows AS (
        SELECT
          date_trunc('day', "createdAt" AT TIME ZONE 'UTC')::date AS "date",
          "capability",
          COUNT(*)::bigint AS "requestedCount",
          COUNT(*) FILTER (WHERE "status" IN ('SUCCEEDED', 'REJECTED'))::bigint AS "succeededCount",
          COUNT(*) FILTER (WHERE "status" = 'FAILED')::bigint AS "failedCount",
          COUNT(*) FILTER (WHERE "reviewOutcome" IS NOT NULL)::bigint AS "reviewedCount",
          COUNT(*) FILTER (WHERE "reviewOutcome" = 'ACCEPTED_UNCHANGED')::bigint AS "acceptedUnchangedCount",
          COUNT(*) FILTER (WHERE "reviewOutcome" = 'ACCEPTED_EDITED')::bigint AS "acceptedEditedCount",
          COUNT(*) FILTER (WHERE "reviewOutcome" = 'REJECTED')::bigint AS "rejectedCount",
          percentile_cont(0.5) WITHIN GROUP (ORDER BY "latencyMs")
            FILTER (WHERE "latencyMs" IS NOT NULL) AS "p50LatencyMs",
          percentile_cont(0.95) WITHIN GROUP (ORDER BY "latencyMs")
            FILTER (WHERE "latencyMs" IS NOT NULL) AS "p95LatencyMs",
          COALESCE(SUM("inputTokens"), 0)::bigint AS "inputTokens",
          COALESCE(SUM("outputTokens"), 0)::bigint AS "outputTokens",
          COALESCE(SUM("estimatedCostMicrousd"), 0)::bigint AS "estimatedCostMicrousd",
          ROUND(AVG("editDistancePermille"))::integer AS "averageEditDistancePermille",
          ROUND(AVG("timeSavedSeconds"))::integer AS "averageTimeSavedSeconds"
        FROM "ai_runs"
        WHERE "shopId" = ${input.shopId}::uuid
          AND "createdAt" >= ${input.from}
          AND "createdAt" < ${input.toExclusive}
          ${capability}
        GROUP BY 1, 2
      )
      SELECT * FROM aggregate_rows
      WHERE TRUE ${cursor}
      ORDER BY "date" DESC, "capability"::text ASC
      LIMIT ${input.take}
    `);
  }

  async withTransaction<T>(operation: (transaction: Prisma.TransactionClient) => Promise<T>) {
    return this.prisma.$transaction(operation);
  }

  async lockSetting(
    transaction: Prisma.TransactionClient,
    shopId: string,
    capability: AiCapability,
  ) {
    const lockKey = `ai-setting:${shopId}:${capability}`;
    await transaction.$queryRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))::text AS locked
    `;
    return transaction.aiCapabilitySetting.findUnique({
      where: { shopId_capability: { shopId, capability } },
    });
  }

  findRunForActor(
    shopId: string,
    runId: string,
    role: MembershipRole,
    userId: string,
    transaction: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    return transaction.aiRun.findFirst({
      where: {
        shopId,
        id: runId,
        ...(role === MembershipRole.TECHNICIAN
          ? {
              repairOrderId: { not: null },
              repairOrder: {
                assignments: { some: { technicianUserId: userId, unassignedAt: null } },
              },
            }
          : {}),
      },
    });
  }
}
