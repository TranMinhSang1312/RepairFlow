import type { Prisma, QuoteItemKind, QuoteQuantityUnit, QuoteStatus } from "@prisma/client";

export interface QuoteItemView {
  id: string;
  scopeKey: string;
  carriedFromQuoteItemId: string | null;
  kind: QuoteItemKind;
  description: string;
  displayNote: string | null;
  quantity: number;
  quantityUnit: QuoteQuantityUnit;
  unitPrice: number;
  lineTotal: number;
  isOptional: boolean;
  approvalGroup: string | null;
}

export interface QuoteView {
  id: string;
  repairOrderId: string;
  diagnosisId: string | null;
  versionNo: number;
  status: QuoteStatus;
  currency: string;
  items: QuoteItemView[];
  subtotal: number;
  discount: number;
  total: number;
  customerNote: string | null;
  expiresAt: string | null;
  sentAt: string | null;
  decidedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface QuoteResponse {
  data: QuoteView;
}

export interface SendQuoteResponse {
  data: {
    quote: QuoteView;
    publicUrl: string;
  };
}

export interface QuoteRecord {
  id: string;
  repairOrderId: string;
  diagnosisId: string | null;
  versionNo: number;
  status: QuoteStatus;
  currency: string;
  subtotal: bigint;
  discount: bigint;
  total: bigint;
  customerNote: string | null;
  expiresAt: Date | null;
  sentAt: Date | null;
  decidedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  items: Array<{
    id: string;
    scopeKey: string;
    carriedFromQuoteItemId: string | null;
    kind: QuoteItemKind;
    description: string;
    displayNote: string | null;
    quantity: Prisma.Decimal;
    quantityUnit: QuoteQuantityUnit;
    unitPrice: bigint;
    lineTotal: bigint;
    isOptional: boolean;
    approvalGroup: string | null;
  }>;
}

export function toQuoteView(quote: QuoteRecord): QuoteView {
  return {
    id: quote.id,
    repairOrderId: quote.repairOrderId,
    diagnosisId: quote.diagnosisId,
    versionNo: quote.versionNo,
    status: quote.status,
    currency: quote.currency,
    items: quote.items.map((item) => ({
      id: item.id,
      scopeKey: item.scopeKey,
      carriedFromQuoteItemId: item.carriedFromQuoteItemId,
      kind: item.kind,
      description: item.description,
      displayNote: item.displayNote,
      quantity: Number(item.quantity.toString()),
      quantityUnit: item.quantityUnit,
      unitPrice: Number(item.unitPrice),
      lineTotal: Number(item.lineTotal),
      isOptional: item.isOptional,
      approvalGroup: item.approvalGroup,
    })),
    subtotal: Number(quote.subtotal),
    discount: Number(quote.discount),
    total: Number(quote.total),
    customerNote: quote.customerNote,
    expiresAt: quote.expiresAt?.toISOString() ?? null,
    sentAt: quote.sentAt?.toISOString() ?? null,
    decidedAt: quote.decidedAt?.toISOString() ?? null,
    createdAt: quote.createdAt.toISOString(),
    updatedAt: quote.updatedAt.toISOString(),
  };
}
