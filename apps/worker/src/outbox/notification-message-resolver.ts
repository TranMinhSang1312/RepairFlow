import { NotificationChannel, StaffInvitationStatus, TokenScope } from "@prisma/client";
import type { Prisma, PrismaClient } from "@prisma/client";
import {
  buildPublicTokenUrl,
  buildStaffInvitationUrl,
  deriveNotificationDestinationHash,
  deriveQuotePublicToken,
  deriveStaffInvitationToken,
  deriveTrackPublicToken,
  hashPublicToken,
  normalizeNotificationDestination,
  secureHexEqual,
} from "@repairflow/security";

import { OutboxDeliveryError } from "./outbox-errors.js";
import type { NotificationMessage } from "./notification-provider.js";
import { QUOTE_SENT_TEMPLATE_KEY, renderQuoteSentEmail } from "./quote-sent-email.template.js";
import {
  HANDOVER_COMPLETED_TEMPLATE_KEY,
  REPAIR_ORDER_READY_TEMPLATE_KEY,
  renderHandoverCompletedEmail,
  renderRepairOrderReadyEmail,
} from "./repair-order-email.templates.js";
import {
  STAFF_INVITATION_TEMPLATE_KEY,
  renderStaffInvitationEmail,
} from "./staff-invitation-email.template.js";
import type { ClaimedNotificationDelivery, ClaimedOutboxEvent } from "./outbox.types.js";

interface QuoteSentPayload {
  repairOrderId: string;
  quoteVersionId: string;
  tokenRecordId: string;
  expiresAt: string;
}

interface RepairOrderReadyPayload {
  repairOrderId: string;
}

interface HandoverCompletedPayload {
  repairOrderId: string;
  tokenRecordId: string;
  expiresAt: string;
  handedOverAt: string;
}

interface StaffInvitationPayload {
  invitationId: string;
  expiresAt: string;
}

interface ResolvedDestination {
  messageBase: Pick<
    NotificationMessage,
    "outboxEventId" | "notificationDeliveryId" | "channel" | "idempotencyKey" | "to"
  >;
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

  resolve(
    event: ClaimedOutboxEvent,
    delivery: ClaimedNotificationDelivery,
    now: Date,
  ): Promise<NotificationMessage> {
    if (delivery.channel !== NotificationChannel.EMAIL) {
      throw permanent("NOTIFICATION_CHANNEL_UNSUPPORTED");
    }
    switch (event.eventType) {
      case "QUOTE_SENT":
        return this.resolveQuoteSent(event, delivery, now);
      case "REPAIR_ORDER_READY":
        return this.resolveRepairOrderReady(event, delivery);
      case "REPAIR_ORDER_COMPLETED":
        return this.resolveHandoverCompleted(event, delivery, now);
      case "STAFF_INVITATION_CREATED":
        return this.resolveStaffInvitation(event, delivery, now);
      default:
        throw permanent("NOTIFICATION_EVENT_UNSUPPORTED");
    }
  }

  private async resolveQuoteSent(
    event: ClaimedOutboxEvent,
    delivery: ClaimedNotificationDelivery,
    now: Date,
  ): Promise<NotificationMessage> {
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
    this.assertExpiry(payload.expiresAt, token.expiresAt, now);

    const snapshot = jsonObject(quote.repairOrder.customerSnapshot);
    const resolved = this.resolveDestination(event, delivery, snapshot.email);
    const rawToken = deriveQuotePublicToken(this.secret, {
      tokenId: token.id,
      shopId: token.shopId,
      repairOrderId: token.repairOrderId,
      quoteVersionId: token.quoteVersionId,
      expiresAt: token.expiresAt.toISOString(),
    });
    this.assertTokenHash(rawToken, token.tokenHash);
    return {
      ...resolved.messageBase,
      ...renderQuoteSentEmail({
        shopName: quote.repairOrder.shop.name,
        customerName: stringValue(snapshot.name) ?? "Quý khách",
        orderCode: quote.repairOrder.code,
        deviceLabel: deviceLabel(quote.repairOrder.deviceSnapshot),
        total: quote.total,
        currency: quote.currency,
        expiresAt: token.expiresAt,
        publicUrl: buildPublicTokenUrl(this.publicWebUrl, rawToken),
      }),
    };
  }

