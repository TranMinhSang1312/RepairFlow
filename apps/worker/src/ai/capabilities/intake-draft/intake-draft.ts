import {
  AI_OUTPUT_SCHEMAS,
  INTAKE_DRAFT_PROMPT_VERSION,
  INTAKE_DRAFT_SCHEMA_VERSION,
  isValidAiOutput,
  normalizePlainText,
  type IntakeDraftOutput,
} from "@repairflow/contracts";
import { redactAiInput } from "@repairflow/security";

import type { AiCapabilityDefinition } from "../../ai-capability-registry.js";

const LIMITS = {
  reportedProblem: 2000,
  visibleCondition: 2000,
  accessories: 200,
  customerClaims: 500,
  uncertainties: 500,
} as const;
const PROHIBITED_INPUT =
  /(?:password|passcode|recovery\s*key|bearer\s+[a-z0-9._~+/=-]+|api[_ -]?key|mật\s*khẩu|mã\s*pin|pin\s*[:=]|token\s*[:=])/iu;
const PROMPT_INJECTION =
  /(?:ignore\s+(?:all\s+)?(?:previous|prior)\s+instructions?|system\s+prompt|developer\s+message)/iu;

export const intakeDraftDefinition: AiCapabilityDefinition = {
  capability: "INTAKE_DRAFT",
  promptVersion: INTAKE_DRAFT_PROMPT_VERSION,
  schemaVersion: INTAKE_DRAFT_SCHEMA_VERSION,
  systemPrompt: [
    "Convert only the supplied sanitized Vietnamese staff text or transcript into an intake draft.",
    "Separate what the customer reports from visible condition and uncertainties.",
    "Do not diagnose, quote a price, promise a deadline, repair outcome or warranty.",
    "Use plain text without links or markup and return the exact JSON schema.",
  ].join(" "),
  outputSchema: AI_OUTPUT_SCHEMAS.INTAKE_DRAFT,
  normalizeOutput: normalizeIntakeDraftOutput,
  validateOutput: (output) => isValidAiOutput("INTAKE_DRAFT", output),
  confidence: () => null,
};

export function sanitizeIntakeTranscript(value: string): string | null {
  const normalized = normalizePlainText(value);
  if (!normalized || PROHIBITED_INPUT.test(normalized) || PROMPT_INJECTION.test(normalized)) {
    return null;
  }
  const redacted = redactAiInput({ transcript: normalized }).value;
  if (!isRecord(redacted) || typeof redacted.transcript !== "string") return null;
  const transcript = normalizePlainText(redacted.transcript);
  return transcript.replaceAll("[REDACTED]", "").trim().length >= 3 ? transcript : null;
}

export function normalizeIntakeDraftOutput(value: unknown): unknown {
  if (!isRecord(value)) return null;
  const reportedProblem = normalizedField(value.reportedProblem, LIMITS.reportedProblem);
  const visibleCondition = normalizedField(value.visibleCondition, LIMITS.visibleCondition);
  const accessories = normalizedList(value.accessories, 30, LIMITS.accessories);
  const customerClaims = normalizedList(value.customerClaims, 30, LIMITS.customerClaims);
  const uncertainties = normalizedList(value.uncertainties, 30, LIMITS.uncertainties);
  if (!reportedProblem || !visibleCondition || !accessories || !customerClaims || !uncertainties) {
    return null;
  }
  return {
    reportedProblem,
    visibleCondition,
    accessories,
    customerClaims,
    uncertainties,
  } satisfies IntakeDraftOutput;
}

function normalizedField(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = normalizePlainText(value);
  return normalized.length >= 1 && normalized.length <= maxLength ? normalized : null;
}

function normalizedList(value: unknown, maxItems: number, maxLength: number): string[] | null {
  if (!Array.isArray(value) || value.length > maxItems) return null;
  const output: string[] = [];
  for (const item of value) {
    const normalized = normalizedField(item, maxLength);
    if (!normalized) return null;
    output.push(normalized);
  }
  return output;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
