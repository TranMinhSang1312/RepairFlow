import { describe, expect, it } from "vitest";

import { PublicTokenService } from "../public-access/public-token.service.js";
import { StaffInvitationTokenService } from "./staff-invitation-token.service.js";

describe("StaffInvitationTokenService", () => {
  it("derives deterministic purpose-separated tokens and stores a one-way hash", () => {
    const service = new StaffInvitationTokenService();
    const metadata = {
      invitationId: "11111111-1111-4111-8111-111111111111",
      expiresAt: "2026-09-29T00:00:00.000Z",
    };
    const first = service.deriveRaw(metadata);
    expect(service.deriveRaw(metadata)).toBe(first);
    expect(service.hash(first)).not.toContain(first);
    expect(service.publicUrl(metadata)).toContain(encodeURIComponent(first));

    const publicTokens = new PublicTokenService();
    const quoteToken = publicTokens.deriveRawToken({
      tokenId: metadata.invitationId,
      shopId: "22222222-2222-4222-8222-222222222222",
      repairOrderId: "33333333-3333-4333-8333-333333333333",
      quoteVersionId: "44444444-4444-4444-8444-444444444444",
      expiresAt: metadata.expiresAt,
    });
    expect(first).not.toBe(quoteToken);
  });
});
