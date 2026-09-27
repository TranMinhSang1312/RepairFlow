import { escapeHtml, formatVietnamDate, safeInline } from "./email-template.utils.js";
import type { RenderedEmail } from "./quote-sent-email.template.js";

export const STAFF_INVITATION_TEMPLATE_KEY = "STAFF_INVITATION_V1";

export function renderStaffInvitationEmail(input: {
  shopName: string;
  role: string;
  expiresAt: Date;
  setupUrl: string;
}): RenderedEmail {
  const shopName = safeInline(input.shopName, "Cửa hàng RepairFlow");
  const role = roleLabel(input.role);
  const expiry = formatVietnamDate(input.expiresAt);
  const subject = `[RepairFlow] Lời mời tham gia ${shopName}`;
  const text = [
    `Bạn được mời tham gia ${shopName} với vai trò ${role}.`,
    `Liên kết có hiệu lực đến ${expiry}:`,
    input.setupUrl,
    "",
    "Nếu bạn không mong đợi lời mời này, hãy bỏ qua email.",
  ].join("\n");
  const html = `<!doctype html>
<html lang="vi">
  <body style="font-family:Arial,sans-serif;color:#17352a;line-height:1.6">
    <h1 style="font-size:22px">Lời mời tham gia cửa hàng</h1>
    <p>Bạn được mời tham gia <strong>${escapeHtml(shopName)}</strong> với vai trò <strong>${escapeHtml(role)}</strong>.</p>
    <p><a href="${escapeHtml(input.setupUrl)}" style="display:inline-block;padding:10px 16px;background:#17804f;color:#fff;text-decoration:none;border-radius:6px">Thiết lập tài khoản</a></p>
    <p style="font-size:13px;color:#52645d">Liên kết có hiệu lực đến ${escapeHtml(expiry)}. Nếu bạn không mong đợi lời mời này, hãy bỏ qua email.</p>
  </body>
</html>`;
  return { subject, text, html };
}

function roleLabel(role: string): string {
  if (role === "TECHNICIAN") return "Kỹ thuật viên";
  if (role === "RECEPTIONIST") return "Nhân viên tiếp nhận";
  return "Nhân viên";
}
