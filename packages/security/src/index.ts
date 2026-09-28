import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export interface QuotePublicTokenMetadata {
  tokenId: string;
  shopId: string;
  repairOrderId: string;
  quoteVersionId: string;
  expiresAt: string;
}

export interface TrackPublicTokenMetadata {
  tokenId: string;
  shopId: string;
  repairOrderId: string;
  expiresAt: string;
}

export interface StaffInvitationTokenMetadata {
  invitationId: string;
  expiresAt: string;
}

export type NotificationDestinationChannel = "EMAIL" | "ZALO" | "SMS";

export function deriveQuotePublicToken(secret: string, metadata: QuotePublicTokenMetadata): string {
  return createHmac("sha256", secret)
    .update(
      JSON.stringify({
        version: 1,
        tokenId: metadata.tokenId,
        shopId: metadata.shopId,
        repairOrderId: metadata.repairOrderId,
        quoteVersionId: metadata.quoteVersionId,
        scope: "DECIDE_QUOTE",
        expiresAt: metadata.expiresAt,
      }),
    )
    .digest("base64url");
}

export function deriveTrackPublicToken(secret: string, metadata: TrackPublicTokenMetadata): string {
  return createHmac("sha256", secret)
    .update(
      JSON.stringify({
        version: 1,
        tokenId: metadata.tokenId,
        shopId: metadata.shopId,
        repairOrderId: metadata.repairOrderId,
        scope: "TRACK_ORDER",
        expiresAt: metadata.expiresAt,
      }),
    )
    .digest("base64url");
}

export function deriveStaffInvitationToken(
  secret: string,
  metadata: StaffInvitationTokenMetadata,
): string {
  return createHmac("sha256", secret)
    .update(
      JSON.stringify({
        version: 1,
        purpose: "ACCEPT_STAFF_INVITATION",
        invitationId: metadata.invitationId,
        expiresAt: metadata.expiresAt,
      }),
    )
    .digest("base64url");
}

export function hashPublicToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

export function buildPublicTokenUrl(publicWebUrl: string, rawToken: string): string {
  return new URL(`/p/${encodeURIComponent(rawToken)}`, publicWebUrl).toString();
}

export function buildStaffInvitationUrl(publicWebUrl: string, rawToken: string): string {
  return new URL(`/join/${encodeURIComponent(rawToken)}`, publicWebUrl).toString();
}

export function normalizeNotificationDestination(
  channel: NotificationDestinationChannel,
  value: unknown,
): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const normalized = value.trim();
  return channel === "EMAIL" ? normalized.toLowerCase() : normalized.replace(/[\s().-]/gu, "");
}

export function deriveNotificationDestinationHash(
  secret: string,
  channel: NotificationDestinationChannel,
  destination: string,
): string {
  return createHmac("sha256", secret)
    .update(`notification-destination:v1:${channel}:${destination}`)
    .digest("hex");
}

export function secureHexEqual(left: string, right: string): boolean {
  if (!/^[a-f\d]+$/iu.test(left) || !/^[a-f\d]+$/iu.test(right)) return false;
  if (left.length !== right.length || left.length % 2 !== 0) return false;
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return timingSafeEqual(leftBuffer, rightBuffer);
}

const AI_PROHIBITED_KEY =
  /(?:^|_)(?:name|email|phone|address|password|passcode|pin|secret|token|authorization|cookie|credential|unlock)(?:$|_)/iu;
const AI_EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu;
const AI_PHONE = /(?<![\dA-Z])(?:\+?\d[\d\s().-]{7,}\d)(?![\dA-Z])/giu;
const AI_BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]+/giu;

export interface AiRedactionResult {
  value: unknown;
  redactions: number;
}

/**
 * Defense-in-depth redaction for already allowlisted AI input. Capability builders remain
 * responsible for selecting the minimum fields; this removes common contact and credential
 * material before persistence or provider delivery.
 */
export function redactAiInput(input: unknown): AiRedactionResult {
  let redactions = 0;

  const visit = (value: unknown, key?: string): unknown => {
    const normalizedKey = key?.replace(/([a-z\d])([A-Z])/gu, "$1_$2").toLowerCase();
    if (normalizedKey && AI_PROHIBITED_KEY.test(normalizedKey)) {
      redactions += 1;
      return "[REDACTED]";
    }
    if (typeof value === "string") {
      let sanitized = value;
      for (const pattern of [AI_BEARER, AI_EMAIL, AI_PHONE]) {
        sanitized = sanitized.replace(pattern, () => {
          redactions += 1;
          return "[REDACTED]";
        });
      }
      return sanitized;
    }
    if (Array.isArray(value)) return value.map((entry) => visit(entry));
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([entryKey, entryValue]) => [
          entryKey,
          visit(entryValue, entryKey),
        ]),
      );
    }
    return value;
  };

  return { value: visit(input), redactions };
}
