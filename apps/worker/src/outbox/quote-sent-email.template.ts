export const QUOTE_SENT_TEMPLATE_KEY = "QUOTE_SENT_V1";

export interface QuoteSentEmailInput {
  shopName: string;
  customerName: string;
  orderCode: string;
  deviceLabel: string;
  total: bigint;
  currency: string;
  expiresAt: Date;
  publicUrl: string;
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

export function renderQuoteSentEmail(input: QuoteSentEmailInput): RenderedEmail {
  const shopName = safeInline(input.shopName, "Cửa hàng sửa chữa");
  const customerName = safeInline(input.customerName, "Quý khách");
  const orderCode = safeInline(input.orderCode, "phiếu sửa chữa");
  const deviceLabel = safeInline(input.deviceLabel, "Thiết bị");
  const amount = `${new Intl.NumberFormat("vi-VN").format(input.total)} ${safeInline(input.currency, "VND")}`;
  const expiry = new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(input.expiresAt);
  const subject = `[RepairFlow] Báo giá sửa chữa ${orderCode}`;
  const text = [
    `Xin chào ${customerName},`,
    "",
    `${shopName} đã gửi báo giá cho phiếu ${orderCode} (${deviceLabel}).`,
    `Tổng báo giá: ${amount}.`,
    `Liên kết có hiệu lực đến ${expiry}:`,
    input.publicUrl,
    "",
    "Vui lòng mở liên kết để xem chi tiết và phản hồi báo giá.",
  ].join("\n");
  const html = `<!doctype html>
<html lang="vi">
  <body style="font-family:Arial,sans-serif;color:#17352a;line-height:1.6">
    <h1 style="font-size:22px">Báo giá sửa chữa</h1>
    <p>Xin chào ${escapeHtml(customerName)},</p>
    <p><strong>${escapeHtml(shopName)}</strong> đã gửi báo giá cho phiếu <strong>${escapeHtml(orderCode)}</strong> (${escapeHtml(deviceLabel)}).</p>
    <p>Tổng báo giá: <strong>${escapeHtml(amount)}</strong>.</p>
    <p><a href="${escapeHtml(input.publicUrl)}" style="display:inline-block;padding:10px 16px;background:#17804f;color:#fff;text-decoration:none;border-radius:6px">Xem và phản hồi báo giá</a></p>
    <p style="font-size:13px;color:#52645d">Liên kết có hiệu lực đến ${escapeHtml(expiry)}.</p>
  </body>
</html>`;
  return { subject, text, html };
}

function safeInline(value: string, fallback: string): string {
  const normalized = value
    .replace(/[\r\n\t]+/gu, " ")
    .replace(/\s{2,}/gu, " ")
    .trim();
  return normalized || fallback;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
