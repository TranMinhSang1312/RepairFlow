import type { PaymentDisposition } from "@prisma/client";

import type { TrackTokenMetadata } from "../public-access/public-token.service.js";
import type { RepairOrderView } from "../repair-orders/repair-order.types.js";
import type { PaymentSummaryView, PaymentView } from "../payments/payment.types.js";

export interface HandoverView {
  id: string;
  recipientName: string;
  paymentDisposition: PaymentDisposition;
  paymentNote: string | null;
  handedOverByUserId: string;
  handedOverAt: string;
}

export interface WarrantyView {
  id: string;
  startsAt: string;
  endsAt: string;
  terms: string;
}

export interface HandoverResponse {
  data: {
    order: RepairOrderView;
    handover: HandoverView;
    payment: PaymentView | null;
    warranty: WarrantyView | null;
    paymentSummary: PaymentSummaryView;
    trackingUrl: string;
    trackingExpiresAt: string;
  };
}

export interface HandoverReplayDescriptor {
  repairOrderId: string;
  handoverId: string;
  paymentId: string | null;
  warrantyId: string | null;
  tracking: TrackTokenMetadata;
}

export function toHandoverView(handover: {
  id: string;
  recipientName: string;
  paymentDisposition: PaymentDisposition;
  paymentNote: string | null;
  handedOverByUserId: string;
  handedOverAt: Date;
}): HandoverView {
  return {
    id: handover.id,
    recipientName: handover.recipientName,
    paymentDisposition: handover.paymentDisposition,
    paymentNote: handover.paymentNote,
    handedOverByUserId: handover.handedOverByUserId,
    handedOverAt: handover.handedOverAt.toISOString(),
  };
}

export function toWarrantyView(warranty: {
  id: string;
  startsAt: Date;
  endsAt: Date;
  termsSnapshot: string;
}): WarrantyView {
  return {
    id: warranty.id,
    startsAt: warranty.startsAt.toISOString(),
    endsAt: warranty.endsAt.toISOString(),
    terms: warranty.termsSnapshot,
  };
}
