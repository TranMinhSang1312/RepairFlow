// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RepairOrderWorkspaceApi } from "@/lib/api/intake-api";
import type { AiRunView, QcTemplate } from "@/lib/api/types";

import { AiChecklistSuggestion } from "./ai-checklist-suggestion";

const itemOne = "11111111-1111-4111-8111-111111111111";
const itemTwo = "22222222-2222-4222-8222-222222222222";
const template: QcTemplate = {
  id: "33333333-3333-4333-8333-333333333333",
  name: "Kiểm tra cuối",
  versionNo: 1,
  isActive: true,
  createdAt: "2026-09-29T00:00:00.000Z",
  items: [
    { id: itemOne, label: "Kiểm tra nguồn", isRequired: true, allowNa: false, sortOrder: 1 },
    { id: itemTwo, label: "Kiểm tra camera", isRequired: false, allowNa: true, sortOrder: 2 },
  ],
};
const output = {
  suggestedItemIds: [itemOne],
  reasoningSummary: "Nên chú ý đường cấp nguồn theo triệu chứng đã ghi nhận.",
  safetyWarnings: ["Nhân viên vẫn phải thực hiện đủ quy trình của cửa hàng."],
};
const queued: AiRunView = {
  id: "44444444-4444-4444-8444-444444444444",
  capability: "CHECKLIST_SUGGESTION",
  status: "QUEUED",
  promptVersion: "checklist-suggestion-v1",
  schemaVersion: "1",
  output: null,
  confidence: null,
  errorCode: null,
  review: null,
  createdAt: "2026-09-29T00:00:00.000Z",
  startedAt: null,
  completedAt: null,
};
const succeeded: AiRunView = {
  ...queued,
  status: "SUCCEEDED",
  output,
  startedAt: "2026-09-29T00:00:00.100Z",
  completedAt: "2026-09-29T00:00:00.200Z",
};

function fakeApi(overrides: Partial<RepairOrderWorkspaceApi> = {}): RepairOrderWorkspaceApi {
  return {
    listAiCapabilities: vi
      .fn()
      .mockResolvedValue([{ capability: "CHECKLIST_SUGGESTION", effectiveEnabled: true }]),
    createChecklistSuggestion: vi.fn().mockResolvedValue(queued),
    getAiRun: vi.fn().mockResolvedValue(succeeded),
    reviewAiRun: vi.fn().mockResolvedValue(succeeded),
    ...overrides,
  } as unknown as RepairOrderWorkspaceApi;
}