  private async resolveRepairOrderReady(
    event: ClaimedOutboxEvent,
    delivery: ClaimedNotificationDelivery,
  ): Promise<NotificationMessage> {
    const payload = parseRepairOrderReadyPayload(event);
    const order = await this.loadRepairOrder(event, payload.repairOrderId);
    const snapshot = jsonObject(order.customerSnapshot);
    const resolved = this.resolveDestination(event, delivery, snapshot.email);
    return {
      ...resolved.messageBase,
      ...renderRepairOrderReadyEmail({
        shopName: order.shop.name,
        customerName: stringValue(snapshot.name) ?? "Quý khách",
        orderCode: order.code,
        deviceLabel: deviceLabel(order.deviceSnapshot),
      }),
    };
  }

  private async resolveHandoverCompleted(
    event: ClaimedOutboxEvent,
    delivery: ClaimedNotificationDelivery,
    now: Date,
  ): Promise<NotificationMessage> {
    const payload = parseHandoverCompletedPayload(event);
    const order = await this.loadCompletedRepairOrder(event, payload.repairOrderId);
    if (!order.handover || order.handover.handedOverAt.toISOString() !== payload.handedOverAt) {
      throw permanent("NOTIFICATION_CONTEXT_INVALID");
    }
    const token = await this.prisma.publicAccessToken.findFirst({
      where: {
        id: payload.tokenRecordId,
        shopId: event.shopId,
        repairOrderId: payload.repairOrderId,
        quoteVersionId: null,
        scope: TokenScope.TRACK_ORDER,
      },
      select: {
        id: true,
        shopId: true,
        repairOrderId: true,
        tokenHash: true,
        expiresAt: true,
        revokedAt: true,
      },
    });
    if (!token || token.revokedAt) throw permanent("PUBLIC_LINK_INVALID");
    this.assertExpiry(payload.expiresAt, token.expiresAt, now);

    const snapshot = jsonObject(order.customerSnapshot);
    const resolved = this.resolveDestination(event, delivery, snapshot.email);
    const rawToken = deriveTrackPublicToken(this.secret, {
      tokenId: token.id,
      shopId: token.shopId,
      repairOrderId: token.repairOrderId,
      expiresAt: token.expiresAt.toISOString(),
    });
    this.assertTokenHash(rawToken, token.tokenHash);
    return {
      ...resolved.messageBase,
      ...renderHandoverCompletedEmail({
        shopName: order.shop.name,
        customerName: stringValue(snapshot.name) ?? "Quý khách",
        orderCode: order.code,
        deviceLabel: deviceLabel(order.deviceSnapshot),
        handedOverAt: order.handover.handedOverAt,
        warrantyEndsAt: order.warranty?.endsAt ?? null,
        trackingUrl: buildPublicTokenUrl(this.publicWebUrl, rawToken),
      }),
    };
  }

