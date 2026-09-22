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

  hash(rawToken: string): string {
    return createHash("sha256").update(rawToken).digest("hex");
  }

  publicUrl(metadata: QuoteTokenMetadata): string {
    const rawToken = this.deriveRawToken(metadata);
    return new URL(`/p/${encodeURIComponent(rawToken)}`, this.publicWebUrl).toString();
  }
}
