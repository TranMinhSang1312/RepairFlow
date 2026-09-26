import { NotificationChannel, NotificationStatus } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import {
  deriveNotificationDestinationHash,
  deriveQuotePublicToken,
  hashPublicToken,
} from "@repairflow/security";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DatabaseNotificationMessageResolver } from "./notification-message-resolver.js";
import { OutboxDeliveryError } from "./outbox-errors.js";
import { QUOTE_SENT_TEMPLATE_KEY } from "./quote-sent-email.template.js";
import type { ClaimedNotificationDelivery, ClaimedOutboxEvent } from "./outbox.types.js";

const secret = "test-secret-that-is-at-least-32-characters-long";
const ids = {
  shop: "00000000-0000-4000-8000-000000000001",
  order: "00000000-0000-4000-8000-000000000002",
  quote: "00000000-0000-4000-8000-000000000003",
  token: "00000000-0000-4000-8000-000000000004",
  event: "00000000-0000-4000-8000-000000000005",
  delivery: "00000000-0000-4000-8000-000000000006",
};
const expiresAt = new Date("2026-09-30T00:00:00.000Z");
const now = new Date("2026-09-26T00:00:00.000Z");
const destination = "snapshot@example.test";

const metadata = {
  tokenId: ids.token,
  shopId: ids.shop,
  repairOrderId: ids.order,
  quoteVersionId: ids.quote,
  expiresAt: expiresAt.toISOString(),
};
const rawToken = deriveQuotePublicToken(secret, metadata);

function event(overrides?: Partial<ClaimedOutboxEvent>): ClaimedOutboxEvent {
  return {
    id: ids.event,
    shopId: ids.shop,
    eventType: "QUOTE_SENT",
    aggregateType: "QUOTE_VERSION",
    aggregateId: ids.quote,
    payload: {
      repairOrderId: ids.order,
      quoteVersionId: ids.quote,
      tokenRecordId: ids.token,
      tokenScope: "DECIDE_QUOTE",
      channel: "EMAIL",
      templateKey: QUOTE_SENT_TEMPLATE_KEY,
      expiresAt: expiresAt.toISOString(),
    },
    attempts: 1,
    lockedAt: now,
    lockedBy: "worker-test",
    notifications: [],
    ...overrides,
  };
}

function delivery(overrides?: Partial<ClaimedNotificationDelivery>): ClaimedNotificationDelivery {
  return {
    id: ids.delivery,
    channel: NotificationChannel.EMAIL,
    destinationHash: deriveNotificationDestinationHash(secret, "EMAIL", destination),
    status: NotificationStatus.PENDING,
    attempts: 0,
    ...overrides,
  };
}

function quoteResult() {
  return {
    id: ids.quote,
    total: 1_250_000n,
    currency: "VND",
    repairOrder: {
      id: ids.order,
      code: "RF-2026-000001",
      customerSnapshot: {
        name: '<Customer & "Friend">',
        email: " Snapshot@Example.Test ",
      },
      deviceSnapshot: { brand: "Apple", model: "iPhone 15", type: "PHONE" },
      shop: { name: "RepairFlow Demo" },
    },
  };
}

function tokenResult(overrides?: Record<string, unknown>) {
  return {
    id: ids.token,
    shopId: ids.shop,
    repairOrderId: ids.order,
    quoteVersionId: ids.quote,
    tokenHash: hashPublicToken(rawToken),
    expiresAt,
    revokedAt: null,
    ...overrides,
  };
}

describe("DatabaseNotificationMessageResolver", () => {
  const quoteFindFirst = vi.fn();
  const tokenFindFirst = vi.fn();
  const prisma = {
    quoteVersion: { findFirst: quoteFindFirst },
    publicAccessToken: { findFirst: tokenFindFirst },
  } as unknown as PrismaClient;
  const resolver = new DatabaseNotificationMessageResolver(
    prisma,
    secret,
    "https://app.example.test",
  );

  beforeEach(() => {
    vi.clearAllMocks();
    quoteFindFirst.mockResolvedValue(quoteResult());
    tokenFindFirst.mockResolvedValue(tokenResult());
  });

  it("resolves destination and content only from tenant-bound immutable records", async () => {
    const message = await resolver.resolve(event(), delivery(), now);

    expect(message).toMatchObject({
      outboxEventId: ids.event,
      notificationDeliveryId: ids.delivery,
      channel: "EMAIL",
      to: destination,
      idempotencyKey: `outbox:${ids.event}:notification:${ids.delivery}`,
    });
    expect(message.text).toContain(`https://app.example.test/p/${rawToken}`);
    expect(message.text).toContain("1.250.000 VND");
    expect(message.html).toContain("&lt;Customer &amp; &quot;Friend&quot;&gt;");
    expect(quoteFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: ids.quote, shopId: ids.shop, repairOrderId: ids.order },
      }),
    );
    expect(tokenFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: ids.token,
          shopId: ids.shop,
          repairOrderId: ids.order,
          quoteVersionId: ids.quote,
        }),
      }),
    );
    expect(JSON.stringify(event())).not.toContain(rawToken);
    expect(JSON.stringify(delivery())).not.toContain(destination);
  });

  it("rejects a cross-tenant or missing aggregate without looking up the token", async () => {
    quoteFindFirst.mockResolvedValue(null);
    await expect(resolver.resolve(event(), delivery(), now)).rejects.toMatchObject({
      code: "NOTIFICATION_CONTEXT_INVALID",
      retryable: false,
    });
    expect(tokenFindFirst).not.toHaveBeenCalled();
  });

  it("rejects destination mutation instead of sending to a changed address", async () => {
    await expect(
      resolver.resolve(event(), delivery({ destinationHash: "0".repeat(64) }), now),
    ).rejects.toMatchObject({
      code: "NOTIFICATION_DESTINATION_MISMATCH",
      retryable: false,
    });
  });

  it.each([
    ["revoked", { revokedAt: new Date("2026-09-25T00:00:00.000Z") }, "PUBLIC_LINK_INVALID"],
    ["expired", { expiresAt: new Date("2026-09-25T00:00:00.000Z") }, "PUBLIC_LINK_EXPIRED"],
    ["hash mismatch", { tokenHash: "0".repeat(64) }, "PUBLIC_LINK_INTEGRITY_FAILED"],
  ])("rejects a %s public token permanently", async (_label, tokenOverrides, code) => {
    tokenFindFirst.mockResolvedValue(tokenResult(tokenOverrides));
    await expect(resolver.resolve(event(), delivery(), now)).rejects.toMatchObject({
      code,
      retryable: false,
    });
  });

  it("rejects an unversioned or mismatched event contract", async () => {
    const malformed = event({ payload: { tokenRecordId: ids.token } });
    const error = resolver.resolve(malformed, delivery(), now);
    await expect(error).rejects.toBeInstanceOf(OutboxDeliveryError);
    await expect(error).rejects.toMatchObject({
      code: "NOTIFICATION_PAYLOAD_INVALID",
      retryable: false,
    });
    expect(quoteFindFirst).not.toHaveBeenCalled();
  });
});
