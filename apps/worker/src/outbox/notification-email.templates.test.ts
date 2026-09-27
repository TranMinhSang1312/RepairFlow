import { describe, expect, it } from "vitest";

import {
  renderHandoverCompletedEmail,
  renderRepairOrderReadyEmail,
} from "./repair-order-email.templates.js";
import { renderStaffInvitationEmail } from "./staff-invitation-email.template.js";

describe("RF-052 notification email templates", () => {
  const orderInput = {
    shopName: '<Shop & "Team">',
    customerName: "Customer <script>",
    orderCode: "RF-052\nINJECTED",
    deviceLabel: "Phone <Pro>",
  };

  it("renders ready and handover content while escaping dynamic values", () => {
    const ready = renderRepairOrderReadyEmail(orderInput);
    expect(ready.subject).not.toContain("\n");
    expect(ready.html).toContain("&lt;Shop &amp; &quot;Team&quot;&gt;");
    expect(ready.html).toContain("Customer &lt;script&gt;");

    const handover = renderHandoverCompletedEmail({
      ...orderInput,
      handedOverAt: new Date("2026-09-26T02:00:00.000Z"),
      warrantyEndsAt: new Date("2027-09-26T02:00:00.000Z"),
      trackingUrl: "https://app.example.test/p/a&b",
    });
    expect(handover.text).toContain("https://app.example.test/p/a&b");
    expect(handover.html).toContain("https://app.example.test/p/a&amp;b");
  });

  it("renders a customer-safe staff invitation", () => {
    const invitation = renderStaffInvitationEmail({
      shopName: "Shop <One>",
      role: "TECHNICIAN",
      expiresAt: new Date("2026-09-30T00:00:00.000Z"),
      setupUrl: "https://app.example.test/join/a&b",
    });
    expect(invitation.text).toContain("Kỹ thuật viên");
    expect(invitation.html).toContain("Shop &lt;One&gt;");
    expect(invitation.html).toContain("https://app.example.test/join/a&amp;b");
    expect(invitation.text).not.toContain("inviter");
  });
});
