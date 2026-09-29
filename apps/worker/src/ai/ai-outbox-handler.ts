import {
  AiRunStatus,
  MembershipRole,
  MembershipStatus,
  Prisma,
  UserStatus,
  type AiRun,
  type PrismaClient,
} from "@prisma/client";
import { AI_CAPABILITIES, type AiCapabilityName } from "@repairflow/contracts";
import { redactAiInput } from "@repairflow/security";

import type { ClaimedOutboxEvent } from "../outbox/outbox.types.js";
import type { AiCapabilityDefinition, AiCapabilityRegistry } from "./ai-capability-registry.js";
import { isAiGatewayError } from "./ai-errors.js";
import type { AiGateway, AiGatewayResult, AiGatewayUsage } from "./ai-gateway.js";
import { AI_RUN_REQUESTED_EVENT } from "./ai-outbox-repository.js";
import type { AiPriceCalculator } from "./ai-price-calculator.js";
import type { CircuitBreaker } from "./circuit-breaker.js";
import {
  DeviceOcrMediaError,
  type DeviceOcrMediaLoader,
  type LoadedDeviceOcrImage,
} from "./capabilities/device-ocr/device-ocr-media-loader.js";

export interface AiOutboxHandlerOptions {
  globalEnabled: boolean;
  timeoutMs: number;
  maxOutputBytes: number;
}

interface PreparedAiRun {
  id: string;
  shopId: string;
  capability: AiCapabilityName;
  promptVersion: string;
  schemaVersion: string;
  inputReference: Prisma.JsonValue;
  requestedByUserId: string;
  repairOrderId: string | null;
  reservedCostMicrousd: bigint;
  createdAt: Date;
  definition: AiCapabilityDefinition;
}

interface TerminalUpdate {
  status: "SUCCEEDED" | "FAILED";
  errorCode: string | null;
  output: Prisma.InputJsonValue | null;
  confidence: number | null;
  provider: string | null;
  model: string | null;
  usage: AiGatewayUsage | null;
  chargeMicrousd: bigint;
  priceTableVersion: string | null;
  latencyMs: number | null;
}

type PrepareResult = { kind: "PROCESS"; run: PreparedAiRun } | { kind: "DONE" };

/**
 * Executes one already-claimed AI outbox event. Provider failures become a terminal AiRun and
 * resolve normally so the outer outbox processor can complete the event. Only persistence
 * failures escape this boundary.
 */
