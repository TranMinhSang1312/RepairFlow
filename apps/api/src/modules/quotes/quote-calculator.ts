import { Prisma, type QuoteItemKind } from "@prisma/client";

export interface QuoteCalculationItem {
  kind: QuoteItemKind;
  description: string;
  quantity: number;
  unitPrice: number;
  isOptional: boolean;
  approvalGroup: string | null;
}

export interface CalculatedQuoteItem extends QuoteCalculationItem {
  lineTotal: bigint;
}

export interface QuoteCalculation {
  items: CalculatedQuoteItem[];
  subtotal: bigint;
  discount: bigint;
  total: bigint;
}

export function calculateQuote(
  items: QuoteCalculationItem[],
  discountInput: number,
): QuoteCalculation {
  const calculatedItems = items.map((item) => {
    const lineTotal = new Prisma.Decimal(item.quantity.toString())
      .mul(item.unitPrice.toString())
      .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP);

    return { ...item, lineTotal: BigInt(lineTotal.toFixed(0)) };
  });
  const subtotal = calculatedItems.reduce((sum, item) => sum + item.lineTotal, 0n);
  const discount = BigInt(discountInput);

  return {
    items: calculatedItems,
    subtotal,
    discount,
    total: subtotal - discount,
  };
}
