// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RepairFlowApiError } from "@/lib/api/errors";
import type { RepairOrderWorkspaceApi } from "@/lib/api/intake-api";
import type { AuthData, RepairOrderDetail } from "@/lib/api/types";

import { RepairOrderWorkspaceScreen } from "./repair-order-workspace";

afterEach(cleanup);

const shopId = "11111111-1111-4111-8111-111111111111";
const branchId = "22222222-2222-4222-8222-222222222222";
const orderId = "44444444-4444-4444-8444-444444444444";
const technicianId = "77777777-7777-4777-8777-777777777777";
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
  activeAssignment: null,
  diagnoses: [],
  quoteVersions: [],
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

function fakeApi(overrides: Partial<RepairOrderWorkspaceApi> = {}): RepairOrderWorkspaceApi {
  return {
    restoreSession: vi.fn().mockResolvedValue(auth),
    listRepairOrders: vi.fn(),
    getRepairOrder: vi.fn().mockResolvedValue(detail),
    listTechnicians: vi
      .fn()
      .mockResolvedValue([{ userId: technicianId, displayName: "Kỹ thuật viên Nam" }]),
    assignTechnician: vi.fn(),
    transitionRepairOrder: vi.fn(),
    createDiagnosis: vi.fn(),
    createQuote: vi.fn(),
    replaceDraftQuote: vi.fn(),
    sendQuote: vi.fn(),
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

  it("lets an owner assign a technician and start diagnosis", async () => {
    const ownerUser = {
      ...auth.user,
      id: "88888888-8888-4888-8888-888888888888",
      memberships: [{ ...auth.user.memberships[0]!, role: "OWNER" as const }],
    };
    const assigned = {
      ...detail,
      activeAssignment: {
        id: "99999999-9999-4999-8999-999999999999",
        repairOrderId: orderId,
        technicianUserId: technicianId,
        technicianDisplayName: "Kỹ thuật viên Nam",
        assignedByUserId: ownerUser.id,
        assignedAt: "2026-09-19T02:00:00.000Z",
        unassignedAt: null,
      },
      assignedTechnicianUserId: technicianId,
    };
    const api = fakeApi({
      getRepairOrder: vi.fn().mockResolvedValue(assigned),
      assignTechnician: vi.fn().mockResolvedValue(assigned.activeAssignment),
      transitionRepairOrder: vi.fn().mockResolvedValue({ ...assigned, status: "DIAGNOSING" }),
    });
    const user = userEvent.setup();
    render(
      <RepairOrderWorkspaceScreen
        api={api}
        repairOrderId={orderId}
        search={`shopId=${shopId}`}
        sessionUser={ownerUser}
      />,
    );

    await screen.findByRole("heading", { name: "RFD-2609-00001" });
    await user.selectOptions(screen.getByLabelText("Kỹ thuật viên hoạt động"), technicianId);
    await user.click(screen.getByRole("button", { name: "Phân công lại" }));
    await waitFor(() =>
      expect(api.assignTechnician).toHaveBeenCalledWith(shopId, orderId, technicianId),
    );

    await user.click(screen.getByRole("button", { name: "Bắt đầu chẩn đoán" }));
    await waitFor(() =>
      expect(api.transitionRepairOrder).toHaveBeenCalledWith(
        shopId,
        orderId,
        { targetStatus: "DIAGNOSING", expectedLockVersion: 0 },
        expect.any(String),
      ),
    );
  });

  it("shows assignment controls but no diagnosis publishing action to receptionists", async () => {
    const user = userEvent.setup();
    render(
      <RepairOrderWorkspaceScreen
        api={fakeApi()}
        repairOrderId={orderId}
        search={`shopId=${shopId}`}
      />,
    );

    expect(await screen.findByLabelText("Kỹ thuật viên hoạt động")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Bắt đầu chẩn đoán" })).toBeNull();
    await user.click(screen.getByRole("tab", { name: /Chẩn đoán/ }));
    expect(screen.getByText("Chưa có chẩn đoán nào được xuất bản.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Xuất bản chẩn đoán" })).toBeNull();
  });

  it("opens the quote workspace for an authorized receptionist", async () => {
    const user = userEvent.setup();
    render(
      <RepairOrderWorkspaceScreen
        api={fakeApi({
          getRepairOrder: vi.fn().mockResolvedValue({ ...detail, status: "DIAGNOSING" }),
        })}
        repairOrderId={orderId}
        search={`shopId=${shopId}`}
      />,
    );

    await screen.findByRole("heading", { name: "RFD-2609-00001" });
    await user.click(screen.getByRole("tab", { name: /Báo giá/ }));
    expect(screen.getByRole("heading", { name: "Chuẩn bị báo giá" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "0 phiên bản báo giá" })).toBeTruthy();
  });

  it("keeps the workspace visible when assignment fails", async () => {
    const api = fakeApi({
      assignTechnician: vi
        .fn()
        .mockRejectedValue(
          new RepairFlowApiError(
            404,
            "RESOURCE_NOT_FOUND",
            "Không tìm thấy dữ liệu trong cửa hàng đang chọn.",
          ),
        ),
    });
    const user = userEvent.setup();
    render(
      <RepairOrderWorkspaceScreen api={api} repairOrderId={orderId} search={`shopId=${shopId}`} />,
    );

    await screen.findByRole("heading", { name: "RFD-2609-00001" });
    await user.selectOptions(screen.getByLabelText("Kỹ thuật viên hoạt động"), technicianId);
    await user.click(screen.getByRole("button", { name: "Phân công" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Không tìm thấy dữ liệu");
    expect(screen.getByText("Máy không lên nguồn")).toBeTruthy();
  });

  it("lets the assigned technician validate and publish a diagnosis", async () => {
    const technicianUser = {
      ...auth.user,
      id: technicianId,
      memberships: [{ ...auth.user.memberships[0]!, role: "TECHNICIAN" as const }],
    };
    const diagnosing = {
      ...detail,
      status: "DIAGNOSING" as const,
      assignedTechnicianUserId: technicianId,
      activeAssignment: {
        id: "99999999-9999-4999-8999-999999999999",
        repairOrderId: orderId,
        technicianUserId: technicianId,
        technicianDisplayName: "Kỹ thuật viên Nam",
        assignedByUserId: "88888888-8888-4888-8888-888888888888",
        assignedAt: "2026-09-19T02:00:00.000Z",
        unassignedAt: null,
      },
    };
    const api = fakeApi({
      getRepairOrder: vi.fn().mockResolvedValue(diagnosing),
      createDiagnosis: vi.fn().mockResolvedValue({
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        repairOrderId: orderId,
        revisionNo: 1,
        finding: "Lỗi nguồn",
        recommendation: "Thay IC nguồn",
        supersedesId: null,
        createdByUserId: technicianId,
        createdAt: "2026-09-19T03:00:00.000Z",
      }),
    });
    const user = userEvent.setup();
    render(
      <RepairOrderWorkspaceScreen
        api={api}
        repairOrderId={orderId}
        search={`shopId=${shopId}`}
        sessionUser={technicianUser}
      />,
    );

    await screen.findByRole("heading", { name: "RFD-2609-00001" });
    expect(screen.queryByLabelText("Kỹ thuật viên hoạt động")).toBeNull();
    await user.click(screen.getByRole("tab", { name: /Chẩn đoán/ }));
    await user.click(screen.getByRole("button", { name: "Xuất bản chẩn đoán" }));
    expect(screen.getByText("Vui lòng nhập kết luận kỹ thuật.")).toBeTruthy();
    expect(screen.getByText("Vui lòng nhập hướng xử lý.")).toBeTruthy();

    await user.type(screen.getByLabelText(/Kết luận kỹ thuật/), "Lỗi nguồn");
    await user.type(screen.getByLabelText(/Hướng xử lý/), "Thay IC nguồn");
    await user.click(screen.getByRole("button", { name: "Xuất bản chẩn đoán" }));
    await waitFor(() =>
      expect(api.createDiagnosis).toHaveBeenCalledWith(shopId, orderId, {
        finding: "Lỗi nguồn",
        recommendation: "Thay IC nguồn",
        supersedesId: null,
      }),
    );
  });

  it("preserves typed diagnosis text after a stale-state conflict", async () => {
    const ownerUser = {
      ...auth.user,
      id: "88888888-8888-4888-8888-888888888888",
      memberships: [{ ...auth.user.memberships[0]!, role: "OWNER" as const }],
    };
    const diagnosing = { ...detail, status: "DIAGNOSING" as const };
    const api = fakeApi({
      getRepairOrder: vi.fn().mockResolvedValue(diagnosing),
      createDiagnosis: vi
        .fn()
        .mockRejectedValue(
          new RepairFlowApiError(409, "REPAIR_ORDER_GUARD_FAILED", "state changed"),
        ),
    });
    const user = userEvent.setup();
    render(
      <RepairOrderWorkspaceScreen
        api={api}
        repairOrderId={orderId}
        search={`shopId=${shopId}`}
        sessionUser={ownerUser}
      />,
    );
    await screen.findByRole("heading", { name: "RFD-2609-00001" });
    await user.click(screen.getByRole("tab", { name: /Chẩn đoán/ }));
    const finding = screen.getByLabelText("Kết luận kỹ thuật");
    const recommendation = screen.getByLabelText("Hướng xử lý");
    await user.type(finding, "Nội dung cần giữ");
    await user.type(recommendation, "Hướng xử lý cần giữ");
    await user.click(screen.getByRole("button", { name: "Xuất bản chẩn đoán" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Nội dung bạn nhập vẫn được giữ lại",
    );
    expect((finding as HTMLTextAreaElement).value).toBe("Nội dung cần giữ");
    expect((recommendation as HTMLTextAreaElement).value).toBe("Hướng xử lý cần giữ");
  });

  it("prefills a correction and binds it to the selected immutable revision", async () => {
    const ownerUser = {
      ...auth.user,
      id: "88888888-8888-4888-8888-888888888888",
      memberships: [{ ...auth.user.memberships[0]!, role: "OWNER" as const }],
    };
    const diagnosis = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      repairOrderId: orderId,
      revisionNo: 1,
      finding: "Lỗi nguồn bản đầu",
      recommendation: "Kiểm tra IC nguồn",
      supersedesId: null,
      createdByUserId: ownerUser.id,
      createdAt: "2026-09-19T03:00:00.000Z",
    };
    const diagnosing = {
      ...detail,
      status: "DIAGNOSING" as const,
      diagnoses: [diagnosis],
    };
    const api = fakeApi({
      getRepairOrder: vi.fn().mockResolvedValue(diagnosing),
      createDiagnosis: vi.fn().mockResolvedValue({
        ...diagnosis,
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        revisionNo: 2,
        supersedesId: diagnosis.id,
      }),
    });
    const user = userEvent.setup();
    render(
      <RepairOrderWorkspaceScreen
        api={api}
        repairOrderId={orderId}
        search={`shopId=${shopId}`}
        sessionUser={ownerUser}
      />,
    );

    await screen.findByRole("heading", { name: "RFD-2609-00001" });
    await user.click(screen.getByRole("tab", { name: /Chẩn đoán/ }));
    await user.click(screen.getByRole("button", { name: "Tạo bản sửa từ chẩn đoán #1" }));
    expect((screen.getByLabelText("Kết luận kỹ thuật") as HTMLTextAreaElement).value).toBe(
      diagnosis.finding,
    );
    await user.click(screen.getByRole("button", { name: "Xuất bản chẩn đoán" }));
    await waitFor(() =>
      expect(api.createDiagnosis).toHaveBeenCalledWith(shopId, orderId, {
        finding: diagnosis.finding,
        recommendation: diagnosis.recommendation,
        supersedesId: diagnosis.id,
      }),
    );
  });

  it("reloads and explains an optimistic transition conflict", async () => {
    const ownerUser = {
      ...auth.user,
      id: "88888888-8888-4888-8888-888888888888",
      memberships: [{ ...auth.user.memberships[0]!, role: "OWNER" as const }],
    };
    const assigned = {
      ...detail,
      assignedTechnicianUserId: technicianId,
      activeAssignment: {
        id: "99999999-9999-4999-8999-999999999999",
        repairOrderId: orderId,
        technicianUserId: technicianId,
        technicianDisplayName: "Kỹ thuật viên Nam",
        assignedByUserId: ownerUser.id,
        assignedAt: "2026-09-19T02:00:00.000Z",
        unassignedAt: null,
      },
    };
    const getOrder = vi.fn().mockResolvedValue(assigned);
    const api = fakeApi({
      getRepairOrder: getOrder,
      transitionRepairOrder: vi
        .fn()
        .mockRejectedValue(new RepairFlowApiError(409, "CONCURRENT_UPDATE", "stale")),
    });
    const user = userEvent.setup();
    render(
      <RepairOrderWorkspaceScreen
        api={api}
        repairOrderId={orderId}
        search={`shopId=${shopId}`}
        sessionUser={ownerUser}
      />,
    );

    await screen.findByRole("heading", { name: "RFD-2609-00001" });
    await user.click(screen.getByRole("button", { name: "Bắt đầu chẩn đoán" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Dữ liệu mới nhất đã được tải lại",
    );
    expect(getOrder.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("keeps workspace data and marks it stale when polling fails", async () => {
    const getOrder = vi
      .fn<RepairOrderWorkspaceApi["getRepairOrder"]>()
      .mockResolvedValueOnce(detail)
      .mockRejectedValue(new Error("offline"));
    render(
      <RepairOrderWorkspaceScreen
        api={fakeApi({ getRepairOrder: getOrder })}
        pollIntervalMs={15}
        repairOrderId={orderId}
        search={`shopId=${shopId}`}
      />,
    );

    expect(await screen.findByText("Máy không lên nguồn")).toBeTruthy();
    expect(
      await screen.findByText(/Dữ liệu đang hiển thị là lần tải thành công gần nhất/),
    ).toBeTruthy();
    expect(screen.getByText("Máy không lên nguồn")).toBeTruthy();
    await waitFor(() => expect(getOrder.mock.calls.length).toBeGreaterThanOrEqual(2));
  });
});