export class AiOutboxHandler {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly gateway: AiGateway,
    private readonly registry: AiCapabilityRegistry,
    private readonly priceCalculator: AiPriceCalculator,
    private readonly circuitBreaker: CircuitBreaker,
    private readonly options: AiOutboxHandlerOptions,
    private readonly deviceOcrMediaLoader?: DeviceOcrMediaLoader,
  ) {}

  async handle(event: ClaimedOutboxEvent, now: Date): Promise<void> {
    const payload = parseEvent(event);
    if (!payload) {
      await this.failByAggregate(event, now, "AI_OUTPUT_INVALID");
      return;
    }

    const prepared = await this.prepareRun(event, payload.capability, now);
    if (prepared.kind === "DONE") return;
    const { run } = prepared;
    const sanitizedInput = redactAiInput(run.inputReference).value;
    let providerInput = sanitizedInput;
    let loadedImage: LoadedDeviceOcrImage | undefined;
    if (run.capability === "DEVICE_OCR") {
      const reference = parseDeviceOcrReference(run.inputReference);
      if (!reference || !this.deviceOcrMediaLoader) {
        await this.finalizeRun(run, now, failed("AI_MEDIA_UNAVAILABLE"));
        return;
      }
      try {
        loadedImage = await this.deviceOcrMediaLoader.load({
          shopId: run.shopId,
          mediaAssetId: reference.mediaAssetId,
          repairOrderId: run.repairOrderId,
          now,
        });
      } catch (error) {
        const code = error instanceof DeviceOcrMediaError ? error.code : "AI_MEDIA_UNAVAILABLE";
        await this.finalizeRun(run, now, failed(code));
        return;
      }
      providerInput = { allowedFields: reference.allowedFields };
    }

    let permit;
    try {
      permit = this.circuitBreaker.acquire();
    } catch (error) {
      loadedImage?.dispose();
      await this.finalizeGatewayFailure(run, error, now);
      return;
    }

    let result: AiGatewayResult;
    try {
      try {
        result = await this.gateway.generate({
          capability: run.capability,
          promptVersion: run.promptVersion,
          schemaVersion: run.schemaVersion,
          systemPrompt: run.definition.systemPrompt,
          input: providerInput,
          ...(loadedImage ? { images: [loadedImage.image] } : {}),
          outputSchema: run.definition.outputSchema,
          timeoutMs: this.options.timeoutMs,
          maxOutputBytes: this.options.maxOutputBytes,
        });
      } finally {
        loadedImage?.dispose();
        loadedImage = undefined;
      }
      permit.success();
    } catch (error) {
      if (shouldOpenCircuit(error)) permit.failure();
      else permit.success();
      await this.finalizeGatewayFailure(run, error, now);
      return;
    }

    const normalizedOutput = run.definition.normalizeOutput
      ? run.definition.normalizeOutput(result.output, providerInput)
      : result.output;
    const cost = this.safeCost(result.provider, result.model, result.usage);
    if (!cost || !run.definition.validateOutput(normalizedOutput, providerInput)) {
      await this.finalizeRun(run, now, {
        status: "FAILED",
        errorCode: "AI_OUTPUT_INVALID",
        output: null,
        confidence: null,
        provider: result.provider,
        model: result.model,
        usage: result.usage,
        chargeMicrousd: cost?.estimatedCostMicrousd ?? run.reservedCostMicrousd,
        priceTableVersion: cost?.priceTableVersion ?? null,
        latencyMs: boundedMetric(result.latencyMs),
      });
      return;
    }

    const output = toJsonValue(normalizedOutput);
    if (!output) {
      await this.finalizeRun(run, now, {
        status: "FAILED",
        errorCode: "AI_OUTPUT_INVALID",
        output: null,
        confidence: null,
        provider: result.provider,
        model: result.model,
        usage: result.usage,
        chargeMicrousd: cost.estimatedCostMicrousd,
        priceTableVersion: cost.priceTableVersion,
        latencyMs: boundedMetric(result.latencyMs),
      });
      return;
    }

    await this.finalizeRun(run, now, {
      status: "SUCCEEDED",
      errorCode: null,
      output,
      confidence: run.definition.confidence(normalizedOutput),
      provider: result.provider,
      model: result.model,
      usage: result.usage,
      chargeMicrousd: cost.estimatedCostMicrousd,
      priceTableVersion: cost.priceTableVersion,
      latencyMs: boundedMetric(result.latencyMs),
    });
  }

  private async prepareRun(
    event: ClaimedOutboxEvent,
    eventCapability: AiCapabilityName,
    now: Date,
  ): Promise<PrepareResult> {
    return this.prisma.$transaction(async (transaction) => {
      await lockRun(transaction, event.shopId, event.aggregateId);
      const run = await transaction.aiRun.findFirst({
        where: { id: event.aggregateId, shopId: event.shopId },
      });
      if (!run) return { kind: "DONE" };
      if (isTerminal(run.status)) return { kind: "DONE" };

      if (run.status === AiRunStatus.RUNNING) {
        await this.finalizeWithinTransaction(transaction, run, now, {
          status: "FAILED",
          errorCode: "AI_PROVIDER_OUTCOME_UNKNOWN",
          output: null,
          confidence: null,
          provider: run.provider ?? this.gateway.provider,
          model: run.model ?? this.gateway.model,
          usage: null,
          chargeMicrousd: run.reservedCostMicrousd,
          priceTableVersion: run.priceTableVersion,
          latencyMs: null,
        });
        return { kind: "DONE" };
      }

      const capability = asCapability(run.capability);
      const definition = capability
        ? this.registry.resolve(capability, run.promptVersion, run.schemaVersion)
        : null;
      const setting = capability
        ? await transaction.aiCapabilitySetting.findUnique({
            where: {
              shopId_capability: { shopId: run.shopId, capability: run.capability },
            },
            select: { enabled: true },
          })
        : null;

      if (capability !== eventCapability || !definition || event.aggregateType !== "AI_RUN") {
        await this.finalizeWithinTransaction(transaction, run, now, failed("AI_OUTPUT_INVALID"));
        return { kind: "DONE" };
      }
      if (!this.options.globalEnabled || !setting?.enabled) {
        await this.finalizeWithinTransaction(transaction, run, now, failed("AI_FEATURE_DISABLED"));
        return { kind: "DONE" };
      }

      const membership = await transaction.shopMembership.findUnique({
        where: {
          shopId_userId: { shopId: run.shopId, userId: run.requestedByUserId },
        },
        select: {
          role: true,
          status: true,
          user: { select: { status: true } },
        },
      });
      const activeActor =
        membership?.status === MembershipStatus.ACTIVE &&
        membership.user.status === UserStatus.ACTIVE;
      const assignedTechnician =
        membership?.role !== MembershipRole.TECHNICIAN ||
        (Boolean(run.repairOrderId) &&
          Boolean(
            await transaction.assignment.findFirst({
              where: {
                shopId: run.shopId,
                repairOrderId: run.repairOrderId!,
                technicianUserId: run.requestedByUserId,
                unassignedAt: null,
              },
              select: { id: true },
            }),
          ));
      if (!activeActor || !assignedTechnician) {
        await this.finalizeWithinTransaction(
          transaction,
          run,
          now,
          failed("AI_AUTHORIZATION_REVOKED"),
        );
        return { kind: "DONE" };
      }

      const started = await transaction.aiRun.updateMany({
        where: { id: run.id, shopId: run.shopId, status: AiRunStatus.QUEUED },
        data: {
          status: AiRunStatus.RUNNING,
          provider: this.gateway.provider,
          model: this.gateway.model,
          startedAt: now,
          errorCode: null,
        },
      });
      if (started.count !== 1) throw new Error("AI_RUN_CLAIM_LOST");

      return {
        kind: "PROCESS",
        run: {
          id: run.id,
          shopId: run.shopId,
          capability,
          promptVersion: run.promptVersion,
          schemaVersion: run.schemaVersion,
          inputReference: run.inputReference,
          requestedByUserId: run.requestedByUserId,
          repairOrderId: run.repairOrderId,
          reservedCostMicrousd: run.reservedCostMicrousd,
          createdAt: run.createdAt,
          definition,
        },
      };
    });
  }

  private async finalizeGatewayFailure(
    run: PreparedAiRun,
    error: unknown,
    now: Date,
  ): Promise<void> {
    if (!isAiGatewayError(error)) {
      await this.finalizeRun(run, now, {
        ...failed("AI_PROVIDER_OUTCOME_UNKNOWN"),
        provider: this.gateway.provider,
        model: this.gateway.model,
        chargeMicrousd: run.reservedCostMicrousd,
      });
      return;
    }

    const outcomeUnknown = error.outcome === "UNKNOWN";
    const usage = error.usage ?? null;
    const cost = usage
      ? this.safeCost(error.provider, error.model ?? this.gateway.model, usage)
      : null;
    const outputInvalid =
      error.code === "AI_PROVIDER_INVALID_RESPONSE" ||
      error.code === "AI_PROVIDER_RESPONSE_TOO_LARGE";
    await this.finalizeRun(run, now, {
      status: "FAILED",
      errorCode: outputInvalid
        ? "AI_OUTPUT_INVALID"
        : outcomeUnknown
          ? "AI_PROVIDER_OUTCOME_UNKNOWN"
          : "AI_PROVIDER_UNAVAILABLE",
      output: null,
      confidence: null,
      provider: error.provider,
      model: error.model ?? this.gateway.model,
      usage,
      chargeMicrousd: outcomeUnknown
        ? run.reservedCostMicrousd
        : (cost?.estimatedCostMicrousd ?? 0n),
      priceTableVersion: cost?.priceTableVersion ?? null,
      latencyMs: null,
    });
  }

  private async failByAggregate(
    event: ClaimedOutboxEvent,
    now: Date,
    errorCode: string,
  ): Promise<void> {
    if (!UUID_PATTERN.test(event.shopId) || !UUID_PATTERN.test(event.aggregateId)) return;
    await this.prisma.$transaction(async (transaction) => {
      await lockRun(transaction, event.shopId, event.aggregateId);
      const run = await transaction.aiRun.findFirst({
        where: { id: event.aggregateId, shopId: event.shopId },
      });
      if (!run || isTerminal(run.status)) return;
      const charge = run.status === AiRunStatus.RUNNING ? run.reservedCostMicrousd : 0n;
      await this.finalizeWithinTransaction(transaction, run, now, {
        ...failed(run.status === AiRunStatus.RUNNING ? "AI_PROVIDER_OUTCOME_UNKNOWN" : errorCode),
        provider: run.provider,
        model: run.model,
        chargeMicrousd: charge,
      });
    });
  }

  private async finalizeRun(run: PreparedAiRun, now: Date, update: TerminalUpdate): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await lockRun(transaction, run.shopId, run.id);
      const current = await transaction.aiRun.findFirst({
        where: { id: run.id, shopId: run.shopId },
      });
      if (!current || isTerminal(current.status)) return;
      if (current.status !== AiRunStatus.RUNNING) throw new Error("AI_RUN_STATE_CHANGED");
      await this.finalizeWithinTransaction(transaction, current, now, update);
    });
  }

  private async finalizeWithinTransaction(
    transaction: Prisma.TransactionClient,
    run: AiRun,
    now: Date,
    update: TerminalUpdate,
  ): Promise<void> {
    if (update.chargeMicrousd < 0n) throw new Error("AI_COST_INVALID");
    if (run.reservedCostMicrousd > 0n) {
      const periodStart = utcMonthStart(run.createdAt);
      const reconciled = await transaction.aiUsagePeriod.updateMany({
        where: {
          shopId: run.shopId,
          capability: run.capability,
          periodStart,
          reservedMicrousd: { gte: run.reservedCostMicrousd },
        },
        data: {
          reservedMicrousd: { decrement: run.reservedCostMicrousd },
          spentMicrousd: { increment: update.chargeMicrousd },
          lockVersion: { increment: 1 },
        },
      });
      if (reconciled.count !== 1) throw new Error("AI_BUDGET_RESERVATION_MISSING");
    } else if (update.chargeMicrousd > 0n) {
      throw new Error("AI_BUDGET_RESERVATION_MISSING");
    }

    const result = await transaction.aiRun.updateMany({
      where: { id: run.id, shopId: run.shopId, status: run.status },
      data: {
        status: update.status,
        output: update.output ?? Prisma.DbNull,
        confidence: update.confidence,
        errorCode: update.errorCode,
        provider: update.provider,
        model: update.model,
        inputTokens: update.usage?.inputTokens ?? null,
        outputTokens: update.usage?.outputTokens ?? null,
        estimatedCostMicrousd: update.chargeMicrousd,
        priceTableVersion: update.priceTableVersion,
        latencyMs: update.latencyMs,
        completedAt: now,
      },
    });
    if (result.count !== 1) throw new Error("AI_RUN_STATE_CHANGED");
  }

  private safeCost(provider: string, model: string, usage: AiGatewayUsage) {
    try {
      return this.priceCalculator.calculate(provider, model, usage);
    } catch {
      return null;
    }
  }
}

