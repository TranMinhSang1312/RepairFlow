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

export function hashPublicToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

export function buildPublicTokenUrl(publicWebUrl: string, rawToken: string): string {
  return new URL(`/p/${encodeURIComponent(rawToken)}`, publicWebUrl).toString();
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
