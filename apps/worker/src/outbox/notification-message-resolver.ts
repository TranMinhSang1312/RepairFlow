import { NotificationChannel, TokenScope } from "@prisma/client";
import type { Prisma, PrismaClient } from "@prisma/client";
import {
  buildPublicTokenUrl,
  deriveNotificationDestinationHash,
  deriveQuotePublicToken,
  hashPublicToken,
  normalizeNotificationDestination,
  secureHexEqual,
} from "@repairflow/security";

import { OutboxDeliveryError } from "./outbox-errors.js";
import type { NotificationMessage } from "./notification-provider.js";
import { QUOTE_SENT_TEMPLATE_KEY, renderQuoteSentEmail } from "./quote-sent-email.template.js";
import type { ClaimedNotificationDelivery, ClaimedOutboxEvent } from "./outbox.types.js";

interface QuoteSentPayload {
  repairOrderId: string;
  quoteVersionId: string;
  tokenRecordId: string;
  expiresAt: string;
  templateKey: typeof QUOTE_SENT_TEMPLATE_KEY;
}

export interface NotificationMessageResolver {
  resolve(
    event: ClaimedOutboxEvent,
    delivery: ClaimedNotificationDelivery,
    now: Date,
  ): Promise<NotificationMessage>;
}

export class DatabaseNotificationMessageResolver implements NotificationMessageResolver {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly secret: string,
    private readonly publicWebUrl: string,
  ) {}

  async resolve(
    event: ClaimedOutboxEvent,
    delivery: ClaimedNotificationDelivery,
    now: Date,
  ): Promise<NotificationMessage> {
    if (delivery.channel !== NotificationChannel.EMAIL) {
      throw permanent("NOTIFICATION_CHANNEL_UNSUPPORTED");
    }
    const payload = parseQuoteSentPayload(event);
    const quote = await this.prisma.quoteVersion.findFirst({
      where: {
        id: event.aggregateId,
        shopId: event.shopId,
        repairOrderId: payload.repairOrderId,
      },
      select: {
        id: true,
        total: true,
        currency: true,
        repairOrder: {
          select: {
            id: true,
            code: true,
            customerSnapshot: true,
            deviceSnapshot: true,
            shop: { select: { name: true } },
          },
        },
      },
    });
    if (!quote || quote.id !== payload.quoteVersionId) {
      throw permanent("NOTIFICATION_CONTEXT_INVALID");
    }

    const token = await this.prisma.publicAccessToken.findFirst({
      where: {
        id: payload.tokenRecordId,
        shopId: event.shopId,
        repairOrderId: payload.repairOrderId,
        quoteVersionId: payload.quoteVersionId,
        scope: TokenScope.DECIDE_QUOTE,
      },
      select: {
        id: true,
        shopId: true,
        repairOrderId: true,
        quoteVersionId: true,
        tokenHash: true,
        expiresAt: true,
        revokedAt: true,
      },
    });
    if (!token || !token.quoteVersionId || token.revokedAt) {
      throw permanent("PUBLIC_LINK_INVALID");
    }
    if (token.expiresAt.getTime() <= now.getTime()) {
      throw permanent("PUBLIC_LINK_EXPIRED");
    }
    const payloadExpiry = Date.parse(payload.expiresAt);
    if (!Number.isFinite(payloadExpiry) || payloadExpiry !== token.expiresAt.getTime()) {
      throw permanent("NOTIFICATION_CONTEXT_INVALID");
    }

    const snapshot = jsonObject(quote.repairOrder.customerSnapshot);
    const destination = normalizeNotificationDestination("EMAIL", snapshot.email);
    if (!destination) throw permanent("NOTIFICATION_DESTINATION_MISSING");
    const expectedDestinationHash = deriveNotificationDestinationHash(
      this.secret,
      "EMAIL",
      destination,
    );
    if (!secureHexEqual(expectedDestinationHash, delivery.destinationHash)) {
      throw permanent("NOTIFICATION_DESTINATION_MISMATCH");
    }

    const metadata = {
      tokenId: token.id,
      shopId: token.shopId,
      repairOrderId: token.repairOrderId,
      quoteVersionId: token.quoteVersionId,
      expiresAt: token.expiresAt.toISOString(),
    };
    const rawToken = deriveQuotePublicToken(this.secret, metadata);
    if (!secureHexEqual(hashPublicToken(rawToken), token.tokenHash)) {
      throw permanent("PUBLIC_LINK_INTEGRITY_FAILED");
    }
    const publicUrl = buildPublicTokenUrl(this.publicWebUrl, rawToken);
    const rendered = renderQuoteSentEmail({
      shopName: quote.repairOrder.shop.name,
      customerName: stringValue(snapshot.name) ?? "Quý khách",
      orderCode: quote.repairOrder.code,
      deviceLabel: deviceLabel(quote.repairOrder.deviceSnapshot),
      total: quote.total,
      currency: quote.currency,
      expiresAt: token.expiresAt,
      publicUrl,
    });
    return {
      outboxEventId: event.id,
      notificationDeliveryId: delivery.id,
      channel: "EMAIL",
      idempotencyKey: `outbox:${event.id}:notification:${delivery.id}`,
      to: destination,
      ...rendered,
    };
  }
}

function parseQuoteSentPayload(event: ClaimedOutboxEvent): QuoteSentPayload {
  if (event.eventType !== "QUOTE_SENT" || event.aggregateType !== "QUOTE_VERSION") {
    throw permanent("NOTIFICATION_EVENT_UNSUPPORTED");
  }
  const payload = jsonObject(event.payload);
  const repairOrderId = stringValue(payload.repairOrderId);
  const quoteVersionId = stringValue(payload.quoteVersionId);
  const tokenRecordId = stringValue(payload.tokenRecordId);
  const expiresAt = stringValue(payload.expiresAt);
  const tokenScope = stringValue(payload.tokenScope);
  const channel = stringValue(payload.channel);
  const templateKey = stringValue(payload.templateKey) ?? QUOTE_SENT_TEMPLATE_KEY;
  if (
    !repairOrderId ||
    !quoteVersionId ||
    !tokenRecordId ||
    !expiresAt ||
    quoteVersionId !== event.aggregateId ||
    tokenScope !== TokenScope.DECIDE_QUOTE ||
    channel !== NotificationChannel.EMAIL ||
    templateKey !== QUOTE_SENT_TEMPLATE_KEY
  ) {
    throw permanent("NOTIFICATION_PAYLOAD_INVALID");
  }
  return { repairOrderId, quoteVersionId, tokenRecordId, expiresAt, templateKey };
}

function deviceLabel(value: Prisma.JsonValue): string {
  const snapshot = jsonObject(value);
  const parts = [snapshot.brand, snapshot.model, snapshot.type]
    .map(stringValue)
    .filter((part): part is string => Boolean(part));
  return parts.join(" ") || "Thiết bị";
}

function jsonObject(value: Prisma.JsonValue): Record<string, Prisma.JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, Prisma.JsonValue>)
    : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function permanent(code: string): OutboxDeliveryError {
  return new OutboxDeliveryError(code, false);
}
