import { Prisma, QuoteItemKind, QuoteQuantityUnit, QuoteStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { toQuoteView } from "./quote.types.js";

describe("quote response mapping", () => {
  it("maps Prisma Decimal and BigInt values to the OpenAPI JSON representation", () => {
    const timestamp = new Date("2026-09-22T00:00:00.000Z");
    const view = toQuoteView({
      id: "00000000-0000-4000-8000-000000000001",
      repairOrderId: "00000000-0000-4000-8000-000000000002",
      diagnosisId: null,
      versionNo: 1,
      status: QuoteStatus.DRAFT,
      currency: "VND",
      subtotal: 1251n,
      discount: 51n,
      total: 1200n,
      customerNote: null,
      expiresAt: null,
      sentAt: null,
      decidedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      items: [
        {
          id: "00000000-0000-4000-8000-000000000003",
          scopeKey: "00000000-0000-4000-8000-000000000004",
          carriedFromQuoteItemId: null,
          kind: QuoteItemKind.SERVICE,
          description: "Service",
          displayNote: null,
          quantity: new Prisma.Decimal("1.25"),
          quantityUnit: QuoteQuantityUnit.HOUR,
          unitPrice: 1001n,
          lineTotal: 1251n,
          isOptional: false,
          approvalGroup: null,
        },
      ],
    });

    expect(view).toMatchObject({
      subtotal: 1251,
      discount: 51,
      total: 1200,
      createdAt: "2026-09-22T00:00:00.000Z",
      items: [
        {
          scopeKey: "00000000-0000-4000-8000-000000000004",
          quantity: 1.25,
          quantityUnit: QuoteQuantityUnit.HOUR,
          unitPrice: 1001,
          lineTotal: 1251,
        },
      ],
    });
    expect(() => JSON.stringify({ data: view })).not.toThrow();
  });
});
