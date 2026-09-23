import type {
  CompletionOutcome,
  QuoteDecision,
  QuoteItemKind,
  QuoteQuantityUnit,
  QuoteStatus,
  RepairOrderStatus,
} from "@prisma/client";

export interface PublicQuoteItemView {
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

export interface PublicQuoteView {
  id: string;
  versionNo: number;
  status: QuoteStatus;
  currency: string;
  items: PublicQuoteItemView[];
  subtotal: number;
  discount: number;
  total: number;
  customerNote: string | null;
  expiresAt: string;
  sentAt: string;
  decidedAt: string | null;
}

export interface PublicOrderResponse {
  data: {
    shopName: string;
    shopContact: string | null;
    orderCode: string;
    deviceLabel: string;
    status: RepairOrderStatus;
    completionOutcome: CompletionOutcome | null;
    timeline: Array<{ type: string; message: string; createdAt: string }>;
    quote: PublicQuoteView | null;
  };
}

export interface QuoteDecisionResponse {
  data: {
    quoteVersionId: string;
    decision: QuoteDecision;
    approvedTotal: number;
    decidedAt: string;
  };
}
