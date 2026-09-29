export const AI_CAPABILITIES = [
  "DEVICE_OCR",
  "INTAKE_DRAFT",
  "CHECKLIST_SUGGESTION",
  "CUSTOMER_SUMMARY",
] as const;

export type AiCapabilityName = (typeof AI_CAPABILITIES)[number];

export const CUSTOMER_SUMMARY_PROMPT_VERSION = "customer-summary-v1";
export const CUSTOMER_SUMMARY_SCHEMA_VERSION = "1";
export const DEVICE_OCR_PROMPT_VERSION = "device-ocr-v1";
export const DEVICE_OCR_SCHEMA_VERSION = "1";
export const DEVICE_OCR_FIELDS = ["brand", "model", "serialNumber", "imei"] as const;
export type DeviceOcrField = (typeof DEVICE_OCR_FIELDS)[number];

export interface DeviceOcrCandidate {
  value: string | null;
  confidence: number;
}

export interface DeviceOcrOutput {
  brand: DeviceOcrCandidate;
  model: DeviceOcrCandidate;
  serialNumber: DeviceOcrCandidate;
  imei: DeviceOcrCandidate;
  warnings: string[];
}
export const CUSTOMER_SUMMARY_TONES = ["CLEAR_NEUTRAL"] as const;
export type CustomerSummaryTone = (typeof CUSTOMER_SUMMARY_TONES)[number];

export interface CustomerSummaryFact {
  id: string;
  kind: "DIAGNOSIS_FINDING" | "DIAGNOSIS_RECOMMENDATION" | "WORK_LOG";
  text: string;
}

export interface CustomerSummaryInput {
  tone: CustomerSummaryTone;
  maxCharacters: number;
  facts: CustomerSummaryFact[];
}

export type JsonSchema = Readonly<Record<string, unknown>>;

const nullableFieldSchema = {
  type: "object",
  additionalProperties: false,
  required: ["value", "confidence"],
  properties: {
    value: { type: ["string", "null"] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
} as const;

export const AI_OUTPUT_SCHEMAS: Readonly<Record<AiCapabilityName, JsonSchema>> = {
  DEVICE_OCR: {
    type: "object",
    additionalProperties: false,
    required: ["brand", "model", "serialNumber", "imei", "warnings"],
    properties: {
      brand: nullableFieldSchema,
      model: nullableFieldSchema,
      serialNumber: nullableFieldSchema,
      imei: nullableFieldSchema,
      warnings: { type: "array", maxItems: 10, items: { type: "string", maxLength: 300 } },
    },
  },
  INTAKE_DRAFT: {
    type: "object",
    additionalProperties: false,
    required: [
      "reportedProblem",
      "visibleCondition",
      "accessories",
      "customerClaims",
      "uncertainties",
    ],
    properties: {
      reportedProblem: { type: "string", minLength: 1, maxLength: 2000 },
      visibleCondition: { type: "string", minLength: 1, maxLength: 2000 },
      accessories: { type: "array", maxItems: 30, items: { type: "string", maxLength: 200 } },
      customerClaims: {
        type: "array",
        maxItems: 30,
        items: { type: "string", maxLength: 500 },
      },
      uncertainties: {
        type: "array",
        maxItems: 30,
        items: { type: "string", maxLength: 500 },
      },
    },
  },
  CHECKLIST_SUGGESTION: {
    type: "object",
    additionalProperties: false,
    required: ["suggestedItemIds", "reasoningSummary", "safetyWarnings"],
    properties: {
      suggestedItemIds: {
        type: "array",
        uniqueItems: true,
        maxItems: 100,
        items: { type: "string", format: "uuid" },
      },
      reasoningSummary: { type: "string", maxLength: 1000 },
      safetyWarnings: {
        type: "array",
        maxItems: 20,
        items: { type: "string", maxLength: 500 },
      },
    },
  },
  CUSTOMER_SUMMARY: {
    type: "object",
    additionalProperties: false,
    required: ["summary", "claimsUsed", "warnings"],
    properties: {
      summary: { type: "string", minLength: 1, maxLength: 800 },
      claimsUsed: {
        type: "array",
        uniqueItems: true,
        maxItems: 100,
        items: { type: "string", minLength: 1, maxLength: 128 },
      },
      warnings: { type: "array", maxItems: 20, items: { type: "string", maxLength: 500 } },
    },
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === [...expected].sort()[index])
  );
}

function boundedString(value: unknown, minimum: number, maximum: number): value is string {
  return typeof value === "string" && value.length >= minimum && value.length <= maximum;
}

function boundedStringArray(
  value: unknown,
  maxItems: number,
  maxLength: number,
): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= maxItems &&
    value.every((entry) => boundedString(entry, 0, maxLength))
  );
}

function validOcrField(value: unknown): boolean {
  if (!isRecord(value) || !hasExactKeys(value, ["confidence", "value"])) return false;
  return (
    (value.value === null || boundedString(value.value, 0, 300)) &&
    typeof value.confidence === "number" &&
    Number.isFinite(value.confidence) &&
    value.confidence >= 0 &&
    value.confidence <= 1
  );
}

