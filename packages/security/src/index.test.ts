import { describe, expect, it } from "vitest";

import {
  buildPublicTokenUrl,
  deriveNotificationDestinationHash,
  deriveQuotePublicToken,
  deriveTrackPublicToken,
  hashPublicToken,
  normalizeNotificationDestination,
  secureHexEqual,
} from "./index.js";

const secret = "test-secret-that-is-at-least-32-characters-long";

describe("shared security derivation", () => {
  it("derives stable purpose-separated public tokens", () => {
    const common = {
      tokenId: "00000000-0000-4000-8000-000000000001",
      shopId: "00000000-0000-4000-8000-000000000002",
      repairOrderId: "00000000-0000-4000-8000-000000000003",
      expiresAt: "2026-09-30T00:00:00.000Z",
    };
    const quoteMetadata = {
      ...common,
      quoteVersionId: "00000000-0000-4000-8000-000000000004",
    };
    const quote = deriveQuotePublicToken(secret, quoteMetadata);
    const track = deriveTrackPublicToken(secret, common);

    expect(quote).toBe(deriveQuotePublicToken(secret, quoteMetadata));
    expect(quote).toBe("E3bVd7p0-v6XxO0HkI8nXBHf46WT5NUFn1U0FPAZEsk");
    expect(track).toBe("64jgC3_jyLF3hY8DW2iVLss2so92LXobG9i6mjlK1uo");
    expect(track).not.toBe(quote);
    expect(hashPublicToken(quote)).toMatch(/^[a-f\d]{64}$/u);
    expect(buildPublicTokenUrl("https://app.example.test/base", quote)).toBe(
      `https://app.example.test/p/${quote}`,
    );
  });

  it("normalizes destinations before hashing and compares hashes safely", () => {
    const email = normalizeNotificationDestination("EMAIL", "  Customer@Example.COM ");
    expect(email).toBe("customer@example.com");
    const hash = deriveNotificationDestinationHash(secret, "EMAIL", email!);
    expect(secureHexEqual(hash, hash.toUpperCase())).toBe(true);
    expect(secureHexEqual(hash, "0".repeat(64))).toBe(false);
    expect(secureHexEqual(hash, "not-hex")).toBe(false);
    expect(secureHexEqual("a", "b")).toBe(false);
  });
});
