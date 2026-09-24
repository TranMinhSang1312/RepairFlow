import type { PaymentMethod } from "@prisma/client";

export interface PaymentView {
  id: string;
  amount: number;
  method: PaymentMethod;
  reference: string | null;
  receivedByUserId: string;
  receivedAt: string;
}

export interface PaymentSummaryView {
  approvedTotal: number;
  paidTotal: number;
  amountDue: number;
}

export interface PaymentResponse {
  data: {
    payment: PaymentView;
    summary: PaymentSummaryView;
  };
}

export interface PaymentRecord {
  id: string;
  amount: bigint;
  method: PaymentMethod;
  reference: string | null;
  receivedByUserId: string;
  receivedAt: Date;
}

export interface MonetarySummary {
  approvedTotal: bigint;
  paidTotal: bigint;
  amountDue: bigint;
}

export function calculatePaymentSummary(
  approvedTotal: bigint,
  payments: ReadonlyArray<{ amount: bigint }>,
): MonetarySummary {
  const paidTotal = payments.reduce((total, payment) => total + payment.amount, 0n);
  return {
    approvedTotal,
    paidTotal,
    amountDue: approvedTotal > paidTotal ? approvedTotal - paidTotal : 0n,
  };
}

export function toPaymentSummaryView(summary: MonetarySummary): PaymentSummaryView {
  return {
    approvedTotal: safeMoney(summary.approvedTotal),
    paidTotal: safeMoney(summary.paidTotal),
    amountDue: safeMoney(summary.amountDue),
  };
}

export function toPaymentView(payment: PaymentRecord): PaymentView {
  return {
    id: payment.id,
    amount: safeMoney(payment.amount),
    method: payment.method,
    reference: payment.reference,
    receivedByUserId: payment.receivedByUserId,
    receivedAt: payment.receivedAt.toISOString(),
  };
}

function safeMoney(value: bigint): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) {
    throw new RangeError("Money value is outside the JSON safe-integer range.");
  }
  return number;
}
