// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { BrowserIntakeApi } from "@/lib/api/intake-api";
import type { CurrentUser, StaffMembership } from "@/lib/api/types";
import { StaffMembershipSettings } from "./staff-membership-settings";

const shopId = "11111111-1111-4111-8111-111111111111";
const owner: CurrentUser = {
  id: "22222222-2222-4222-8222-222222222222",
  email: "owner@example.com",
  displayName: "Owner",
  memberships: [
    {
      shopId,
      shopName: "RepairFlow Demo",
      role: "OWNER",
      status: "ACTIVE",
      timezone: "Asia/Ho_Chi_Minh",
      intakePhotoMinimum: 1,
      branches: [],
    },
  ],
};
const member: StaffMembership = {
  userId: owner.id,
  email: owner.email,
  displayName: owner.displayName,
  role: "OWNER",
  status: "ACTIVE",
  joinedAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  lockVersion: 0,
};

function fakeApi(overrides: Record<string, unknown> = {}) {
  return {
    listStaffMemberships: vi.fn().mockResolvedValue({ data: [member], nextCursor: null }),
    listStaffInvitations: vi.fn().mockResolvedValue([]),
    createStaffInvitation: vi.fn().mockResolvedValue({
      id: "invite",
      email: "tech@example.com",
      role: "TECHNICIAN",
      status: "PENDING",
      expiresAt: "2026-09-29T00:00:00.000Z",
      createdAt: "2026-09-26T00:00:00.000Z",
      lockVersion: 0,
      setupUrl: "http://localhost:3000/join/safe-token",
    }),
    ...overrides,
  } as unknown as BrowserIntakeApi;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("StaffMembershipSettings", () => {
  it("lets an owner create and copy a technician setup link", async () => {
    const api = fakeApi();
    const actor = userEvent.setup();
    render(
      <StaffMembershipSettings
        api={api}
        user={owner}
        search={`shopId=${shopId}`}
        replaceUrl={vi.fn()}
      />,
    );
    expect(await screen.findByText("Owner (Bạn)")).toBeTruthy();
    await actor.type(screen.getByPlaceholderText("nhanvien@example.com"), "tech@example.com");
    await actor.click(screen.getByRole("button", { name: "Tạo link mời" }));
    await waitFor(() => expect(api.createStaffInvitation).toHaveBeenCalledOnce());
    expect(screen.getByDisplayValue("http://localhost:3000/join/safe-token")).toBeTruthy();
  });

  it("gives receptionist a read-only list without loading invitation emails", async () => {
    const api = fakeApi();
    render(
      <StaffMembershipSettings
        api={api}
        user={{ ...owner, memberships: [{ ...owner.memberships[0]!, role: "RECEPTIONIST" }] }}
        search={`shopId=${shopId}`}
        replaceUrl={vi.fn()}
      />,
    );
    expect(await screen.findByRole("heading", { name: "Owner (Bạn)" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Tạo link mời" })).toBeNull();
    expect(api.listStaffInvitations).not.toHaveBeenCalled();
    expect(screen.getByText(/chỉ chủ cửa hàng được thay đổi/i)).toBeTruthy();
  });

  it("denies a technician without issuing staff API calls", () => {
    const api = fakeApi();
    render(
      <StaffMembershipSettings
        api={api}
        user={{ ...owner, memberships: [{ ...owner.memberships[0]!, role: "TECHNICIAN" }] }}
        search={`shopId=${shopId}`}
        replaceUrl={vi.fn()}
      />,
    );
    expect(screen.getByText("Bạn không có quyền xem khu vực này.")).toBeTruthy();
    expect(api.listStaffMemberships).not.toHaveBeenCalled();
  });
});
