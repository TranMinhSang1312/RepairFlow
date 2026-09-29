import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AiCustomerSummaryApi } from "@/lib/api/intake-api";
import type { AiRunView, RepairOrderDetail } from "@/lib/api/types";

import { AiCustomerSummary } from "./ai-customer-summary";

const output = {
  summary: "Pin bị phồng và máy tắt nguồn khi rút sạc.",
  claimsUsed: ["diagnosis-finding"],
  warnings: [],
};

const queued: AiRunView = {
  id: "run-1",
  capability: "CUSTOMER_SUMMARY",
  status: "QUEUED",
  promptVersion: "customer-summary-v1",
  schemaVersion: "1",
  output: null,
  confidence: null,
  errorCode: null,
  review: null,
  createdAt: "2026-09-28T00:00:00.000Z",
  startedAt: null,
  completedAt: null,
};

const succeeded: AiRunView = {
  ...queued,
  status: "SUCCEEDED",
  output,
  startedAt: "2026-09-28T00:00:00.100Z",
  completedAt: "2026-09-28T00:00:00.200Z",
};

const order = {
  id: "order-1",
  diagnoses: [
    {
      id: "diagnosis-1",
      repairOrderId: "order-1",
      revisionNo: 1,
      finding: "Pin bị phồng",
      recommendation: "Kiểm tra nguồn",
      supersedesId: null,
      createdByUserId: "user-1",
      createdAt: "2026-09-28T00:00:00.000Z",
    },
  ],
  workLogs: [
    {
      id: "work-1",
      repairOrderId: "order-1",
      quoteItemId: null,
      scopeKey: null,
      type: "TEST",
      effectiveType: "TEST",
      content: "Đã kiểm tra nguồn",
      supersedesId: null,
      isEffective: true,
      createdByUserId: "user-1",
      createdAt: "2026-09-28T00:00:00.000Z",
    },
    {
      id: "internal-1",
      repairOrderId: "order-1",
      quoteItemId: null,
      scopeKey: null,
      type: "INTERNAL_NOTE",
      effectiveType: "INTERNAL_NOTE",
      content: "Không được gửi khách",
      supersedesId: null,
      isEffective: true,
      createdByUserId: "user-1",
      createdAt: "2026-09-28T00:00:00.000Z",
    },
  ],
} as RepairOrderDetail;

function fakeApi(overrides: Partial<AiCustomerSummaryApi> = {}): AiCustomerSummaryApi {
  return {
    createCustomerSummary: vi.fn().mockResolvedValue(queued),
    getAiRun: vi.fn().mockResolvedValue(succeeded),
    reviewAiRun: vi.fn().mockResolvedValue({
      ...succeeded,
      review: {
        outcome: "ACCEPTED_UNCHANGED",
        reviewedAt: "2026-09-28T00:00:01.000Z",
        editDistancePermille: 0,
        timeSavedSeconds: null,
      },
    }),
    ...overrides,
  };
}

