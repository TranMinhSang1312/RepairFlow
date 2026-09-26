import {
  DeviceType,
  NotificationChannel,
  NotificationStatus,
  OutboxStatus,
  QuoteStatus,
  TokenScope,
} from "@prisma/client";
import { loadWorkspaceEnvironment } from "@repairflow/config/node";
import {
  deriveNotificationDestinationHash,
  deriveQuotePublicToken,
  hashPublicToken,
} from "@repairflow/security";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { createPrismaClient } from "../database.js";
import { DatabaseNotificationMessageResolver } from "./notification-message-resolver.js";
import { NotificationOutboxHandler } from "./notification-outbox-handler.js";
import type { NotificationMessage, NotificationProvider } from "./notification-provider.js";
import { QUOTE_SENT_TEMPLATE_KEY } from "./quote-sent-email.template.js";
import { OutboxRepository } from "./outbox-repository.js";
import type { ClaimedOutboxEvent } from "./outbox.types.js";

loadWorkspaceEnvironment();

class CapturingProvider implements NotificationProvider {
  readonly messages: NotificationMessage[] = [];

  deliver(message: NotificationMessage): Promise<{ providerMessageId: string }> {
    this.messages.push(message);
    return Promise.resolve({ providerMessageId: `provider:${message.notificationDeliveryId}` });
  }
}