async function setup(api = fakeApi(), onApply = vi.fn()) {
  render(
    <AiChecklistSuggestion
      api={api}
      shopId="shop-1"
      repairOrderId="order-1"
      template={template}
      onApply={onApply}
      pollDelayMs={0}
    />,
  );
  await screen.findByRole("button", { name: "Tạo gợi ý" });
  return { api, onApply };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("AiChecklistSuggestion", () => {
  it("renders only when enabled and sends only server-owned source IDs", async () => {
    const user = userEvent.setup();
    const { api } = await setup();
    await user.click(screen.getByRole("button", { name: "Tạo gợi ý" }));
    expect(api.createChecklistSuggestion).toHaveBeenCalledWith(
      "shop-1",
      {
        repairOrderId: "order-1",
        qcTemplateId: template.id,
        phase: "QC",
      },
      expect.stringMatching(/^ai-checklist-/u),
    );
    expect(await screen.findByText(output.reasoningSummary)).toBeTruthy();
    expect((screen.getByLabelText(/Kiểm tra nguồn/) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText(/Kiểm tra camera/) as HTMLInputElement).checked).toBe(false);
  });

  it("prevents duplicate enqueue while polling", async () => {
    const neverCompletes = new Promise<AiRunView>(() => undefined);
    const api = fakeApi({ getAiRun: vi.fn().mockReturnValue(neverCompletes) });
    const user = userEvent.setup();
    await setup(api);
    await user.click(screen.getByRole("button", { name: "Tạo gợi ý" }));
    const queuedButton = await screen.findByRole("button", { name: "Đang tạo gợi ý…" });
    expect((queuedButton as HTMLButtonElement).disabled).toBe(true);
    expect(api.createChecklistSuggestion).toHaveBeenCalledTimes(1);
  });

  it("applies highlights locally and never records PASS or FAIL", async () => {
    const user = userEvent.setup();
    const { api, onApply } = await setup();
    await user.click(screen.getByRole("button", { name: "Tạo gợi ý" }));
    await screen.findByText(output.reasoningSummary);
    await user.click(screen.getByLabelText(/Kiểm tra camera/));
    await user.click(screen.getByRole("button", { name: "Áp dụng đánh dấu" }));
    await waitFor(() =>
      expect(api.reviewAiRun).toHaveBeenCalledWith("shop-1", queued.id, {
        outcome: "ACCEPTED_EDITED",
        reviewedOutput: { ...output, suggestedItemIds: [itemOne, itemTwo] },
      }),
    );
    expect(onApply).toHaveBeenCalledWith([itemOne, itemTwo]);
    const serializedCalls = JSON.stringify([
      ...vi.mocked(api.reviewAiRun!).mock.calls,
      ...onApply.mock.calls,
    ]);
    expect(serializedCalls).not.toMatch(/PASS|FAIL|result/iu);
    expect(screen.getByText(/Kết quả QC vẫn do nhân viên nhập/)).toBeTruthy();
  });

  it("keeps the prior suggestion stale when a later request fails", async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce(queued)
      .mockRejectedValueOnce(new Error("offline"));
    const user = userEvent.setup();
    await setup(fakeApi({ createChecklistSuggestion: create }));
    await user.click(screen.getByRole("button", { name: "Tạo gợi ý" }));
    expect(await screen.findByText(output.reasoningSummary)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Tạo gợi ý" }));
    expect(await screen.findByText(/Đang giữ gợi ý cũ/)).toBeTruthy();
    expect(screen.getByText(output.reasoningSummary)).toBeTruthy();
  });

  it("rejects an out-of-template identifier without offering apply", async () => {
    const invalidRun: AiRunView = {
      ...succeeded,
      output: {
        ...output,
        suggestedItemIds: ["55555555-5555-4555-8555-555555555555"],
      },
    };
    const user = userEvent.setup();
    await setup(fakeApi({ getAiRun: vi.fn().mockResolvedValue(invalidRun) }));
    await user.click(screen.getByRole("button", { name: "Tạo gợi ý" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Áp dụng đánh dấu" })).toBeNull();
  });

  it("supports reject and keeps actions keyboard reachable at 360px", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 360 });
    const user = userEvent.setup();
    const { api } = await setup();
    const create = screen.getByRole("button", { name: "Tạo gợi ý" });
    create.focus();
    expect(document.activeElement).toBe(create);
    await user.click(create);
    const result = await screen.findByRole("group", {
      name: "Chọn mục muốn đánh dấu để nhân viên chú ý",
    });
    expect(within(result).getAllByRole("checkbox")).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "Bỏ qua" }));
    await waitFor(() =>
      expect(api.reviewAiRun).toHaveBeenCalledWith("shop-1", queued.id, {
        outcome: "REJECTED",
      }),
    );
  });

  it("stays hidden when the shop flag is disabled", async () => {
    const api = fakeApi({
      listAiCapabilities: vi
        .fn()
        .mockResolvedValue([{ capability: "CHECKLIST_SUGGESTION", effectiveEnabled: false }]),
    });
    render(
      <AiChecklistSuggestion
        api={api}
        shopId="shop-1"
        repairOrderId="order-1"
        template={template}
        onApply={vi.fn()}
      />,
    );
    await waitFor(() => expect(api.listAiCapabilities).toHaveBeenCalledOnce());
    expect(screen.queryByRole("button", { name: "Tạo gợi ý" })).toBeNull();
  });
});