  private async resolveStaffInvitation(
    event: ClaimedOutboxEvent,
    delivery: ClaimedNotificationDelivery,
    now: Date,
  ): Promise<NotificationMessage> {
    const payload = parseStaffInvitationPayload(event);
    const invitation = await this.prisma.staffInvitation.findFirst({
      where: { id: event.aggregateId, shopId: event.shopId },
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
        tokenHash: true,
        expiresAt: true,
        shop: { select: { name: true } },
      },
    });
    if (!invitation || invitation.id !== payload.invitationId) {
      throw permanent("NOTIFICATION_CONTEXT_INVALID");
    }
    if (invitation.status !== StaffInvitationStatus.PENDING) {
      throw permanent("STAFF_INVITATION_STALE");
    }
    this.assertExpiry(payload.expiresAt, invitation.expiresAt, now);
    const resolved = this.resolveDestination(event, delivery, invitation.email);
    const rawToken = deriveStaffInvitationToken(this.secret, {
      invitationId: invitation.id,
      expiresAt: invitation.expiresAt.toISOString(),
    });
    this.assertTokenHash(rawToken, invitation.tokenHash);
    return {
      ...resolved.messageBase,
      ...renderStaffInvitationEmail({
        shopName: invitation.shop.name,
        role: invitation.role,
        expiresAt: invitation.expiresAt,
        setupUrl: buildStaffInvitationUrl(this.publicWebUrl, rawToken),
      }),
    };
  }

  private async loadRepairOrder(event: ClaimedOutboxEvent, repairOrderId: string) {
    const order = await this.prisma.repairOrder.findFirst({
      where: { id: event.aggregateId, shopId: event.shopId },
      select: {
        id: true,
        code: true,
        customerSnapshot: true,
        deviceSnapshot: true,
        shop: { select: { name: true } },
      },
    });
    if (!order || order.id !== repairOrderId) {
      throw permanent("NOTIFICATION_CONTEXT_INVALID");
    }
    return order;
  }

  private async loadCompletedRepairOrder(event: ClaimedOutboxEvent, repairOrderId: string) {
    const order = await this.prisma.repairOrder.findFirst({
      where: { id: event.aggregateId, shopId: event.shopId },
      select: {
        id: true,
        code: true,
        customerSnapshot: true,
        deviceSnapshot: true,
        shop: { select: { name: true } },
        handover: { select: { handedOverAt: true } },
        warranty: { select: { endsAt: true } },
      },
    });
    if (!order || order.id !== repairOrderId) {
      throw permanent("NOTIFICATION_CONTEXT_INVALID");
    }
    return order;
  }

  private resolveDestination(
    event: ClaimedOutboxEvent,
    delivery: ClaimedNotificationDelivery,
    value: unknown,
  ): ResolvedDestination {
    const destination = normalizeNotificationDestination("EMAIL", value);
    if (!destination) throw permanent("NOTIFICATION_DESTINATION_MISSING");
    const expectedDestinationHash = deriveNotificationDestinationHash(
      this.secret,
      "EMAIL",
      destination,
    );
    if (!secureHexEqual(expectedDestinationHash, delivery.destinationHash)) {
      throw permanent("NOTIFICATION_DESTINATION_MISMATCH");
    }
    return {
      messageBase: {
        outboxEventId: event.id,
        notificationDeliveryId: delivery.id,
        channel: "EMAIL",
        idempotencyKey: `outbox:${event.id}:notification:${delivery.id}`,
        to: destination,
      },
    };
  }

  private assertExpiry(payloadValue: string, persisted: Date, now: Date): void {
    if (persisted.getTime() <= now.getTime()) throw permanent("PUBLIC_LINK_EXPIRED");
    const payloadExpiry = Date.parse(payloadValue);
    if (!Number.isFinite(payloadExpiry) || payloadExpiry !== persisted.getTime()) {
      throw permanent("NOTIFICATION_CONTEXT_INVALID");
    }
  }

  private assertTokenHash(rawToken: string, persistedHash: string): void {
    if (!secureHexEqual(hashPublicToken(rawToken), persistedHash)) {
      throw permanent("PUBLIC_LINK_INTEGRITY_FAILED");
    }
  }
}

