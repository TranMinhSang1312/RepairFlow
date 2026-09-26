// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RepairFlowApiError } from "@/lib/api/errors";
import type { RepairOrderWorkspaceApi } from "@/lib/api/intake-api";
import type { Membership, RepairOrderDetail } from "@/lib/api/types";

import { HandoverPanel } from "./handover-panel";

afterEach(cleanup);

const shopId = "11111111-1111-4111-8111-111111111111";
const orderId = "22222222-2222-4222-8222-222222222222";
const membership: Membership = {
  shopId,
  shopName: "RepairFlow",
  role: "RECEPTIONIST",
  status: "ACTIVE",
  timezone: "Asia/Ho_Chi_Minh",
  intakePhotoMinimum: 1,
  branches: [{ id: "33333333-3333-4333-8333-333333333333", name: "Chi nhánh chính" }],
};

function order(overrides: Partial<RepairOrderDetail> = {}): RepairOrderDetail {
  return {
    id: orderId,
    code: "RF-0001",
    serviceType: "STANDARD",
    sourceOrderId: null,
    status: "READY_FOR_PICKUP",
    completionOutcome: "REPAIRED",
    priority: "NORMAL",
    branchId: membership.branches[0]!.id,
    reportedProblem: "Không lên nguồn",
    intakeCondition: "Xước nhẹ",
    assignedTechnicianUserId: null,
    customer: {
      id: "customer",
      name: "Minh An",
      phone: "0901000000",
      email: null,
      notes: null,
      createdAt: "2026-09-01T00:00:00.000Z",
    },
    device: {
      id: "device",
      customerId: "customer",
      type: "PHONE",
      brand: "Samsung",
      model: "S25",
      color: null,
      serialMasked: "••1234",
      imeiMasked: null,
    },
    promisedAt: null,
    receivedAt: "2026-09-01T00:00:00.000Z",
    readyAt: "2026-09-25T00:00:00.000Z",
    returnedAt: null,
    lockVersion: 7,
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
    paymentSummary: { approvedTotal: 500_000, paidTotal: 400_000, amountDue: 100_000 },
    payments: [],
    handover: null,
    warranty: null,
    sourceOrder: null,
    followUpOrders: [],
    timeline: [],
    ...overrides,
  };
}