function setup(api = fakeApi(), onInsert = vi.fn()) {
  render(
    <AiCustomerSummary
      api={api}
      canInsert
      onInsert={onInsert}
      order={order}
      pollDelaysMs={[0]}
      shopId="shop-1"
    />,
  );
  return { api, onInsert };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("AiCustomerSummary", () => {
  it("shows only customer-safe source choices and sends selected server IDs", async () => {
    const user = userEvent.setup();
    const { api } = setup();
    expect(screen.getByText(/Chẩn đoán #1/)).toBeTruthy();
    expect(screen.getByText(/Nhật ký kiểm tra/)).toBeTruthy();
    expect(screen.queryByText(/Không được gửi khách/)).toBeNull();
    await user.click(screen.getByText(/Nhật ký kiểm tra/));
    await user.click(screen.getByRole("button", { name: "Tạo bản nháp AI" }));
    expect(api.createCustomerSummary).toHaveBeenCalledWith(
      "shop-1",
      expect.objectContaining({
        repairOrderId: "order-1",
        diagnosisId: "diagnosis-1",
        workLogIds: ["work-1"],
      }),
      expect.stringMatching(/^customer-summary-/u),
    );
    expect(await screen.findByDisplayValue(output.summary)).toBeTruthy();
  });

  it("allows editing and inserts without overwriting the parent field", async () => {
    const user = userEvent.setup();
    const { api, onInsert } = setup();
    await user.click(screen.getByRole("button", { name: "Tạo bản nháp AI" }));
    const editor = await screen.findByLabelText("Bản nháp để nhân viên kiểm tra");
    await user.clear(editor);
    await user.type(editor, "Pin có dấu hiệu phồng; cần nhân viên kiểm tra lại.");
    await user.click(screen.getByRole("button", { name: "Chèn vào ghi chú báo giá" }));
    await waitFor(() =>
      expect(api.reviewAiRun).toHaveBeenCalledWith(
        "shop-1",
        "run-1",
        expect.objectContaining({
          outcome: "ACCEPTED_EDITED",
          reviewedOutput: expect.objectContaining({
            summary: "Pin có dấu hiệu phồng; cần nhân viên kiểm tra lại.",
          }),
        }),
      ),
    );
    expect(onInsert).toHaveBeenCalledWith("Pin có dấu hiệu phồng; cần nhân viên kiểm tra lại.");
    expect(
      (screen.getByRole("button", { name: "Chèn vào ghi chú báo giá" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("keeps a prior draft visible when a refresh attempt fails", async () => {
    const user = userEvent.setup();
    const create = vi
      .fn()
      .mockResolvedValueOnce(queued)
      .mockRejectedValueOnce(new Error("offline"));
    setup(fakeApi({ createCustomerSummary: create }));
    await user.click(screen.getByRole("button", { name: "Tạo bản nháp AI" }));
    expect(await screen.findByDisplayValue(output.summary)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Tạo bản nháp AI" }));
    expect(await screen.findByDisplayValue(output.summary)).toBeTruthy();
    expect(screen.getByText("Bản nháp cũ")).toBeTruthy();
  });

  it("rejects a draft exactly once", async () => {
    const user = userEvent.setup();
    const { api } = setup();
    await user.click(screen.getByRole("button", { name: "Tạo bản nháp AI" }));
    await screen.findByDisplayValue(output.summary);
    await user.click(screen.getByRole("button", { name: "Từ chối bản nháp" }));
    await waitFor(() =>
      expect(api.reviewAiRun).toHaveBeenCalledWith("shop-1", "run-1", { outcome: "REJECTED" }),
    );
    expect(screen.queryByDisplayValue(output.summary)).toBeNull();
  });

  it("cancels UI polling without applying a late create response", async () => {
    const user = userEvent.setup();
    let resolveCreate: ((value: AiRunView) => void) | undefined;
    const createCustomerSummary = vi.fn(
      () =>
        new Promise<AiRunView>((resolve) => {
          resolveCreate = resolve;
        }),
    );
    const { api } = setup(fakeApi({ createCustomerSummary }));
    await user.click(screen.getByRole("button", { name: "Tạo bản nháp AI" }));
    await user.click(screen.getByRole("button", { name: "Dừng kiểm tra" }));
    await act(async () => resolveCreate?.(succeeded));
    expect(screen.queryByLabelText("Bản nháp để nhân viên kiểm tra")).toBeNull();
    expect(api.getAiRun).not.toHaveBeenCalled();
    expect(screen.getByText(/Tác vụ phía máy chủ có thể vẫn đang chạy/)).toBeTruthy();
  });

  it("keeps every action keyboard reachable at a 360px viewport", async () => {
    Object.defineProperty(globalThis, "innerWidth", { configurable: true, value: 360 });
    const user = userEvent.setup();
    setup();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByLabelText(/Chẩn đoán #1/));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByLabelText(/Nhật ký kiểm tra/));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Tạo bản nháp AI" }));
  });
});
// @vitest-environment jsdom
