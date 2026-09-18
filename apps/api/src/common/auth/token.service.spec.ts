import { afterEach, describe, expect, it, vi } from "vitest";

import { TokenService } from "./token.service.js";

describe("TokenService", () => {
  afterEach(() => vi.useRealTimers());

  it("creates a signed, scoped access token", () => {
    const service = new TokenService();
    const issued = service.createAccessToken("user-123");

    expect(service.verifyAccessToken(issued.token)).toMatchObject({
      sub: "user-123",
      typ: "access",
      iss: "repairflow-api",
      aud: "repairflow-staff",
    });
    expect(issued.expiresInSeconds).toBe(900);
  });

  it("rejects tampered and expired access tokens", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const service = new TokenService();
    const { token } = service.createAccessToken("user-123");
    const parts = token.split(".");
    const signature = parts[2]!;
    const changedFirstCharacter = signature[0] === "A" ? "B" : "A";
    const tampered = `${parts[0]}.${parts[1]}.${changedFirstCharacter}${signature.slice(1)}`;

    expect(service.verifyAccessToken(tampered)).toBeNull();

    vi.setSystemTime(new Date("2026-01-01T00:15:01.000Z"));
    expect(service.verifyAccessToken(token)).toBeNull();
  });
});
