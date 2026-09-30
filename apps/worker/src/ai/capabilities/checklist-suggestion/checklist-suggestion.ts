import {
  AI_OUTPUT_SCHEMAS,
  CHECKLIST_SUGGESTION_PROMPT_VERSION,
  CHECKLIST_SUGGESTION_SCHEMA_VERSION,
  isValidAiOutput,
  normalizePlainText,
  type ChecklistSuggestionOutput,
} from "@repairflow/contracts";
import { redactAiInput } from "@repairflow/security";

import type { AiCapabilityDefinition } from "../../ai-capability-registry.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CREDENTIAL =
  /(?:\bbearer\s+[a-z0-9._~+/=-]+|(?:password|passcode|mật\s*khẩu|api[_ -]?key|token|pin)\s*[:=]\s*\S+)/giu;
const PROMPT_INJECTION =
  /(?:ignore\s+(?:all\s+)?(?:previous|prior)\s+instructions?|system\s+prompt|developer\s+message)/iu;
const DEVICE_TYPES = new Set(["PHONE", "LAPTOP", "TABLET", "OTHER"]);

export const checklistSuggestionDefinition: AiCapabilityDefinition = {
  capability: "CHECKLIST_SUGGESTION",
  promptVersion: CHECKLIST_SUGGESTION_PROMPT_VERSION,
  schemaVersion: CHECKLIST_SUGGESTION_SCHEMA_VERSION,
  systemPrompt: [
    "Suggest checks only from the supplied server-owned checklist item allowlist.",
    "Return item identifiers exactly and never create, rename, pass, fail or complete an item.",
    "Explain the draft briefly in Vietnamese without diagnosis, price, deadline or guarantee.",
    "Safety warnings only remind staff to follow the published checklist and shop procedure.",
  ].join(" "),
  outputSchema: AI_OUTPUT_SCHEMAS.CHECKLIST_SUGGESTION,
  normalizeOutput: normalizeChecklistSuggestionOutput,
  validateOutput: validateChecklistSuggestionOutput,
  confidence: () => null,
};

export function normalizeChecklistSuggestionOutput(value: unknown): unknown {
  if (!isRecord(value)) return null;
  if (!Array.isArray(value.suggestedItemIds) || !Array.isArray(value.safetyWarnings)) return null;
  if (typeof value.reasoningSummary !== "string") return null;
  return {
    suggestedItemIds: value.suggestedItemIds.map((item) =>
      typeof item === "string" ? item.toLowerCase() : item,
    ),
    reasoningSummary: normalizePlainText(value.reasoningSummary),
    safetyWarnings: value.safetyWarnings.map((warning) =>
      typeof warning === "string" ? normalizePlainText(warning) : warning,
    ),
  };
}

export function validateChecklistSuggestionOutput(output: unknown, input: unknown): boolean {
  if (!isValidAiOutput("CHECKLIST_SUGGESTION", output) || !isRecord(output) || !isRecord(input)) {
    return false;
  }
  if (!Array.isArray(input.allowedChecklistItems)) return false;
  const allowedIds = new Set(
    input.allowedChecklistItems.flatMap((item) =>
      isRecord(item) && typeof item.id === "string" ? [item.id.toLowerCase()] : [],
    ),
  );
  const candidate = output as unknown as ChecklistSuggestionOutput;
  return candidate.suggestedItemIds.every((id) => allowedIds.has(id));
}

export function sanitizeChecklistSuggestionInput(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  if (value.phase !== "DIAGNOSIS" && value.phase !== "QC") return null;
  if (
    typeof value.deviceType !== "string" ||
    !DEVICE_TYPES.has(value.deviceType) ||
    typeof value.reportedProblem !== "string"
  )
    return null;
  if (!Array.isArray(value.allowedChecklistItems) || value.allowedChecklistItems.length === 0) {
    return null;
  }
  if (value.allowedChecklistItems.length > 100) return null;
  const items = value.allowedChecklistItems.flatMap((item) => {
    if (
      !isRecord(item) ||
      typeof item.id !== "string" ||
      !UUID_PATTERN.test(item.id) ||
      typeof item.label !== "string" ||
      typeof item.isRequired !== "boolean" ||
      typeof item.allowNa !== "boolean"
    ) {
      return [];
    }
    const label = sanitizeText(item.label, 300);
    return label
      ? [{ id: item.id.toLowerCase(), label, isRequired: item.isRequired, allowNa: item.allowNa }]
      : [];
  });
  const reportedProblem = sanitizeText(value.reportedProblem, 2_000);
  if (!reportedProblem || items.length !== value.allowedChecklistItems.length) return null;
  if (new Set(items.map((item) => item.id)).size !== items.length) return null;
  return {
    phase: value.phase,
    deviceType: value.deviceType,
    reportedProblem,
    allowedChecklistItems: items,
  };
}

function sanitizeText(value: string, maximum: number): string {
  const normalized = normalizePlainText(value).replace(CREDENTIAL, "[REDACTED]");
  if (PROMPT_INJECTION.test(normalized)) return "";
  const redacted = redactAiInput(normalized).value;
  return typeof redacted === "string"
    ? normalizePlainText(redacted).replaceAll("[REDACTED]", "").trim().slice(0, maximum)
    : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