describe("immutable quote email delivery", () => {
  const databaseUrl = process.env.DATABASE_URL;
  const secret = process.env.PUBLIC_TOKEN_SECRET ?? process.env.ACCESS_TOKEN_SECRET;
  if (!databaseUrl || !secret) throw new Error("Database and token secret are required.");
  const prisma = createPrismaClient(databaseUrl);
  const shopIds: string[] = [];

  beforeAll(() => prisma.$connect());
  afterEach(async () => {
    await prisma.notificationDelivery.deleteMany({
      where: { outboxEvent: { shopId: { in: shopIds } } },
    });
    await prisma.outboxEvent.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.publicAccessToken.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.quoteVersion.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.repairOrder.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.device.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.customer.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.branch.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.shop.deleteMany({ where: { id: { in: shopIds } } });
    shopIds.splice(0);
  });
  afterAll(() => prisma.$disconnect());

  it("uses the intake snapshot and never persists the derived raw token in outbox records", async () => {
    const suffix = randomUUID().slice(0, 8);
    const actorUserId = randomUUID();
    const snapshotEmail = `snapshot-${suffix}@example.test`;
    const currentEmail = `changed-${suffix}@example.test`;
    const shop = await prisma.shop.create({
      data: { name: "RepairFlow <Demo>", slug: `rf051-${suffix}` },
    });
    shopIds.push(shop.id);
    const branch = await prisma.branch.create({ data: { shopId: shop.id, name: "Main" } });
    const customer = await prisma.customer.create({
      data: {
        shopId: shop.id,
        name: "Snapshot Customer",
        phoneRaw: "0900000051",
        phoneNormalized: "0900000051",
        email: snapshotEmail,
      },
    });
    const device = await prisma.device.create({
      data: {
        shopId: shop.id,
        customerId: customer.id,
        type: DeviceType.PHONE,
        brand: "Apple",
        model: "iPhone 15",
      },
    });
    const order = await prisma.repairOrder.create({
      data: {
        shopId: shop.id,
        branchId: branch.id,
        customerId: customer.id,
        deviceId: device.id,
        orderNo: 1,
        code: `RF-${suffix}`,
        reportedProblem: "Screen issue",
        intakeCondition: "Used",
        consentAcknowledgedAt: new Date("2026-09-25T00:00:00.000Z"),
        customerSnapshot: { name: customer.name, email: snapshotEmail, phone: customer.phoneRaw },
        deviceSnapshot: { type: "PHONE", brand: device.brand, model: device.model },
        createdByUserId: actorUserId,
      },
    });
    const expiresAt = new Date("2026-09-30T00:00:00.000Z");
    const quote = await prisma.quoteVersion.create({
      data: {
        shopId: shop.id,
        repairOrderId: order.id,
        versionNo: 1,
        status: QuoteStatus.SENT,
        subtotal: 800_000n,
        total: 800_000n,
        expiresAt,
        sentAt: new Date("2026-09-25T01:00:00.000Z"),
        createdByUserId: actorUserId,
      },
    });
    const tokenMetadata = {
      tokenId: randomUUID(),
      shopId: shop.id,
      repairOrderId: order.id,
      quoteVersionId: quote.id,
      expiresAt: expiresAt.toISOString(),
    };
    const rawToken = deriveQuotePublicToken(secret, tokenMetadata);
    await prisma.publicAccessToken.create({
      data: {
        id: tokenMetadata.tokenId,
        shopId: shop.id,
        repairOrderId: order.id,
        quoteVersionId: quote.id,
        scope: TokenScope.DECIDE_QUOTE,
        tokenHash: hashPublicToken(rawToken),
        expiresAt,
      },
    });
    const event = await prisma.outboxEvent.create({
      data: {
        shopId: shop.id,
        eventType: "QUOTE_SENT",
        aggregateType: "QUOTE_VERSION",
        aggregateId: quote.id,
        payload: {
          repairOrderId: order.id,
          quoteVersionId: quote.id,
          tokenRecordId: tokenMetadata.tokenId,
          tokenScope: TokenScope.DECIDE_QUOTE,
          channel: NotificationChannel.EMAIL,
          templateKey: QUOTE_SENT_TEMPLATE_KEY,
          expiresAt: expiresAt.toISOString(),
        },
        status: OutboxStatus.PROCESSING,
        attempts: 1,
        lockedAt: new Date("2026-09-26T00:00:00.000Z"),
        lockedBy: "worker-rf051",
        notifications: {
          create: {
            channel: NotificationChannel.EMAIL,
            destinationHash: deriveNotificationDestinationHash(secret, "EMAIL", snapshotEmail),
          },
        },
      },
      include: { notifications: true },
    });
    await prisma.customer.update({ where: { id: customer.id }, data: { email: currentEmail } });

    const claimed: ClaimedOutboxEvent = {
      id: event.id,
      shopId: event.shopId,
      eventType: event.eventType,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      payload: event.payload,
      attempts: event.attempts,
      lockedAt: event.lockedAt!,
      lockedBy: event.lockedBy!,
      notifications: event.notifications.map((item) => ({
        id: item.id,
        channel: item.channel,
        destinationHash: item.destinationHash,
        status: item.status,
        attempts: item.attempts,
      })),
    };
    const provider = new CapturingProvider();
    const repository = new OutboxRepository(prisma);
    const resolver = new DatabaseNotificationMessageResolver(
      prisma,
      secret,
      "https://app.example.test",
    );
    await new NotificationOutboxHandler(repository, resolver, provider).handle(
      claimed,
      new Date("2026-09-26T00:00:00.000Z"),
    );

    expect(provider.messages).toHaveLength(1);
    expect(provider.messages[0]).toMatchObject({ to: snapshotEmail });
    expect(provider.messages[0]!.text).toContain(rawToken);
    expect(provider.messages[0]!.text).not.toContain(currentEmail);
    const persistedEvent = await prisma.outboxEvent.findUniqueOrThrow({
      where: { id: event.id },
      include: { notifications: true },
    });
    expect(persistedEvent.notifications[0]).toMatchObject({
      status: NotificationStatus.SENT,
      providerMessageId: `provider:${event.notifications[0]!.id}`,
    });
    const persistedDeliveryData = JSON.stringify({
      payload: persistedEvent.payload,
      delivery: persistedEvent.notifications[0],
    });
    expect(persistedDeliveryData).not.toContain(rawToken);
    expect(persistedDeliveryData).not.toContain(snapshotEmail);
    expect(persistedDeliveryData).not.toContain(currentEmail);
  });
});
