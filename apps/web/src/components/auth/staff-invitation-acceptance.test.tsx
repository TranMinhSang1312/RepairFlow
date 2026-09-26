// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StaffInvitationAcceptance } from "./staff-invitation-acceptance";

const replace = vi.fn();
let auth: Record<string, unknown>;

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));
vi.mock("@/lib/auth/auth-provider", () => ({ useAuth: () => auth }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("StaffInvitationAcceptance", () => {
  it("validates password confirmation before new-account acceptance", async () => {
    const acceptNewStaffInvitation = vi.fn();
    auth = {
      status: "anonymous",
      api: {
        inspectStaffInvitation: vi.fn().mockResolvedValue({
          shopName: "RepairFlow Demo",
          maskedEmail: "te***@example.com",
          role: "TECHNICIAN",
          expiresAt: "2026-09-29T00:00:00.000Z",
          acceptanceMode: "CREATE_ACCOUNT",
        }),
        acceptNewStaffInvitation,
      },
    };
    const actor = userEvent.setup();
    render(<StaffInvitationAcceptance token="safe-token" />);
    await screen.findByRole("heading", { name: "Tham gia RepairFlow Demo" });
    await actor.type(screen.getByLabelText("Họ tên"), "Technician");
    await actor.type(screen.getByLabelText("Mật khẩu"), "secure password one");
    await actor.type(screen.getByLabelText("Xác nhận mật khẩu"), "secure password two");
    await actor.click(screen.getByRole("button", { name: "Tạo tài khoản và tham gia" }));
    expect(screen.getByText("Mật khẩu xác nhận chưa khớp.")).toBeTruthy();
    expect(acceptNewStaffInvitation).not.toHaveBeenCalled();
  });

  it("accepts an existing-user invitation only through the authenticated path", async () => {
    const acceptedUser = {
      memberships: [{ shopId: "shop-two", shopName: "RepairFlow Demo", status: "ACTIVE" }],
    };
    const acceptExistingStaffInvitation = vi.fn().mockResolvedValue(acceptedUser);
    auth = {
      status: "authenticated",
      user: { email: "tech@example.com" },
      reloadCurrentUser: vi.fn().mockResolvedValue(undefined),
      api: {
        inspectStaffInvitation: vi.fn().mockResolvedValue({
          shopName: "RepairFlow Demo",
          maskedEmail: "te***@example.com",
          role: "TECHNICIAN",
          expiresAt: "2026-09-29T00:00:00.000Z",
          acceptanceMode: "SIGN_IN",
        }),
        acceptExistingStaffInvitation,
      },
    };
    const actor = userEvent.setup();
    render(<StaffInvitationAcceptance token="safe-token" />);
    await actor.click(await screen.findByRole("button", { name: "Xác nhận tham gia cửa hàng" }));
    expect(acceptExistingStaffInvitation).toHaveBeenCalledWith("safe-token");
    expect(replace).toHaveBeenCalledWith("/orders?shopId=shop-two");
  });
});
