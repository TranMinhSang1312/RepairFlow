// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RepairOrderReadApi } from "@/lib/api/intake-api";
import type { AuthData, RepairOrderSummary } from "@/lib/api/types";

import { RepairOrderBoardScreen } from "./repair-order-board";

afterEach(cleanup);

const shopId = "11111111-1111-4111-8111-111111111111";
const branchId = "22222222-2222-4222-8222-222222222222";
const auth: AuthData = {
  accessToken: "memory-token",
  expiresInSeconds: 900,
  user: {
    id: "33333333-3333-4333-8333-333333333333",
    email: "owner@example.com",
    displayName: "Minh Sang",
    memberships: [
      {
        shopId,
        shopName: "RepairFlow Demo",
        role: "OWNER",
        status: "ACTIVE",
        timezone: "Asia/Ho_Chi_Minh",
        intakePhotoMinimum: 1,
        branches: [{ id: branchId, name: "Chi nhánh chính" }],
      },
    ],
  },
};

const order: RepairOrderSummary = {
  id: "44444444-4444-4444-8444-444444444444",
  code: "RFD-2609-00001",
  status: "RECEIVED",
  completionOutcome: null,
  priority: "HIGH",
  branchId,
  reportedProblem: "Máy không lên nguồn",
  intakeCondition: "Xước nhẹ góc trái",
  assignedTechnicianUserId: null,
  customer: {
    id: "55555555-5555-4555-8555-555555555555",
    name: "Trần Minh An",
    phone: "0901234567",
    email: null,
    notes: null,
    createdAt: "2026-09-19T00:00:00.000Z",
  },
  device: {
    id: "66666666-6666-4666-8666-666666666666",
    customerId: "55555555-5555-4555-8555-555555555555",
    type: "PHONE",
    brand: "Samsung",
    model: "S25",
    color: "Đen",
    serialMasked: null,
    imeiMasked: "••••1234",
  },
  promisedAt: null,
  receivedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
  readyAt: null,
  returnedAt: null,
  lockVersion: 0,
};

function fakeApi(overrides: Partial<RepairOrderReadApi> = {}): RepairOrderReadApi {
  return {
    restoreSession: vi.fn().mockResolvedValue(auth),
    listRepairOrders: vi.fn().mockResolvedValue({ data: [order], meta: { nextCursor: null } }),
    getRepairOrder: vi.fn(),
    ...overrides,
  };
}

describe("RepairOrderBoardScreen", () => {
  it("uses the shared authenticated session without rotating refresh on mount", async () => {
    const api = fakeApi();
    render(
      <RepairOrderBoardScreen api={api} search={`shopId=${shopId}`} sessionUser={auth.user} />,
    );

    expect(await screen.findByText("RFD-2609-00001")).toBeTruthy();
    expect(api.restoreSession).not.toHaveBeenCalled();
  });

  it("keeps filters in the URL and renders a card at a 360px viewport", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 360 });
    window.dispatchEvent(new Event("resize"));
    const replaceUrl = vi.fn();
    const user = userEvent.setup();
    render(
      <RepairOrderBoardScreen
        api={fakeApi()}
        replaceUrl={replaceUrl}
        search={`shopId=${shopId}`}
      />,
    );

    expect(await screen.findByText("RFD-2609-00001")).toBeTruthy();
    expect(screen.getByText("Trần Minh An")).toBeTruthy();
    await user.type(
      screen.getByRole("textbox", { name: "Tìm theo mã phiếu, khách hàng hoặc thiết bị" }),
      "Samsung",
    );
    await user.click(screen.getByRole("button", { name: "Tìm" }));
    expect(replaceUrl).toHaveBeenCalledWith(`/orders?shopId=${shopId}&query=Samsung`);

    await user.click(screen.getByLabelText("Mới tiếp nhận"));
    expect(replaceUrl).toHaveBeenCalledWith(`/orders?shopId=${shopId}&status=RECEIVED`);
  });

  it("shows loading and then an empty state", async () => {
    let resolvePage!: (value: { data: []; meta: { nextCursor: null } }) => void;
    const page = new Promise<{ data: []; meta: { nextCursor: null } }>((resolve) => {
      resolvePage = resolve;
    });
    render(
      <RepairOrderBoardScreen
        api={fakeApi({ listRepairOrders: vi.fn().mockReturnValue(page) })}
        search={`shopId=${shopId}`}
      />,
    );

    expect(await screen.findByText("Đang tải phiếu…")).toBeTruthy();
    resolvePage({ data: [], meta: { nextCursor: null } });
    expect(await screen.findByRole("heading", { name: "Chưa có phiếu phù hợp" })).toBeTruthy();
  });

  it("shows a clear initial server error", async () => {
    render(
      <RepairOrderBoardScreen
        api={fakeApi({ listRepairOrders: vi.fn().mockRejectedValue(new Error("offline")) })}
        search={`shopId=${shopId}`}
      />,
    );

    expect(await screen.findByRole("heading", { name: "Không thể tải bảng" })).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("Không thể kết nối");
  });

  it("keeps existing cards and warns when a polling refresh fails", async () => {
    const list = vi
      .fn<RepairOrderReadApi["listRepairOrders"]>()
      .mockResolvedValueOnce({ data: [order], meta: { nextCursor: null } })
      .mockRejectedValue(new Error("offline"));
    render(
      <RepairOrderBoardScreen
        api={fakeApi({ listRepairOrders: list })}
        pollIntervalMs={15}
        search={`shopId=${shopId}`}
      />,
    );

    expect(await screen.findByText("RFD-2609-00001")).toBeTruthy();
    expect(await screen.findByText(/Bảng vẫn giữ lần tải thành công gần nhất/)).toBeTruthy();
    expect(screen.getByText("RFD-2609-00001")).toBeTruthy();
    await waitFor(() => expect(list.mock.calls.length).toBeGreaterThanOrEqual(2));
  });
});
