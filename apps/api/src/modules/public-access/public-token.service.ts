import { Injectable } from "@nestjs/common";
import { parseApiEnvironment } from "@repairflow/config";
import {
  buildPublicTokenUrl,
  deriveQuotePublicToken,
  deriveTrackPublicToken,
  hashPublicToken,
  type QuotePublicTokenMetadata,
  type TrackPublicTokenMetadata,
} from "@repairflow/security";
import { createHmac, randomUUID } from "node:crypto";

export type QuoteTokenMetadata = QuotePublicTokenMetadata;
export type TrackTokenMetadata = TrackPublicTokenMetadata;

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
    return deriveQuotePublicToken(this.secret, metadata);
  }

  deriveTrackRawToken(metadata: TrackTokenMetadata): string {
    return deriveTrackPublicToken(this.secret, metadata);
  }

  hash(rawToken: string): string {
    return hashPublicToken(rawToken);
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
    return buildPublicTokenUrl(this.publicWebUrl, this.deriveRawToken(metadata));
  }

  trackPublicUrl(metadata: TrackTokenMetadata): string {
    return buildPublicTokenUrl(this.publicWebUrl, this.deriveTrackRawToken(metadata));
  }

  private privateHash(purpose: string, value: string): string {
    return createHmac("sha256", this.secret).update(`${purpose}:v1:${value}`).digest("hex");
  }
}
