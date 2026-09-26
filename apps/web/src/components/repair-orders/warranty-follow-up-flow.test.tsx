// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RepairOrderWorkspaceApi } from "@/lib/api/intake-api";
import type { Membership, RepairOrderDetail } from "@/lib/api/types";

import { WarrantyFollowUpFlow } from "./warranty-follow-up-flow";

afterEach(cleanup);

const shopId = "11111111-1111-4111-8111-111111111111";
const branchId = "22222222-2222-4222-8222-222222222222";
const membership: Membership = {
  shopId,
  shopName: "RepairFlow",
  role: "OWNER",
  status: "ACTIVE",
  timezone: "Asia/Ho_Chi_Minh",
  intakePhotoMinimum: 1,
  branches: [{ id: branchId, name: "Chi nhánh chính" }],
};
const source: RepairOrderDetail = {
  id: "source-order",
  code: "RF-0001",
  serviceType: "STANDARD",
  sourceOrderId: null,
  status: "COMPLETED",
  completionOutcome: "REPAIRED",
  priority: "NORMAL",
  branchId,
  reportedProblem: "Không lên nguồn",
  intakeCondition: "Xước nhẹ",
  assignedTechnicianUserId: null,
  customer: {
    id: "archived-customer",
    name: "Khách snapshot",
    phone: "0901000000",
    email: null,
    notes: null,
    createdAt: "2026-09-01T00:00:00.000Z",
  },
  device: {
    id: "archived-device",
    customerId: "archived-customer",
    type: "PHONE",
    brand: "Samsung",
    model: "S25",
    color: null,
    serialMasked: "••1234",
    imeiMasked: null,
  },
  promisedAt: null,
  receivedAt: "2026-09-01T00:00:00.000Z",
  readyAt: "2026-09-20T00:00:00.000Z",
  returnedAt: "2026-09-21T00:00:00.000Z",
  lockVersion: 10,
  accessories: [],
  media: [],
  activeAssignment: null,
  diagnoses: [],
  quoteVersions: [],
  approvedScope: null,
  workLogs: [],
  partRequirements: [],
  partsUsed: [],
  qcRuns: [],
  payments: [],
  paymentSummary: { approvedTotal: 0, paidTotal: 0, amountDue: 0 },
  handover: null,
  warranty: {
    id: "warranty",
    startsAt: "2026-09-21T00:00:00.000Z",
    endsAt: "2099-09-21T00:00:00.000Z",
    terms: "90 ngày",
  },
  sourceOrder: null,
  followUpOrders: [],
  timeline: [],
};

function api(overrides: Partial<RepairOrderWorkspaceApi>): RepairOrderWorkspaceApi {
  return {
    restoreSession: vi.fn(),
    uploadIntakeMedia: vi.fn(),
    listRepairOrders: vi.fn(),
    getRepairOrder: vi.fn(),
    listTechnicians: vi.fn(),
    assignTechnician: vi.fn(),
    transitionRepairOrder: vi.fn(),
    createDiagnosis: vi.fn(),
    createQuote: vi.fn(),
    replaceDraftQuote: vi.fn(),
    sendQuote: vi.fn(),
    createWorkLog: vi.fn(),
    createPartRequirement: vi.fn(),
    updatePartRequirement: vi.fn(),
    createPartUsed: vi.fn(),
    listQcTemplates: vi.fn(),
    createQcTemplate: vi.fn(),
    deactivateQcTemplate: vi.fn(),
    uploadQcEvidence: vi.fn(),
    submitQcRun: vi.fn(),
    createPayment: vi.fn(),
    uploadHandoverEvidence: vi.fn(),
    completeHandover: vi.fn(),
    createWarrantyFollowUp: vi.fn(),
    ...overrides,
  };
}

describe("WarrantyFollowUpFlow", () => {
  it("uses the immutable source snapshot and creates a fresh warranty intake with evidence", async () => {
    const user = userEvent.setup();
    const uploadIntakeMedia = vi.fn().mockImplementation(async (_shop, _file, progress) => {
      progress?.({ stage: "uploading" });
      progress?.({ stage: "complete" });
      return "media-1";
    });
    const created = {
      ...source,
      id: "new-order",
      code: "RF-W-0002",
      serviceType: "WARRANTY",
      status: "RECEIVED" as const,
    };
    const createWarrantyFollowUp = vi.fn().mockResolvedValue(created);
    render(
      <WarrantyFollowUpFlow
        api={api({ uploadIntakeMedia, createWarrantyFollowUp })}
        membership={membership}
        onReload={vi.fn()}
        order={source}
        shopId={shopId}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Tạo phiếu bảo hành" }));
    expect(screen.getByText("Khách snapshot")).toBeTruthy();
    expect(screen.getByText(/không tìm kiếm hoặc thay thế hồ sơ khác/i)).toBeTruthy();
    await user.type(screen.getByRole("textbox", { name: "Vấn đề bảo hành" }), "Lỗi nguồn tái phát");
    await user.type(
      screen.getByRole("textbox", { name: "Tình trạng khi nhận lại" }),
      "Máy không lên, vỏ nguyên trạng",
    );
    await user.upload(
      screen.getByLabelText(/Ảnh tiếp nhận mới/),
      new File(["photo"], "device.jpg", { type: "image/jpeg" }),
    );
    await waitFor(() => expect(uploadIntakeMedia).toHaveBeenCalledOnce());
    const checks = screen.getAllByRole("checkbox");
    await user.click(checks[0]!);
    await user.click(checks[1]!);
    await user.click(screen.getByRole("button", { name: "Tạo phiếu bảo hành" }));

    await waitFor(() => expect(createWarrantyFollowUp).toHaveBeenCalledOnce());
    expect(createWarrantyFollowUp.mock.calls[0]![0]).toBe(shopId);
    expect(createWarrantyFollowUp.mock.calls[0]![1]).toBe(source.id);
    expect(createWarrantyFollowUp.mock.calls[0]![2]).toEqual({
      eligibilityConfirmed: true,
      branchId,
      priority: "NORMAL",
      reportedProblem: "Lỗi nguồn tái phát",
      intakeCondition: "Máy không lên, vỏ nguyên trạng",
      consentAccepted: true,
      promisedAt: null,
      accessories: [],
      intakeMediaAssetIds: ["media-1"],
    });
    expect(
      (await screen.findByRole("link", { name: "Mở phiếu bảo hành" })).getAttribute("href"),
    ).toBe(`/orders/new-order?shopId=${shopId}`);
  });

  it("keeps mutation controls hidden from technicians", () => {
    render(
      <WarrantyFollowUpFlow
        api={api({})}
        membership={{ ...membership, role: "TECHNICIAN" }}
        onReload={vi.fn()}
        order={source}
        shopId={shopId}
      />,
    );
    expect(screen.queryByRole("button", { name: "Tạo phiếu bảo hành" })).toBeNull();
    expect(screen.getByText(/Chỉ owner hoặc receptionist/)).toBeTruthy();
  });
});