function parseEvent(event: ClaimedOutboxEvent): { capability: AiCapabilityName } | null {
  if (
    event.eventType !== AI_RUN_REQUESTED_EVENT ||
    event.aggregateType !== "AI_RUN" ||
    !UUID_PATTERN.test(event.shopId) ||
    !UUID_PATTERN.test(event.aggregateId) ||
    !isRecord(event.payload)
  ) {
    return null;
  }
  const aiRunId = event.payload.aiRunId;
  const shopId = event.payload.shopId;
  const capability = asCapability(event.payload.capability);
  if (
    event.payload.schemaVersion !== 1 ||
    aiRunId !== event.aggregateId ||
    shopId !== event.shopId ||
    !capability
  ) {
    return null;
  }
  return { capability };
}

function asCapability(value: unknown): AiCapabilityName | null {
  return typeof value === "string" && (AI_CAPABILITIES as readonly string[]).includes(value)
    ? (value as AiCapabilityName)
    : null;
}

function failed(errorCode: string): TerminalUpdate {
  return {
    status: "FAILED",
    errorCode,
    output: null,
    confidence: null,
    provider: null,
    model: null,
    usage: null,
    chargeMicrousd: 0n,
    priceTableVersion: null,
    latencyMs: null,
  };
}

function shouldOpenCircuit(error: unknown): boolean {
  return (
    !isAiGatewayError(error) ||
    error.code === "AI_PROVIDER_TIMEOUT" ||
    error.code === "AI_PROVIDER_UNAVAILABLE" ||
    error.code === "AI_PROVIDER_RATE_LIMITED" ||
    error.code === "AI_PROVIDER_INVALID_RESPONSE" ||
    error.code === "AI_PROVIDER_RESPONSE_TOO_LARGE"
  );
}

