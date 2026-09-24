// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RepairOrderWorkspaceApi } from "@/lib/api/intake-api";
import type { CurrentUser, QcTemplate } from "@/lib/api/types";
import { QcTemplateSettings } from "./qc-template-settings";

const shopId = "11111111-1111-4111-8111-111111111111";
const user: CurrentUser = {
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
      branches: [{ id: "33333333-3333-4333-8333-333333333333", name: "Main" }],
    },
  ],
};

const template: QcTemplate = {
  id: "44444444-4444-4444-8444-444444444444",
  name: "Kiểm tra bàn giao",
  versionNo: 2,
  isActive: true,
  createdAt: "2026-09-24T00:00:00.000Z",
  items: [
    {
      id: "55555555-5555-4555-8555-555555555555",
      label: "Camera",
      isRequired: false,
      allowNa: true,
      sortOrder: 2,
    },
    {
      id: "66666666-6666-4666-8666-666666666666",
      label: "Khởi động",
      isRequired: true,
      allowNa: false,
      sortOrder: 1,
    },
  ],
};

function fakeApi(overrides: Record<string, unknown> = {}): RepairOrderWorkspaceApi {
  return {
    listQcTemplates: vi.fn().mockResolvedValue([template]),
    createQcTemplate: vi.fn(),
    deactivateQcTemplate: vi.fn(),
    ...overrides,
  } as unknown as RepairOrderWorkspaceApi;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("QcTemplateSettings", () => {
  it("shows a safe forbidden state to non-owners without loading inactive history", () => {
    const api = fakeApi();
    render(
      <QcTemplateSettings
        api={api}
        replaceUrl={vi.fn()}
        search={`shopId=${shopId}`}
        user={{
          ...user,
          memberships: [{ ...user.memberships[0]!, role: "RECEPTIONIST" }],
        }}
      />,
    );
    expect(screen.getByRole("heading", { name: "Không có quyền quản lý mẫu QC" })).toBeTruthy();
    expect(api.listQcTemplates).not.toHaveBeenCalled();
  });

  it("renders immutable versions and their items in explicit order", async () => {
    render(
      <QcTemplateSettings
        api={fakeApi()}
        replaceUrl={vi.fn()}
        search={`shopId=${shopId}`}
        user={user}
      />,
    );
    expect(await screen.findByText("Kiểm tra bàn giao · v2")).toBeTruthy();
    const itemText = screen.getByText("1. Khởi động");
    const nextItemText = screen.getByText("2. Camera");
    expect(
      itemText.compareDocumentPosition(nextItemText) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Sửa/ })).toBeNull();
  });

  it("validates, confirms, publishes ordered items and reloads authoritative history", async () => {
    const created = { ...template, versionNo: 3 };
    const createQcTemplate = vi.fn().mockResolvedValue(created);
    const listQcTemplates = vi
      .fn()
      .mockResolvedValueOnce([template])
      .mockResolvedValueOnce([created, { ...template, isActive: false }]);
    const userEventApi = userEvent.setup();
    render(
      <QcTemplateSettings
        api={fakeApi({ createQcTemplate, listQcTemplates })}
        replaceUrl={vi.fn()}
        search={`shopId=${shopId}`}
        user={user}
      />,
    );
    await screen.findByText("Kiểm tra bàn giao · v2");

    await userEventApi.click(screen.getByRole("button", { name: "Xem lại và phát hành" }));
    expect(screen.getByText("Tên mẫu không được để trống.")).toBeTruthy();
    await userEventApi.type(screen.getByRole("textbox", { name: /Tên mẫu/ }), "Kiểm tra bàn giao");
    await userEventApi.type(
      screen.getByRole("textbox", { name: /Nhãn kiểm tra/ }),
      "Khởi động ổn định",
    );
    await userEventApi.click(screen.getByRole("button", { name: "Thêm mục" }));
    const labels = screen.getAllByRole("textbox", { name: /Nhãn kiểm tra/ });
    await userEventApi.type(labels[1]!, "Camera hoạt động");
    const itemTwo = labels[1]!.closest("li")!;
    await userEventApi.click(within(itemTwo).getByLabelText("Cho phép Không áp dụng"));
    await userEventApi.click(screen.getByRole("button", { name: "Xem lại và phát hành" }));
    expect(await screen.findByRole("dialog", { name: "Phát hành phiên bản mới?" })).toBeTruthy();
    await userEventApi.click(screen.getByRole("button", { name: "Xác nhận" }));

    await waitFor(() => expect(createQcTemplate).toHaveBeenCalledOnce());
    expect(createQcTemplate.mock.calls[0]![1]).toEqual({
      name: "Kiểm tra bàn giao",
      items: [
        { label: "Khởi động ổn định", isRequired: true, allowNa: false, sortOrder: 1 },
        { label: "Camera hoạt động", isRequired: true, allowNa: true, sortOrder: 2 },
      ],
    });
    expect(createQcTemplate.mock.calls[0]![2]).toMatch(/^qc-template-create-/);
    expect(listQcTemplates).toHaveBeenCalledTimes(2);
    expect(await screen.findByText(/Đã tạo Kiểm tra bàn giao phiên bản 3/)).toBeTruthy();
  });

  it("preserves edits and reuses the same idempotency key after a retryable create error", async () => {
    const createQcTemplate = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ ...template, versionNo: 3 });
    const userEventApi = userEvent.setup();
    render(
      <QcTemplateSettings
        api={fakeApi({ createQcTemplate })}
        replaceUrl={vi.fn()}
        search={`shopId=${shopId}`}
        user={user}
      />,
    );
    await screen.findByText("Kiểm tra bàn giao · v2");
    await userEventApi.type(screen.getByRole("textbox", { name: /Tên mẫu/ }), "Mẫu retry");
    await userEventApi.type(
      screen.getByRole("textbox", { name: /Nhãn kiểm tra/ }),
      "Nguồn ổn định",
    );
    await userEventApi.click(screen.getByRole("button", { name: "Xem lại và phát hành" }));
    await userEventApi.click(await screen.findByRole("button", { name: "Xác nhận" }));
    expect(await screen.findByText(/Dữ liệu bạn đã nhập vẫn được giữ lại/)).toBeTruthy();
    expect((screen.getByRole("textbox", { name: /Tên mẫu/ }) as HTMLInputElement).value).toBe(
      "Mẫu retry",
    );
    await userEventApi.click(screen.getByRole("button", { name: "Xem lại và phát hành" }));
    await userEventApi.click(await screen.findByRole("button", { name: "Xác nhận" }));
    await waitFor(() => expect(createQcTemplate).toHaveBeenCalledTimes(2));
    expect(createQcTemplate.mock.calls[1]![2]).toBe(createQcTemplate.mock.calls[0]![2]);
  });

  it("confirms deactivation and never offers history editing or deletion", async () => {
    const deactivateQcTemplate = vi.fn().mockResolvedValue({ ...template, isActive: false });
    const userEventApi = userEvent.setup();
    render(
      <QcTemplateSettings
        api={fakeApi({ deactivateQcTemplate })}
        replaceUrl={vi.fn()}
        search={`shopId=${shopId}`}
        user={user}
      />,
    );
    await screen.findByText("Kiểm tra bàn giao · v2");
    const deactivate = screen.getByRole("button", { name: "Ngừng phiên bản này" });
    await userEventApi.click(deactivate);
    expect(await screen.findByRole("dialog", { name: "Ngừng mẫu đang hoạt động?" })).toBeTruthy();
    await userEventApi.click(screen.getByRole("button", { name: "Xác nhận" }));
    await waitFor(() => expect(deactivateQcTemplate).toHaveBeenCalledOnce());
    expect(deactivateQcTemplate.mock.calls[0]!.slice(0, 2)).toEqual([shopId, template.id]);
    expect(deactivateQcTemplate.mock.calls[0]![2]).toMatch(/^qc-template-deactivate-/);
    expect(screen.queryByRole("button", { name: /Xóa phiên bản/ })).toBeNull();
  });
});
