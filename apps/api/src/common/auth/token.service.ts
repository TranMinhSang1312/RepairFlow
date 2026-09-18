import { Injectable } from "@nestjs/common";
import { parseApiEnvironment } from "@repairflow/config";
import { createHmac, timingSafeEqual } from "node:crypto";

import type { AccessTokenClaims } from "./auth.types.js";

const ACCESS_TOKEN_TTL_SECONDS = 900;
const CLOCK_SKEW_SECONDS = 30;
const TOKEN_ISSUER = "repairflow-api";
const TOKEN_AUDIENCE = "repairflow-staff";

function base64Url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

function decodeBase64Url(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

@Injectable()
export class TokenService {
  private readonly secret: string;

  constructor() {
    this.secret = parseApiEnvironment(process.env).ACCESS_TOKEN_SECRET;
  }

  createAccessToken(userId: string): { token: string; expiresInSeconds: number } {
    const now = Math.floor(Date.now() / 1000);
    const claims: AccessTokenClaims = {
      sub: userId,
      iat: now,
      exp: now + ACCESS_TOKEN_TTL_SECONDS,
      typ: "access",
      iss: TOKEN_ISSUER,
      aud: TOKEN_AUDIENCE,
    };
    const header = base64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
    const payload = base64Url(JSON.stringify(claims));
    const unsigned = `${header}.${payload}`;
    const signature = createHmac("sha256", this.secret).update(unsigned).digest("base64url");

    return { token: `${unsigned}.${signature}`, expiresInSeconds: ACCESS_TOKEN_TTL_SECONDS };
  }

  verifyAccessToken(token: string): AccessTokenClaims | null {
    const [header, payload, signature] = token.split(".");
    if (!header || !payload || !signature) {
      return null;
    }

    try {
      const expected = createHmac("sha256", this.secret).update(`${header}.${payload}`).digest();
      const actual = Buffer.from(signature, "base64url");
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
        return null;
      }

      const parsedHeader = JSON.parse(decodeBase64Url(header)) as { alg?: string; typ?: string };
      const claims = JSON.parse(decodeBase64Url(payload)) as Partial<AccessTokenClaims>;
      const now = Math.floor(Date.now() / 1000);

      if (
        parsedHeader.alg !== "HS256" ||
        parsedHeader.typ !== "JWT" ||
        claims.typ !== "access" ||
        claims.iss !== TOKEN_ISSUER ||
        claims.aud !== TOKEN_AUDIENCE ||
        typeof claims.sub !== "string" ||
        claims.sub.length === 0 ||
        typeof claims.iat !== "number" ||
        typeof claims.exp !== "number" ||
        !Number.isSafeInteger(claims.iat) ||
        !Number.isSafeInteger(claims.exp) ||
        claims.iat > now + CLOCK_SKEW_SECONDS ||
        claims.exp <= claims.iat ||
        claims.exp <= now
      ) {
        return null;
      }

      return claims as AccessTokenClaims;
    } catch {
      return null;
    }
  }
}