function isTerminal(status: AiRunStatus): boolean {
  return (
    status === AiRunStatus.SUCCEEDED ||
    status === AiRunStatus.FAILED ||
    status === AiRunStatus.REJECTED
  );
}

async function lockRun(
  transaction: Prisma.TransactionClient,
  shopId: string,
  runId: string,
): Promise<void> {
  await transaction.$queryRaw`
    SELECT "id" FROM "ai_runs"
    WHERE "shopId" = ${shopId}::uuid AND "id" = ${runId}::uuid
    FOR UPDATE
  `;
}

function utcMonthStart(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1));
}

function boundedMetric(value: number): number | null {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function toJsonValue(value: unknown): Prisma.InputJsonValue | null {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) return null;
    return JSON.parse(serialized) as Prisma.InputJsonValue;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseDeviceOcrReference(
  value: unknown,
): { mediaAssetId: string; allowedFields: string[] } | null {
  if (!isRecord(value) || !UUID_PATTERN.test(String(value.mediaAssetId))) return null;
  if (
    !Array.isArray(value.allowedFields) ||
    value.allowedFields.length < 1 ||
    !value.allowedFields.every((field) =>
      ["brand", "model", "serialNumber", "imei"].includes(String(field)),
    )
  ) {
    return null;
  }
  return {
    mediaAssetId: String(value.mediaAssetId).toLowerCase(),
    allowedFields: value.allowedFields.map(String),
  };
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