const OCR_FIELD_LIMITS: Readonly<Record<DeviceOcrField, number>> = {
  brand: 100,
  model: 150,
  serialNumber: 100,
  imei: 15,
};

const HTML_FRAGMENT = /<\/?[a-z][^>]*>/iu;
const PROMPT_FRAGMENT =
  /(?:ignore\s+(?:all\s+)?(?:previous|prior)\s+instructions?|system\s+prompt|developer\s+message)/iu;

function validDeviceOcrField(field: DeviceOcrField, value: unknown): boolean {
  if (!validOcrField(value) || !isRecord(value)) return false;
  if (value.value === null) return true;
  if (typeof value.value !== "string") return false;
  if (
    value.value.length < 1 ||
    value.value.length > OCR_FIELD_LIMITS[field] ||
    value.value !== value.value.normalize("NFKC").replace(/\s+/gu, " ").trim() ||
    hasControlCharacter(value.value) ||
    HTML_FRAGMENT.test(value.value) ||
    PROMPT_FRAGMENT.test(value.value)
  ) {
    return false;
  }
  return field !== "imei" || isValidImei(value.value);
}

export function isValidImei(value: string): boolean {
  if (!/^\d{15}$/u.test(value)) return false;
  let sum = 0;
  for (let index = 0; index < value.length; index += 1) {
    let digit = Number(value[index]);
    if (index % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function isValidAiOutput(capability: AiCapabilityName, value: unknown): boolean {
  if (!isRecord(value)) return false;
  switch (capability) {
    case "DEVICE_OCR":
      return (
        hasExactKeys(value, ["brand", "imei", "model", "serialNumber", "warnings"]) &&
        validDeviceOcrField("brand", value.brand) &&
        validDeviceOcrField("model", value.model) &&
        validDeviceOcrField("serialNumber", value.serialNumber) &&
        validDeviceOcrField("imei", value.imei) &&
        boundedStringArray(value.warnings, 10, 300) &&
        value.warnings.every(
          (warning) =>
            warning === warning.normalize("NFKC").replace(/\s+/gu, " ").trim() &&
            !hasControlCharacter(warning) &&
            !HTML_FRAGMENT.test(warning) &&
            !PROMPT_FRAGMENT.test(warning),
        )
      );
    case "INTAKE_DRAFT":
      return (
        hasExactKeys(value, [
          "accessories",
          "customerClaims",
          "reportedProblem",
          "uncertainties",
          "visibleCondition",
        ]) &&
        boundedString(value.reportedProblem, 1, 2000) &&
        boundedString(value.visibleCondition, 1, 2000) &&
        boundedStringArray(value.accessories, 30, 200) &&
        boundedStringArray(value.customerClaims, 30, 500) &&
        boundedStringArray(value.uncertainties, 30, 500)
      );
    case "CHECKLIST_SUGGESTION": {
      if (
        !hasExactKeys(value, ["reasoningSummary", "safetyWarnings", "suggestedItemIds"]) ||
        !boundedString(value.reasoningSummary, 0, 1000) ||
        !boundedStringArray(value.safetyWarnings, 20, 500) ||
        !Array.isArray(value.suggestedItemIds) ||
        value.suggestedItemIds.length > 100 ||
        !value.suggestedItemIds.every(
          (entry) => typeof entry === "string" && UUID_PATTERN.test(entry),
        )
      ) {
        return false;
      }
      return new Set(value.suggestedItemIds).size === value.suggestedItemIds.length;
    }
    case "CUSTOMER_SUMMARY": {
      if (
        !hasExactKeys(value, ["claimsUsed", "summary", "warnings"]) ||
        !boundedString(value.summary, 1, 800) ||
        !boundedStringArray(value.warnings, 20, 500) ||
        !boundedStringArray(value.claimsUsed, 100, 128)
      ) {
        return false;
      }
      return new Set(value.claimsUsed).size === value.claimsUsed.length;
    }
  }
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || (code >= 127 && code <= 159);
  });
}

export function normalizedEditDistancePermille(original: unknown, reviewed: unknown): number {
  const left = JSON.stringify(original);
  const right = JSON.stringify(reviewed);
  const maximum = Math.max(left.length, right.length);
  if (maximum === 0) return 0;
  // Keep review telemetry bounded even when a valid capability output contains large arrays.
  // The exact prefix captures ordinary edits; the tail remains linear and still detects changes.
  const exactLength = Math.min(4096, maximum);
  const leftPrefix = left.slice(0, exactLength);
  const rightPrefix = right.slice(0, exactLength);
  let previous = Array.from({ length: rightPrefix.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= leftPrefix.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= rightPrefix.length; rightIndex += 1) {
      const substitution =
        previous[rightIndex - 1]! +
        (leftPrefix[leftIndex - 1] === rightPrefix[rightIndex - 1] ? 0 : 1);
      current[rightIndex] = Math.min(
        previous[rightIndex]! + 1,
        current[rightIndex - 1]! + 1,
        substitution,
      );
    }
    previous = current;
  }
  let distance = previous[rightPrefix.length]!;
  for (let index = exactLength; index < maximum; index += 1) {
    if (left[index] !== right[index]) distance += 1;
  }
  return Math.round((distance / maximum) * 1000);
}
