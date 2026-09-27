import { escapeHtml, formatVietnamDate, safeInline } from "./email-template.utils.js";
import type { RenderedEmail } from "./quote-sent-email.template.js";

export const REPAIR_ORDER_READY_TEMPLATE_KEY = "REPAIR_ORDER_READY_V1";
export const HANDOVER_COMPLETED_TEMPLATE_KEY = "HANDOVER_COMPLETED_V1";

interface RepairOrderEmailInput {
  shopName: string;
  customerName: string;
  orderCode: string;
  deviceLabel: string;
}

export function renderRepairOrderReadyEmail(input: RepairOrderEmailInput): RenderedEmail {
  const values = safeValues(input);
  const subject = `[RepairFlow] Thiết bị ${values.orderCode} đã sẵn sàng`;
  const text = [
    `Xin chào ${values.customerName},`,
    "",
    `${values.shopName} thông báo thiết bị ${values.deviceLabel} của phiếu ${values.orderCode} đã sẵn sàng để nhận.`,
    "Vui lòng liên hệ cửa hàng để sắp xếp thời gian nhận máy.",
  ].join("\n");
  const html = `<!doctype html>
<html lang="vi">
  <body style="font-family:Arial,sans-serif;color:#17352a;line-height:1.6">
    <h1 style="font-size:22px">Thiết bị đã sẵn sàng</h1>
    <p>Xin chào ${escapeHtml(values.customerName)},</p>
    <p><strong>${escapeHtml(values.shopName)}</strong> thông báo thiết bị ${escapeHtml(values.deviceLabel)} của phiếu <strong>${escapeHtml(values.orderCode)}</strong> đã sẵn sàng để nhận.</p>
    <p>Vui lòng liên hệ cửa hàng để sắp xếp thời gian nhận máy.</p>
  </body>
</html>`;
  return { subject, text, html };
}

export function renderHandoverCompletedEmail(
  input: RepairOrderEmailInput & {
    handedOverAt: Date;
    trackingUrl: string;
    warrantyEndsAt: Date | null;
  },
): RenderedEmail {
  const values = safeValues(input);
  const handedOverAt = formatVietnamDate(input.handedOverAt);
  const warranty = input.warrantyEndsAt
    ? `Bảo hành đến ${formatVietnamDate(input.warrantyEndsAt)}.`
    : "Phiếu này không có bảo hành được ghi nhận.";
  const subject = `[RepairFlow] Đã hoàn tất phiếu ${values.orderCode}`;
  const text = [
    `Xin chào ${values.customerName},`,
    "",
    `${values.shopName} đã bàn giao ${values.deviceLabel} lúc ${handedOverAt}.`,
    warranty,
    "Theo dõi hồ sơ sửa chữa tại:",
    input.trackingUrl,
  ].join("\n");
  const html = `<!doctype html>
<html lang="vi">
  <body style="font-family:Arial,sans-serif;color:#17352a;line-height:1.6">
    <h1 style="font-size:22px">Bàn giao hoàn tất</h1>
    <p>Xin chào ${escapeHtml(values.customerName)},</p>
    <p><strong>${escapeHtml(values.shopName)}</strong> đã bàn giao ${escapeHtml(values.deviceLabel)} của phiếu <strong>${escapeHtml(values.orderCode)}</strong> lúc ${escapeHtml(handedOverAt)}.</p>
    <p>${escapeHtml(warranty)}</p>
    <p><a href="${escapeHtml(input.trackingUrl)}" style="display:inline-block;padding:10px 16px;background:#17804f;color:#fff;text-decoration:none;border-radius:6px">Theo dõi hồ sơ sửa chữa</a></p>
  </body>
</html>`;
  return { subject, text, html };
}

function safeValues(input: RepairOrderEmailInput) {
  return {
    shopName: safeInline(input.shopName, "Cửa hàng sửa chữa"),
    customerName: safeInline(input.customerName, "Quý khách"),
    orderCode: safeInline(input.orderCode, "phiếu sửa chữa"),
    deviceLabel: safeInline(input.deviceLabel, "Thiết bị"),
  };
}
