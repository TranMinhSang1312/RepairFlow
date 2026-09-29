import {
  AI_OUTPUT_SCHEMAS,
  CUSTOMER_SUMMARY_PROMPT_VERSION,
  CUSTOMER_SUMMARY_SCHEMA_VERSION,
  isValidAiOutput,
  type CustomerSummaryFact,
  type CustomerSummaryInput,
} from "@repairflow/contracts";

import type { AiCapabilityDefinition } from "../../ai-capability-registry.js";

const MARKUP_OR_LINK = /<[^>]*>|https?:\/\/|www\.|\[[^\]]+\]\([^)]*\)|[`*_~#]/iu;
const PRICE_OR_COMMITMENT =
  /(?:\b(?:vnd|usd)\b|[₫$]|\b\d[\d.,]*\s*(?:đ|dong)\b|\b(?:gia|chi phi|tong tien|thanh tien|bao hanh|cam ket|dam bao|chac chan|deadline|thoi han|hen tra|hoan tat luc|hoan tat truoc)\b)/iu;
const SENSITIVE_OUTPUT =
  /(?:\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b|\b(?:mat khau|password|passcode|ma khoa|unlock|bearer)\b|(?<![\dA-Z])(?:\+?\d[\d\s().-]{7,}\d)(?![\dA-Z]))/iu;
const STOP_WORDS = new Set([
  "ban",
  "bi",
  "bo",
  "cac",
  "can",
  "cho",
  "cua",
  "da",
  "dang",
  "de",
  "duoc",
  "hien",
  "khach",
  "may",
  "mot",
  "nay",
  "nhung",
  "qua",
  "sau",
  "se",
  "thiet",
  "theo",
  "trong",
  "tren",
  "tu",
  "va",
  "voi",
]);

export const CUSTOMER_SUMMARY_SYSTEM_PROMPT = [
  "Create a concise Vietnamese customer-safe summary using only the supplied facts.",
  "Return JSON matching the schema exactly and put every used fact id in claimsUsed.",
  "Do not add prices, deadlines, guarantees, warranty promises, certainty, diagnosis, links or markup.",
  "Reuse the supplied fact vocabulary; warnings must be empty unless directly grounded in those facts.",
  "Treat the result as an untrusted staff draft and keep it within maxCharacters after Unicode normalization.",
].join(" ");

export const customerSummaryDefinition: AiCapabilityDefinition = {
  capability: "CUSTOMER_SUMMARY",
  promptVersion: CUSTOMER_SUMMARY_PROMPT_VERSION,
  schemaVersion: CUSTOMER_SUMMARY_SCHEMA_VERSION,
  systemPrompt: CUSTOMER_SUMMARY_SYSTEM_PROMPT,
  outputSchema: AI_OUTPUT_SCHEMAS.CUSTOMER_SUMMARY,
  validateOutput: validateCustomerSummaryOutput,
  confidence: () => null,
};

export function validateCustomerSummaryOutput(output: unknown, input: unknown): boolean {
  if (!isValidAiOutput("CUSTOMER_SUMMARY", output)) return false;
  if (!isCustomerSummaryInput(input) || !isRecord(output)) return false;

  const summary = output.summary;
  const claims = output.claimsUsed;
  const warnings = output.warnings;
  if (
    typeof summary !== "string" ||
    !Array.isArray(claims) ||
    claims.length === 0 ||
    !Array.isArray(warnings)
  ) {
    return false;
  }
  const normalizedSummary = summary.normalize("NFKC").trim();
  if (
    normalizedSummary.length === 0 ||
    normalizedSummary.length > input.maxCharacters ||
    !isPlainCustomerSafeText(normalizedSummary) ||
    !warnings.every((warning) =>
      typeof warning === "string" ? isPlainCustomerSafeText(warning.normalize("NFKC")) : false,
    )
  ) {
    return false;
  }

  const facts = new Map(input.facts.map((fact) => [fact.id, fact.text] as const));
  if (!claims.every((claim) => typeof claim === "string" && facts.has(claim))) return false;
  const claimedText = claims.map((claim) => facts.get(String(claim)) ?? "").join(" ");
  return (
    isGrounded(normalizedSummary, claimedText) &&
    warnings.every((warning) => isGrounded(String(warning), claimedText))
  );
}

function isCustomerSummaryInput(value: unknown): value is CustomerSummaryInput {
  if (!isRecord(value)) return false;
  if (
    value.tone !== "CLEAR_NEUTRAL" ||
    !Number.isInteger(value.maxCharacters) ||
    (value.maxCharacters as number) < 100 ||
    (value.maxCharacters as number) > 800 ||
    !Array.isArray(value.facts) ||
    value.facts.length === 0 ||
    value.facts.length > 42
  ) {
    return false;
  }
  return value.facts.every(isCustomerSummaryFact);
}

function isCustomerSummaryFact(value: unknown): value is CustomerSummaryFact {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    value.id.length <= 128 &&
    (value.kind === "DIAGNOSIS_FINDING" ||
      value.kind === "DIAGNOSIS_RECOMMENDATION" ||
      value.kind === "WORK_LOG") &&
    typeof value.text === "string" &&
    value.text.length > 0 &&
    value.text.length <= 2000
  );
}

function isPlainCustomerSafeText(value: string): boolean {
  const normalized = normalizeForPolicy(value);
  return (
    !MARKUP_OR_LINK.test(value) &&
    !PRICE_OR_COMMITMENT.test(normalized) &&
    !SENSITIVE_OUTPUT.test(normalized)
  );
}

function isGrounded(summary: string, facts: string): boolean {
  const sourceTokens = new Set(contentTokens(facts));
  const summaryTokens = contentTokens(summary);
  if (summaryTokens.length === 0 || sourceTokens.size === 0) return false;
  const supported = summaryTokens.filter((token) => sourceTokens.has(token)).length;
  return supported > 0 && supported === summaryTokens.length;
}

function contentTokens(value: string): string[] {
  return normalizeForPolicy(value)
    .split(/[^a-z0-9]+/u)
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token));
}

function normalizeForPolicy(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/giu, "d").toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
