import type { Metadata } from "next";

import { PublicQuotePortal } from "@/components/public/public-quote-portal";

export const metadata: Metadata = {
  title: "Theo dõi sửa chữa · RepairFlow",
  referrer: "no-referrer",
  robots: { index: false, follow: false, noarchive: true },
};

export default function PublicQuotePage() {
  return <PublicQuotePortal />;
}
