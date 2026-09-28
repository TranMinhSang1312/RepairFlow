import { describe, expect, it } from "vitest";

import {
  buildPublicTokenUrl,
  buildStaffInvitationUrl,
  deriveNotificationDestinationHash,
  deriveQuotePublicToken,
  deriveStaffInvitationToken,
  deriveTrackPublicToken,
  hashPublicToken,
  normalizeNotificationDestination,
  redactAiInput,
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
    const invitationMetadata = {
      invitationId: "00000000-0000-4000-8000-000000000005",
      expiresAt: common.expiresAt,
    };
    const invitation = deriveStaffInvitationToken(secret, invitationMetadata);

    expect(quote).toBe(deriveQuotePublicToken(secret, quoteMetadata));
    expect(quote).toBe("E3bVd7p0-v6XxO0HkI8nXBHf46WT5NUFn1U0FPAZEsk");
    expect(track).toBe("64jgC3_jyLF3hY8DW2iVLss2so92LXobG9i6mjlK1uo");
    expect(track).not.toBe(quote);
    expect(invitation).toBe(deriveStaffInvitationToken(secret, invitationMetadata));
    expect(invitation).not.toBe(quote);
    expect(invitation).not.toBe(track);
    expect(hashPublicToken(quote)).toMatch(/^[a-f\d]{64}$/u);
    expect(buildPublicTokenUrl("https://app.example.test/base", quote)).toBe(
      `https://app.example.test/p/${quote}`,
    );
    expect(buildStaffInvitationUrl("https://app.example.test/base", invitation)).toBe(
      `https://app.example.test/join/${invitation}`,
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

  it("removes contact and credential canaries from AI input", () => {
    const result = redactAiInput({
      deviceType: "PHONE",
      customerEmail: "person-canary@example.test",
      notes: "Call +84 912 345 678 and never expose Bearer secret-token-canary",
      nested: { unlockPin: "7391", symptom: "Không lên nguồn" },
    });
    const serialized = JSON.stringify(result.value);
    expect(result.redactions).toBeGreaterThanOrEqual(4);
    expect(serialized).not.toContain("person-canary");
    expect(serialized).not.toContain("912 345 678");
    expect(serialized).not.toContain("secret-token-canary");
    expect(serialized).not.toContain("7391");
    expect(serialized).toContain("Không lên nguồn");
  });
});
