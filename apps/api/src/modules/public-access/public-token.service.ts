import { Injectable } from "@nestjs/common";
import { parseApiEnvironment } from "@repairflow/config";
import { createHash, createHmac, randomUUID } from "node:crypto";

export interface QuoteTokenMetadata {
  tokenId: string;
  shopId: string;
  repairOrderId: string;
  quoteVersionId: string;
  expiresAt: string;
}

export interface TrackTokenMetadata {
  tokenId: string;
  shopId: string;
  repairOrderId: string;
  expiresAt: string;
}

@Injectable()
export class PublicTokenService {
  private readonly secret: string;
  private readonly publicWebUrl: string;

  constructor() {
    const environment = parseApiEnvironment(process.env);
    this.secret = environment.PUBLIC_TOKEN_SECRET ?? environment.ACCESS_TOKEN_SECRET;
    this.publicWebUrl = environment.PUBLIC_WEB_URL;
  }

  newMetadata(input: Omit<QuoteTokenMetadata, "tokenId">): QuoteTokenMetadata {
    return { tokenId: randomUUID(), ...input };
  }

  newTrackMetadata(input: Omit<TrackTokenMetadata, "tokenId">): TrackTokenMetadata {
    return { tokenId: randomUUID(), ...input };
  }

  deriveRawToken(metadata: QuoteTokenMetadata): string {
    const stableMetadata = JSON.stringify({
      version: 1,
      tokenId: metadata.tokenId,
      shopId: metadata.shopId,
      repairOrderId: metadata.repairOrderId,
      quoteVersionId: metadata.quoteVersionId,
      scope: "DECIDE_QUOTE",
      expiresAt: metadata.expiresAt,
    });
    return createHmac("sha256", this.secret).update(stableMetadata).digest("base64url");
  }

  deriveTrackRawToken(metadata: TrackTokenMetadata): string {
    const stableMetadata = JSON.stringify({
      version: 1,
      tokenId: metadata.tokenId,
      shopId: metadata.shopId,
      repairOrderId: metadata.repairOrderId,
      scope: "TRACK_ORDER",
      expiresAt: metadata.expiresAt,
    });
    return createHmac("sha256", this.secret).update(stableMetadata).digest("base64url");
  }

  hash(rawToken: string): string {
    return createHash("sha256").update(rawToken).digest("hex");
  }

  requestFingerprint(ip: string, userAgent: string): string {
    return this.privateHash("public-actor", `${ip}\u0000${userAgent}`);
  }

  rateLimitKey(rawToken: string, ip: string): string {
    return this.privateHash("public-rate-limit", `${rawToken}\u0000${ip}`);
  }

  idempotencyKeyHash(key: string): string {
    return this.privateHash("public-idempotency", key);
  }

  publicUrl(metadata: QuoteTokenMetadata): string {
    const rawToken = this.deriveRawToken(metadata);
    return new URL(`/p/${encodeURIComponent(rawToken)}`, this.publicWebUrl).toString();
  }

  trackPublicUrl(metadata: TrackTokenMetadata): string {
    const rawToken = this.deriveTrackRawToken(metadata);
    return new URL(`/p/${encodeURIComponent(rawToken)}`, this.publicWebUrl).toString();
  }

  private privateHash(purpose: string, value: string): string {
    return createHmac("sha256", this.secret).update(`${purpose}:v1:${value}`).digest("hex");
  }
}