function api(overrides: Partial<RepairOrderWorkspaceApi> = {}): RepairOrderWorkspaceApi {
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

describe("HandoverPanel", () => {
  it("shows authoritative zero totals and hides all binding actions from technicians", () => {
    render(
      <HandoverPanel
        api={api()}
        membership={{ ...membership, role: "TECHNICIAN" }}
        onReload={vi.fn()}
        order={order({
          completionOutcome: "UNREPAIRABLE",
          paymentSummary: { approvedTotal: 0, paidTotal: 0, amountDue: 0 },
        })}
        shopId={shopId}
      />,
    );

    expect(screen.getAllByText((content) => content.replace(/\s/gu, "") === "0₫")).toHaveLength(3);
    expect(screen.queryByRole("button", { name: "Ghi nhận thanh toán" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Kiểm tra và bàn giao" })).toBeNull();
  });

  it("keeps one idempotency key for an unchanged payment retry and rotates it after editing", async () => {
    const user = userEvent.setup();
    const createPayment = vi
      .fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce({
        payment: {},
        summary: { approvedTotal: 500_000, paidTotal: 450_000, amountDue: 50_000 },
      });
    render(
      <HandoverPanel
        api={api({ createPayment })}
        membership={membership}
        onReload={vi.fn()}
        order={order()}
        shopId={shopId}
      />,
    );

    const input = screen.getByRole("textbox", { name: "Số tiền (VND)" });
    await user.type(input, "50000");
    await user.click(screen.getByRole("button", { name: "Ghi nhận thanh toán" }));
    await screen.findByText(/Chưa thể ghi nhận thanh toán/);
    await user.click(screen.getByRole("button", { name: "Ghi nhận thanh toán" }));
    await waitFor(() => expect(createPayment).toHaveBeenCalledTimes(2));
    expect(createPayment.mock.calls[0]![3]).toBe(createPayment.mock.calls[1]![3]);

    await user.clear(input);
    await user.type(input, "60000");
    await user.click(screen.getByRole("button", { name: "Ghi nhận thanh toán" }));
    await waitFor(() => expect(createPayment).toHaveBeenCalledTimes(3));
    expect(createPayment.mock.calls[2]![3]).not.toBe(createPayment.mock.calls[1]![3]);
  });

  it("reviews the exact handover payload and never renders the returned raw tracking token", async () => {
    const user = userEvent.setup();
    const rawUrl = "https://repairflow.test/p/raw-secret-track-token";
    const completeHandover = vi.fn().mockResolvedValue({
      order: order({ status: "COMPLETED" }),
      handover: {
        id: "handover",
        recipientName: "Nguyễn Văn A",
        paymentDisposition: "PAID",
        paymentNote: null,
        handedOverByUserId: "staff",
        handedOverAt: "2026-09-26T00:00:00.000Z",
      },
      payment: null,
      warranty: null,
      paymentSummary: { approvedTotal: 500_000, paidTotal: 500_000, amountDue: 0 },
      trackingUrl: rawUrl,
      trackingExpiresAt: "2099-09-26T00:00:00.000Z",
    });
    render(
      <HandoverPanel
        api={api({ completeHandover })}
        membership={membership}
        onReload={vi.fn()}
        order={order()}
        shopId={shopId}
      />,
    );

    await user.type(screen.getByRole("textbox", { name: "Người nhận thiết bị" }), "Nguyễn Văn A");
    await user.type(screen.getByRole("textbox", { name: /Thanh toán cuối/ }), "100000");
    await user.type(screen.getByLabelText("Bảo hành đến"), "2099-01-01T10:00");
    await user.type(
      screen.getByRole("textbox", { name: "Điều khoản bảo hành" }),
      "Bảo hành nguồn 90 ngày",
    );
    await user.click(screen.getByRole("button", { name: "Kiểm tra và bàn giao" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.contains(document.activeElement)).toBe(true);
    await user.click(screen.getByRole("button", { name: "Xác nhận bàn giao" }));

    await waitFor(() => expect(completeHandover).toHaveBeenCalledOnce());
    expect(completeHandover.mock.calls[0]![0]).toBe(shopId);
    expect(completeHandover.mock.calls[0]![1]).toBe(orderId);
    expect(completeHandover.mock.calls[0]![2]).toMatchObject({
      recipientName: "Nguyễn Văn A",
      paymentDisposition: "PAID",
      expectedLockVersion: 7,
      payment: { amount: 100_000, method: "CASH", reference: null },
      warranty: { terms: "Bảo hành nguồn 90 ngày" },
    });
    expect(document.body.textContent).not.toContain(rawUrl);
    expect(document.body.textContent).not.toContain("raw-secret-track-token");
    expect(screen.getByRole("button", { name: "Sao chép liên kết" })).toBeTruthy();
  });

  it("treats TOKEN_EXPIRED replay as completed without retrying or rotating the command", async () => {
    const user = userEvent.setup();
    const completeHandover = vi
      .fn()
      .mockRejectedValue(new RepairFlowApiError(410, "TOKEN_EXPIRED", "expired"));
    render(
      <HandoverPanel
        api={api({ completeHandover })}
        membership={membership}
        onReload={vi.fn()}
        order={order({
          completionOutcome: "UNREPAIRABLE",
          paymentSummary: { approvedTotal: 0, paidTotal: 0, amountDue: 0 },
        })}
        shopId={shopId}
      />,
    );
    await user.type(screen.getByRole("textbox", { name: "Người nhận thiết bị" }), "Nguyễn Văn A");
    await user.click(screen.getByRole("button", { name: "Kiểm tra và bàn giao" }));
    await user.click(screen.getByRole("button", { name: "Xác nhận bàn giao" }));
    expect(await screen.findAllByText(/liên kết theo dõi cố định đã hết hạn/i)).toHaveLength(2);
    expect(completeHandover).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "Sao chép liên kết" })).toBeNull();
  });
});
