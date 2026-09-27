// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RepairFlowApiError } from "@/lib/api/errors";
import type { NotificationOperationsApi } from "@/lib/api/intake-api";
import type { CurrentUser, NotificationOperation } from "@/lib/api/types";
import { NotificationOperations } from "./notification-operations";

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
const job: NotificationOperation = {
  id: "33333333-3333-4333-8333-333333333333",
  eventType: "QUOTE_SENT",
  aggregateType: "QUOTE",
  aggregateId: "44444444-4444-4444-8444-444444444444",
  status: "DEAD_LETTER",
  attempts: 5,
  lockVersion: 7,
  availableAt: "2026-09-27T10:00:00.000Z",
  lastErrorCode: "PROVIDER_TIMEOUT",
  completedAt: null,
  createdAt: "2026-09-27T09:00:00.000Z",
  deliveries: [
    {
      id: "55555555-5555-4555-8555-555555555555",
      channel: "EMAIL",
      status: "FAILED",
      attempts: 5,
      lastErrorCode: "PROVIDER_TIMEOUT",
      sentAt: null,
      createdAt: "2026-09-27T09:00:00.000Z",
    },
  ],
};

function fakeApi(overrides: Partial<NotificationOperationsApi> = {}): NotificationOperationsApi {
  return {
    listNotificationOperations: vi
      .fn()
      .mockResolvedValue({ data: [job], meta: { nextCursor: null } }),
    getNotificationOperation: vi.fn().mockResolvedValue(job),
    retryNotificationOperation: vi.fn().mockResolvedValue({
      ...job,
      status: "PENDING",
      attempts: 0,
      lockVersion: 8,
    }),
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("NotificationOperations", () => {
  it("blocks non-owners without issuing an operations request", () => {
    const api = fakeApi();
    render(
      <NotificationOperations
        api={api}
        user={{ ...owner, memberships: [{ ...owner.memberships[0]!, role: "RECEPTIONIST" }] }}
        search={`shopId=${shopId}`}
        replaceUrl={vi.fn()}
      />,
    );
    expect(screen.getByText("Chỉ chủ cửa hàng được truy cập khu vực này.")).toBeTruthy();
    expect(api.listNotificationOperations).not.toHaveBeenCalled();
  });

  it("renders safe metadata at 360px and keeps filters in the URL", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 360 });
    const api = fakeApi();
    const replaceUrl = vi.fn();
    const actor = userEvent.setup();
    render(
      <NotificationOperations
        api={api}
        user={owner}
        search={`shopId=${shopId}`}
        replaceUrl={replaceUrl}
      />,
    );
    expect(await screen.findByRole("heading", { name: "QUOTE_SENT" })).toBeTruthy();
    expect(screen.getAllByText("PROVIDER_TIMEOUT")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Thử lại" })).toBeTruthy();

    await actor.selectOptions(screen.getByLabelText("Trạng thái"), "DEAD_LETTER");
    await actor.type(screen.getByLabelText("Loại sự kiện"), "ready_for_pickup");
    await actor.selectOptions(screen.getByLabelText("Kênh"), "SMS");
    await actor.click(screen.getByRole("button", { name: "Áp dụng" }));
    await waitFor(() =>
      expect(api.listNotificationOperations).toHaveBeenLastCalledWith(shopId, {
        status: "DEAD_LETTER",
        eventType: "READY_FOR_PICKUP",
        channel: "SMS",
      }),
    );
    expect(replaceUrl).toHaveBeenCalledWith(
      `/settings/notifications?shopId=${shopId}&status=DEAD_LETTER&eventType=READY_FOR_PICKUP&channel=SMS`,
    );
  });

  it("shows loading, empty and recoverable error states", async () => {
    let resolvePage!: (value: { data: []; meta: { nextCursor: null } }) => void;
    const pending = new Promise<{ data: []; meta: { nextCursor: null } }>((resolve) => {
      resolvePage = resolve;
    });
    const listNotificationOperations = vi
      .fn()
      .mockReturnValueOnce(pending)
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({ data: [], meta: { nextCursor: null } });
    render(
      <NotificationOperations
        api={fakeApi({ listNotificationOperations })}
        user={owner}
        search={`shopId=${shopId}`}
        replaceUrl={vi.fn()}
      />,
    );
    expect(screen.getByText("Đang tải job thông báo…")).toBeTruthy();
    resolvePage({ data: [], meta: { nextCursor: null } });
    expect(await screen.findByText("Không có thông báo lỗi")).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Áp dụng" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Không thể kết nối với máy chủ",
    );
    await userEvent.click(screen.getByRole("button", { name: "Tải lại" }));
    expect(await screen.findByText("Không có thông báo lỗi")).toBeTruthy();
  });

  it("loads the next cursor without replacing existing jobs", async () => {
    const older = {
      ...job,
      id: "66666666-6666-4666-8666-666666666666",
      eventType: "HANDOVER_COMPLETED",
    };
    const listNotificationOperations = vi
      .fn()
      .mockResolvedValueOnce({ data: [job], meta: { nextCursor: "cursor-two" } })
      .mockResolvedValueOnce({ data: [older], meta: { nextCursor: null } });
    render(
      <NotificationOperations
        api={fakeApi({ listNotificationOperations })}
        user={owner}
        search={`shopId=${shopId}`}
        replaceUrl={vi.fn()}
      />,
    );
    await screen.findByRole("heading", { name: "QUOTE_SENT" });
    await userEvent.click(screen.getByRole("button", { name: "Tải thêm" }));
    expect(await screen.findByRole("heading", { name: "HANDOVER_COMPLETED" })).toBeTruthy();
    expect(listNotificationOperations).toHaveBeenLastCalledWith(shopId, {}, "cursor-two");
    expect(screen.getByRole("heading", { name: "QUOTE_SENT" })).toBeTruthy();
  });

  it("confirms retry with lock version and reloads after a concurrent update", async () => {
    const retryNotificationOperation = vi
      .fn()
      .mockRejectedValue(
        new RepairFlowApiError(409, "CONCURRENT_UPDATE", "Job changed concurrently."),
      );
    const listNotificationOperations = vi
      .fn()
      .mockResolvedValue({ data: [job], meta: { nextCursor: null } });
    render(
      <NotificationOperations
        api={fakeApi({ listNotificationOperations, retryNotificationOperation })}
        user={owner}
        search={`shopId=${shopId}`}
        replaceUrl={vi.fn()}
      />,
    );
    await screen.findByRole("heading", { name: "QUOTE_SENT" });
    await userEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Xác nhận thử lại" }));
    await waitFor(() =>
      expect(retryNotificationOperation).toHaveBeenCalledWith(
        shopId,
        job.id,
        7,
        expect.stringMatching(/^notification-retry-/u),
      ),
    );
    expect((await screen.findByRole("alert")).textContent).toContain("Job vừa thay đổi");
    expect(listNotificationOperations).toHaveBeenCalledTimes(2);
  });
});
