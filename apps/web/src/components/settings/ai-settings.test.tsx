// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RepairFlowApiError } from "@/lib/api/errors";
import type { AiSettingsApi } from "@/lib/api/intake-api";
import type {
  AiAnalyticsPage,
  AiCapability,
  AiCapabilitySetting,
  AiSettingsView,
  CurrentUser,
} from "@/lib/api/types";

import { AiSettings } from "./ai-settings";

const shopId = "11111111-1111-4111-8111-111111111111";
const owner: CurrentUser = {
  id: "22222222-2222-4222-8222-222222222222",
  email: "owner@example.test",
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
const capabilities: AiCapability[] = [
  "CUSTOMER_SUMMARY",
  "DEVICE_OCR",
  "INTAKE_DRAFT",
  "CHECKLIST_SUGGESTION",
];
const capabilitySettings: AiCapabilitySetting[] = capabilities.map((capability) => ({
  capability,
  enabled: false,
  effectiveEnabled: false,
  monthlyBudgetMicrousd: "10000",
  maxRunCostMicrousd: "2000",
  lockVersion: 3,
  updatedAt: "2026-09-29T00:00:00.000Z",
  currentPeriodReservedMicrousd: "2000",
  currentPeriodSpentMicrousd: "3000",
}));
const settings: AiSettingsView = { globalEnabled: true, capabilities: capabilitySettings };
const analytics: AiAnalyticsPage = {
  data: [
    {
      date: "2026-09-29",
      capability: "CHECKLIST_SUGGESTION",
      requestedCount: 4,
      succeededCount: 3,
      failedCount: 1,
      reviewedCount: 2,
      acceptedUnchangedCount: 1,
      acceptedEditedCount: 1,
      rejectedCount: 0,
      p50LatencyMs: 100,
      p95LatencyMs: 180,
      inputTokens: 80,
      outputTokens: 20,
      estimatedCostMicrousd: "120",
      averageEditDistancePermille: 25,
      averageTimeSavedSeconds: 45,
    },
  ],
  meta: { nextCursor: null },
};

function fakeApi(overrides: Partial<AiSettingsApi> = {}): AiSettingsApi {
  return {
    getAiSettings: vi.fn().mockResolvedValue(settings),
    updateAiSetting: vi.fn().mockResolvedValue(settings),
    getAiAnalytics: vi.fn().mockResolvedValue(analytics),
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("AiSettings", () => {
  it("blocks a non-owner before any owner API request", () => {
    const api = fakeApi();
    render(
      <AiSettings
        api={api}
        user={{ ...owner, memberships: [{ ...owner.memberships[0]!, role: "RECEPTIONIST" }] }}
        search={`shopId=${shopId}`}
        replaceUrl={vi.fn()}
      />,
    );
    expect(screen.getByText("Chỉ chủ cửa hàng được truy cập khu vực này.")).toBeTruthy();
    expect(api.getAiSettings).not.toHaveBeenCalled();
    expect(api.getAiAnalytics).not.toHaveBeenCalled();
  });

  it("renders budgets, privacy warning and aggregate analytics at 360px", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 360 });
    const api = fakeApi();
    render(<AiSettings api={api} user={owner} search={`shopId=${shopId}`} replaceUrl={vi.fn()} />);
    const card = await screen.findByRole("heading", { name: "Gợi ý checklist" });
    expect(card).toBeTruthy();
    expect(screen.getAllByText(/Không nhập API key trên web/)).toHaveLength(4);
    expect(screen.getAllByText(/Đã dùng: 3000/)).toHaveLength(4);
    expect(await screen.findByText("2026-09-29")).toBeTruthy();
    expect(screen.getByText("4")).toBeTruthy();
  });

  it("saves a capability and preserves the proposed values after version conflict", async () => {
    const latest: AiSettingsView = {
      ...settings,
      capabilities: capabilitySettings.map((item) =>
        item.capability === "CHECKLIST_SUGGESTION" ? { ...item, lockVersion: 4 } : item,
      ),
    };
    const updateAiSetting = vi
      .fn()
      .mockRejectedValueOnce(
        new RepairFlowApiError(409, "AI_SETTING_VERSION_CONFLICT", "Changed concurrently."),
      )
      .mockResolvedValueOnce(latest);
    const api = fakeApi({
      updateAiSetting,
      getAiSettings: vi.fn().mockResolvedValueOnce(settings).mockResolvedValueOnce(latest),
    });
    const user = userEvent.setup();
    render(<AiSettings api={api} user={owner} search={`shopId=${shopId}`} replaceUrl={vi.fn()} />);
    const heading = await screen.findByRole("heading", { name: "Gợi ý checklist" });
    const card = heading.closest("article")!;
    await user.click(within(card).getByLabelText("Bật cho cửa hàng"));
    const monthly = within(card).getByLabelText("Ngân sách tháng (micro-USD)");
    await user.clear(monthly);
    await user.type(monthly, "15000");
    await user.click(within(card).getByRole("button", { name: "Lưu cấu hình" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Giá trị bạn đề xuất vẫn được giữ",
    );
    expect(
      (within(card).getByLabelText("Ngân sách tháng (micro-USD)") as HTMLInputElement).value,
    ).toBe("15000");
    await user.click(within(card).getByRole("button", { name: "Lưu cấu hình" }));
    await waitFor(() => expect(updateAiSetting).toHaveBeenCalledTimes(2));
    expect(updateAiSetting.mock.calls[1]).toEqual([
      shopId,
      "CHECKLIST_SUGGESTION",
      expect.objectContaining({
        enabled: true,
        monthlyBudgetMicrousd: "15000",
        expectedLockVersion: 4,
      }),
    ]);
  });

  it("reflects filters in the URL and retains stale aggregate data after a failed reload", async () => {
    const getAiAnalytics = vi
      .fn()
      .mockResolvedValueOnce(analytics)
      .mockRejectedValueOnce(new Error("offline"));
    const api = fakeApi({ getAiAnalytics });
    const replaceUrl = vi.fn();
    const user = userEvent.setup();
    render(
      <AiSettings api={api} user={owner} search={`shopId=${shopId}`} replaceUrl={replaceUrl} />,
    );
    await screen.findByText("2026-09-29");
    await user.type(screen.getByLabelText("Từ ngày"), "2026-09-01");
    await user.type(screen.getByLabelText("Đến ngày"), "2026-09-29");
    await user.selectOptions(screen.getByLabelText("Capability"), "CHECKLIST_SUGGESTION");
    await user.click(screen.getByRole("button", { name: "Áp dụng bộ lọc" }));
    await waitFor(() => expect(getAiAnalytics).toHaveBeenCalledTimes(2));
    expect(replaceUrl).toHaveBeenCalledWith(
      `/settings/ai?shopId=${shopId}&from=2026-09-01&to=2026-09-29&capability=CHECKLIST_SUGGESTION`,
    );
    expect(await screen.findByText(/Đang hiển thị số liệu cũ/)).toBeTruthy();
    expect(screen.getByText("2026-09-29")).toBeTruthy();
  });

  it("shows loading and empty analytics states", async () => {
    let resolveAnalytics!: (value: AiAnalyticsPage) => void;
    const pending = new Promise<AiAnalyticsPage>((resolve) => {
      resolveAnalytics = resolve;
    });
    render(
      <AiSettings
        api={fakeApi({ getAiAnalytics: vi.fn().mockReturnValue(pending) })}
        user={owner}
        search={`shopId=${shopId}`}
        replaceUrl={vi.fn()}
      />,
    );
    expect(screen.getByText("Đang tải số liệu…")).toBeTruthy();
    resolveAnalytics({ data: [], meta: { nextCursor: null } });
    expect(await screen.findByText("Chưa có lượt AI trong khoảng đã chọn.")).toBeTruthy();
  });
});
