import {
  AI_OUTPUT_SCHEMAS,
  isValidAiOutput,
  type AiCapabilityName,
  type JsonSchema,
} from "@repairflow/contracts";

import { customerSummaryDefinition } from "./capabilities/customer-summary/customer-summary.js";
import { deviceOcrDefinition } from "./capabilities/device-ocr/device-ocr.js";

export const AI_PROMPT_VERSION = "spec-v0.1";
export const AI_SCHEMA_VERSION = "1";

export interface AiCapabilityDefinition {
  capability: AiCapabilityName;
  promptVersion: string;
  schemaVersion: string;
  systemPrompt: string;
  outputSchema: JsonSchema;
  normalizeOutput?(output: unknown, sanitizedInput: unknown): unknown;
  validateOutput(output: unknown, sanitizedInput: unknown): boolean;
  confidence(output: unknown): number | null;
}

const PROMPTS: Readonly<Record<AiCapabilityName, string>> = {
  DEVICE_OCR: [
    "Extract only the requested device identity fields from the supplied authorized input.",
    "Return JSON matching the schema exactly. Use null when a value is not visible.",
    "Never infer a serial number or IMEI and keep identifiers as strings.",
  ].join(" "),
  INTAKE_DRAFT: [
    "Convert the supplied staff text or transcript into a Vietnamese repair-intake draft.",
    "Keep customer claims separate from verified facts and list every uncertainty.",
    "Return JSON matching the schema exactly. Do not diagnose, price, or promise an outcome.",
  ].join(" "),
  CHECKLIST_SUGGESTION: [
    "Suggest checks only from the supplied shop-approved checklist catalogue.",
    "Return JSON matching the schema exactly and never invent an item identifier.",
    "Suggestions are a draft and must not mark a check as passed or diagnose the device.",
  ].join(" "),
  CUSTOMER_SUMMARY: [
    "Rewrite only the supplied approved facts into concise customer-safe Vietnamese.",
    "Return JSON matching the schema exactly and identify every approved claim used.",
    "Do not add a price, diagnosis, certainty, completion promise, or warranty promise.",
  ].join(" "),
};

export class AiCapabilityRegistry {
  private readonly definitions: ReadonlyMap<string, AiCapabilityDefinition>;

  constructor(definitions: readonly AiCapabilityDefinition[] = defaultDefinitions()) {
    this.definitions = new Map(
      definitions.map((definition) => [this.key(definition), definition] as const),
    );
  }

  resolve(
    capability: AiCapabilityName,
    promptVersion: string,
    schemaVersion: string,
  ): AiCapabilityDefinition | null {
    return this.definitions.get(this.key({ capability, promptVersion, schemaVersion })) ?? null;
  }

  private key(
    input: Pick<AiCapabilityDefinition, "capability" | "promptVersion" | "schemaVersion">,
  ) {
    return `${input.capability}:${input.promptVersion}:${input.schemaVersion}`;
  }
}

function defaultDefinitions(): AiCapabilityDefinition[] {
  const foundation: AiCapabilityDefinition[] = (
    Object.keys(AI_OUTPUT_SCHEMAS) as AiCapabilityName[]
  ).map((capability) => ({
    capability,
    promptVersion: AI_PROMPT_VERSION,
    schemaVersion: AI_SCHEMA_VERSION,
    systemPrompt: PROMPTS[capability],
    outputSchema: AI_OUTPUT_SCHEMAS[capability],
    validateOutput: (output, input) => validateCapabilityOutput(capability, output, input),
    confidence: capability === "DEVICE_OCR" ? ocrConfidence : () => null,
  }));
  return [...foundation, customerSummaryDefinition, deviceOcrDefinition];
}

function validateCapabilityOutput(
  capability: AiCapabilityName,
  output: unknown,
  input: unknown,
): boolean {
  if (!isValidAiOutput(capability, output)) return false;
  if (!isRecord(output) || !isRecord(input)) return true;

  if (capability === "DEVICE_OCR" && Array.isArray(input.allowedFields)) {
    const allowed = new Set(
      input.allowedFields.filter((field): field is string => typeof field === "string"),
    );
    const fieldMap = {
      brand: "brand",
      model: "model",
      serialNumber: "serialNumber",
      imei: "imei",
    } as const;
    for (const [outputField, allowedField] of Object.entries(fieldMap)) {
      const candidate = output[outputField];
      if (!allowed.has(allowedField) && isRecord(candidate) && candidate.value !== null) {
        return false;
      }
    }
  }

  if (capability === "CHECKLIST_SUGGESTION" && Array.isArray(input.allowedChecklistItems)) {
    const allowedIds = new Set(
      input.allowedChecklistItems.flatMap((item) =>
        isRecord(item) && typeof item.id === "string" ? [item.id] : [],
      ),
    );
    if (
      !Array.isArray(output.suggestedItemIds) ||
      !output.suggestedItemIds.every(
        (itemId) => typeof itemId === "string" && allowedIds.has(itemId),
      )
    ) {
      return false;
    }
  }

  if (capability === "CUSTOMER_SUMMARY" && Array.isArray(input.approvedFacts)) {
    const approvedFacts = new Set(
      input.approvedFacts.filter((fact): fact is string => typeof fact === "string"),
    );
    if (
      !Array.isArray(output.claimsUsed) ||
      !output.claimsUsed.every((claim) => typeof claim === "string" && approvedFacts.has(claim))
    ) {
      return false;
    }
  }

  return true;
}

function ocrConfidence(output: unknown): number | null {
  if (!isRecord(output)) return null;
  const values = ["brand", "model", "serialNumber", "imei"].flatMap((field) => {
    const candidate = output[field];
    return isRecord(candidate) &&
      candidate.value !== null &&
      typeof candidate.confidence === "number" &&
      Number.isFinite(candidate.confidence)
      ? [candidate.confidence]
      : [];
  });
  if (values.length === 0) return null;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
