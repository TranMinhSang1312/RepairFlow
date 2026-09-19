// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RepairFlowApiError } from "@/lib/api/errors";
import type { RepairOrderReadApi } from "@/lib/api/intake-api";
import type { AuthData, RepairOrderDetail } from "@/lib/api/types";

import { RepairOrderWorkspaceScreen } from "./repair-order-workspace";

afterEach(cleanup);

const shopId = "11111111-1111-4111-8111-111111111111";
const branchId = "22222222-2222-4222-8222-222222222222";
const orderId = "44444444-4444-4444-8444-444444444444";
const auth: AuthData = {
  accessToken: "memory-token",
  expiresInSeconds: 900,
  user: {
    id: "33333333-3333-4333-8333-333333333333",
    email: "reception@example.com",
    displayName: "Lễ tân",
    memberships: [
      {
        shopId,
        shopName: "RepairFlow Demo",
        role: "RECEPTIONIST",
        status: "ACTIVE",
        timezone: "Asia/Ho_Chi_Minh",
        intakePhotoMinimum: 1,
        branches: [{ id: branchId, name: "Chi nhánh chính" }],
      },
    ],
  },
};

const detail: RepairOrderDetail = {
  id: orderId,
  code: "RFD-2609-00001",
  status: "RECEIVED",
  completionOutcome: null,
  priority: "NORMAL",
  branchId,
  reportedProblem: "Máy không lên nguồn",
  intakeCondition: "Xước nhẹ góc trái",
  assignedTechnicianUserId: null,
  customer: {
    id: "55555555-5555-4555-8555-555555555555",
    name: "Trần Minh An",
    phone: "0901234567",
    email: "an@example.com",
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
  receivedAt: "2026-09-19T01:00:00.000Z",
  readyAt: null,
  returnedAt: null,
  lockVersion: 0,
  accessories: [{ id: "a1", name: "Ốp lưng", conditionNote: "Màu đen" }],
  media: [
    {
      id: "m1",
      purpose: "INTAKE",
      originalName: "mat-truoc.jpg",
      mimeType: "image/jpeg",
      byteSize: 2048,
      uploadedAt: "2026-09-19T01:00:00.000Z",
    },
  ],
  timeline: [
    {
      id: "e1",
      eventType: "REPAIR_ORDER_RECEIVED",
      fromStatus: null,
      toStatus: "RECEIVED",
      actorType: "USER",
      publicPayload: { code: "RFD-2609-00001" },
      createdAt: "2026-09-19T01:00:00.000Z",
    },
  ],
};

function fakeApi(overrides: Partial<RepairOrderReadApi> = {}): RepairOrderReadApi {
  return {
    restoreSession: vi.fn().mockResolvedValue(auth),
    listRepairOrders: vi.fn(),
    getRepairOrder: vi.fn().mockResolvedValue(detail),
    ...overrides,
  };
}

describe("RepairOrderWorkspaceScreen", () => {
  it("renders intake evidence and the read-only timeline at 360px", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 360 });
    const user = userEvent.setup();
    render(
      <RepairOrderWorkspaceScreen
        api={fakeApi()}
        repairOrderId={orderId}
        search={`shopId=${shopId}`}
      />,
    );

    expect(await screen.findByRole("heading", { name: "RFD-2609-00001" })).toBeTruthy();
    expect(screen.getByText("Máy không lên nguồn")).toBeTruthy();
    expect(screen.getByText("Ốp lưng")).toBeTruthy();
    expect(screen.getByText("mat-truoc.jpg")).toBeTruthy();

    await user.click(screen.getByRole("tab", { name: /Dòng thời gian/ }));
    expect(screen.getByText("REPAIR_ORDER_RECEIVED")).toBeTruthy();
    expect(screen.getByText("Có thể công khai")).toBeTruthy();
  });

  it("shows a safe not-found state for a wrong-tenant response", async () => {
    render(
      <RepairOrderWorkspaceScreen
        api={fakeApi({
          getRepairOrder: vi
            .fn()
            .mockRejectedValue(
              new RepairFlowApiError(
                404,
                "RESOURCE_NOT_FOUND",
                "Không tìm thấy dữ liệu trong cửa hàng đang chọn.",
              ),
            ),
        })}
        repairOrderId={orderId}
        search={`shopId=${shopId}`}
      />,
    );

    expect(await screen.findByRole("heading", { name: "Không thể mở phiếu" })).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("Không tìm thấy dữ liệu");
    expect(screen.queryByText("Trần Minh An")).toBeNull();
  });
});
