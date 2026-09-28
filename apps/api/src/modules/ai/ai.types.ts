import type { AiCapability, AiCapabilitySetting, AiReviewOutcome, AiRun } from "@prisma/client";

export interface AiCapabilitySettingView {
  capability: AiCapability;
  enabled: boolean;
  effectiveEnabled: boolean;
  monthlyBudgetMicrousd: string;
  maxRunCostMicrousd: string;
  lockVersion: number;
  updatedAt: string | null;
}

export interface AiSettingsResponse {
  data: {
    globalEnabled: boolean;
    capabilities: AiCapabilitySettingView[];
  };
}

export interface AiRunView {
  id: string;
  capability: AiCapability;
  status: AiRun["status"];
  promptVersion: string;
  schemaVersion: string;
  output: unknown | null;
  confidence: number | null;
  errorCode: string | null;
  review: {
    outcome: AiReviewOutcome;
    reviewedAt: string;
    editDistancePermille: number | null;
    timeSavedSeconds: number | null;
  } | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface AiRunResponse {
  data: AiRunView;
}

export type AiCapabilitySettingRecord = Pick<
  AiCapabilitySetting,
  | "capability"
  | "enabled"
  | "monthlyBudgetMicrousd"
  | "maxRunCostMicrousd"
  | "lockVersion"
  | "updatedAt"
>;

export function toAiSettingView(
  capability: AiCapability,
  record: AiCapabilitySettingRecord | undefined,
  globalEnabled: boolean,
): AiCapabilitySettingView {
  return {
    capability,
    enabled: record?.enabled ?? false,
    effectiveEnabled: globalEnabled && (record?.enabled ?? false),
    monthlyBudgetMicrousd: String(record?.monthlyBudgetMicrousd ?? 0n),
    maxRunCostMicrousd: String(record?.maxRunCostMicrousd ?? 0n),
    lockVersion: record?.lockVersion ?? 0,
    updatedAt: record?.updatedAt.toISOString() ?? null,
  };
}

export function toAiRunView(run: AiRun): AiRunView {
  return {
    id: run.id,
    capability: run.capability,
    status: run.status,
    promptVersion: run.promptVersion,
    schemaVersion: run.schemaVersion,
    output: run.output ?? null,
    confidence: run.confidence === null ? null : Number(run.confidence),
    errorCode: run.errorCode,
    review:
      run.reviewOutcome && run.reviewedAt
        ? {
            outcome: run.reviewOutcome,
            reviewedAt: run.reviewedAt.toISOString(),
            editDistancePermille: run.editDistancePermille,
            timeSavedSeconds: run.timeSavedSeconds,
          }
        : null,
    createdAt: run.createdAt.toISOString(),
    startedAt: run.startedAt?.toISOString() ?? null,
    completedAt: run.completedAt?.toISOString() ?? null,
  };
}