function parseQuoteSentPayload(event: ClaimedOutboxEvent): QuoteSentPayload {
  assertEvent(event, "QUOTE_SENT", "QUOTE_VERSION");
  const payload = jsonObject(event.payload);
  const repairOrderId = stringValue(payload.repairOrderId);
  const quoteVersionId = stringValue(payload.quoteVersionId);
  const tokenRecordId = stringValue(payload.tokenRecordId);
  const expiresAt = stringValue(payload.expiresAt);
  const templateKey = stringValue(payload.templateKey) ?? QUOTE_SENT_TEMPLATE_KEY;
  if (
    !repairOrderId ||
    !quoteVersionId ||
    !tokenRecordId ||
    !expiresAt ||
    quoteVersionId !== event.aggregateId ||
    stringValue(payload.tokenScope) !== TokenScope.DECIDE_QUOTE ||
    stringValue(payload.channel) !== NotificationChannel.EMAIL ||
    templateKey !== QUOTE_SENT_TEMPLATE_KEY
  ) {
    throw permanent("NOTIFICATION_PAYLOAD_INVALID");
  }
  return { repairOrderId, quoteVersionId, tokenRecordId, expiresAt };
}

function parseRepairOrderReadyPayload(event: ClaimedOutboxEvent): RepairOrderReadyPayload {
  assertEvent(event, "REPAIR_ORDER_READY", "REPAIR_ORDER");
  const payload = jsonObject(event.payload);
  const repairOrderId = stringValue(payload.repairOrderId);
  if (
    !repairOrderId ||
    repairOrderId !== event.aggregateId ||
    stringValue(payload.channel) !== NotificationChannel.EMAIL ||
    stringValue(payload.templateKey) !== REPAIR_ORDER_READY_TEMPLATE_KEY
  ) {
    throw permanent("NOTIFICATION_PAYLOAD_INVALID");
  }
  return { repairOrderId };
}

function parseHandoverCompletedPayload(event: ClaimedOutboxEvent): HandoverCompletedPayload {
  assertEvent(event, "REPAIR_ORDER_COMPLETED", "REPAIR_ORDER");
  const payload = jsonObject(event.payload);
  const repairOrderId = stringValue(payload.repairOrderId);
  const tokenRecordId = stringValue(payload.tokenRecordId);
  const expiresAt = stringValue(payload.expiresAt);
  const handedOverAt = stringValue(payload.handedOverAt);
  if (
    !repairOrderId ||
    !tokenRecordId ||
    !expiresAt ||
    !handedOverAt ||
    repairOrderId !== event.aggregateId ||
    stringValue(payload.tokenScope) !== TokenScope.TRACK_ORDER ||
    stringValue(payload.channel) !== NotificationChannel.EMAIL ||
    stringValue(payload.templateKey) !== HANDOVER_COMPLETED_TEMPLATE_KEY
  ) {
    throw permanent("NOTIFICATION_PAYLOAD_INVALID");
  }
  return { repairOrderId, tokenRecordId, expiresAt, handedOverAt };
}

function parseStaffInvitationPayload(event: ClaimedOutboxEvent): StaffInvitationPayload {
  assertEvent(event, "STAFF_INVITATION_CREATED", "STAFF_INVITATION");
  const payload = jsonObject(event.payload);
  const invitationId = stringValue(payload.invitationId);
  const expiresAt = stringValue(payload.expiresAt);
  if (
    !invitationId ||
    !expiresAt ||
    invitationId !== event.aggregateId ||
    stringValue(payload.channel) !== NotificationChannel.EMAIL ||
    stringValue(payload.templateKey) !== STAFF_INVITATION_TEMPLATE_KEY
  ) {
    throw permanent("NOTIFICATION_PAYLOAD_INVALID");
  }
  return { invitationId, expiresAt };
}

function assertEvent(event: ClaimedOutboxEvent, eventType: string, aggregateType: string): void {
  if (event.eventType !== eventType || event.aggregateType !== aggregateType) {
    throw permanent("NOTIFICATION_EVENT_UNSUPPORTED");
  }
}

function deviceLabel(value: Prisma.JsonValue): string {
  const snapshot = jsonObject(value);
  const parts = [snapshot.brand, snapshot.model, snapshot.type]
    .map(stringValue)
    .filter((part): part is string => Boolean(part));
  return parts.join(" ") || "Thiết bị";
}

function jsonObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function permanent(code: string): OutboxDeliveryError {
  return new OutboxDeliveryError(code, false);
}
