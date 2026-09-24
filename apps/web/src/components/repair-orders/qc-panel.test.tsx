// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RepairFlowApiError } from "@/lib/api/errors";
import type { RepairOrderWorkspaceApi } from "@/lib/api/intake-api";
import type { Membership, QcRun, QcTemplate, RepairOrderDetail } from "@/lib/api/types";
import { QcPanel } from "./qc-panel";

const shopId = "11111111-1111-4111-8111-111111111111";
const orderId = "22222222-2222-4222-8222-222222222222";
const ownerId = "33333333-3333-4333-8333-333333333333";
const technicianId = "44444444-4444-4444-8444-444444444444";

const membership: Membership = {
  shopId,
  shopName: "RepairFlow Demo",
  role: "OWNER",
  status: "ACTIVE",
  timezone: "Asia/Ho_Chi_Minh",
  intakePhotoMinimum: 1,
  branches: [{ id: "55555555-5555-4555-8555-555555555555", name: "Chi nhánh chính" }],
};

const template: QcTemplate = {
  id: "66666666-6666-4666-8666-666666666666",
  name: "Kiểm tra bàn giao",
  versionNo: 2,
  isActive: true,
  createdAt: "2026-09-24T01:00:00.000Z",
  items: [
    {
      id: "77777777-7777-4777-8777-777777777777",
      label: "Thiết bị khởi động ổn định",
      isRequired: true,
      allowNa: false,
      sortOrder: 1,
    },
    {
      id: "88888888-8888-4888-8888-888888888888",
      label: "Kiểm tra camera phụ",
      isRequired: false,
      allowNa: true,
      sortOrder: 2,
    },
  ],
};

function run(runNo: number, result: "PASS" | "FAIL"): QcRun {
  return {
    id: `99999999-9999-4999-8999-99999999999${runNo}`,
    repairOrderId: orderId,
    qcTemplateId: template.id,
    templateName: template.name,
    templateVersionNo: template.versionNo,
    runNo,
    result,
    notes: result === "FAIL" ? "Camera vẫn lỗi" : null,
    checkedByUserId: technicianId,
    createdAt: `2026-09-24T0${runNo}:00:00.000Z`,
    results: template.items.map((item, index) => ({
      id: `${item.id.slice(0, -1)}${runNo}`,
      qcTemplateItemId: item.id,
      labelSnapshot: item.label,
      result: result === "FAIL" && index === 0 ? "FAIL" : "PASS",
      note: null,
      evidenceMediaAssetIds: [],
    })),
  };
}

function detail(overrides: Partial<RepairOrderDetail> = {}): RepairOrderDetail {
  return {
    id: orderId,
    code: "RF-2609-0001",
    status: "QUALITY_CHECK",
    completionOutcome: null,
    priority: "NORMAL",
    branchId: membership.branches[0]!.id,
    reportedProblem: "Không lên nguồn",
    intakeCondition: "Có xước nhẹ",
    assignedTechnicianUserId: technicianId,
    customer: {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      name: "Khách thử nghiệm",
      phone: "0900000000",
      email: null,
      notes: null,
      createdAt: "2026-09-24T00:00:00.000Z",
    },
    device: {
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      customerId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      type: "PHONE",
      brand: "Demo",
      model: "Phone",
      color: null,
      serialMasked: null,
      imeiMasked: null,
    },
    promisedAt: null,
    receivedAt: "2026-09-24T00:00:00.000Z",
    readyAt: null,
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
    timeline: [],
    ...overrides,
  };
}

function fakeApi(overrides: Record<string, unknown> = {}): RepairOrderWorkspaceApi {
  return {
    listQcTemplates: vi.fn().mockResolvedValue([template]),
    submitQcRun: vi.fn(),
    uploadQcEvidence: vi.fn(),
    transitionRepairOrder: vi.fn(),
    ...overrides,
  } as unknown as RepairOrderWorkspaceApi;
}

function StatefulPanel({
  api,
  initialOrder = detail(),
  actor = membership,
  userId = ownerId,
  onReload = vi.fn().mockResolvedValue(undefined),
}: {
  api: RepairOrderWorkspaceApi;
  initialOrder?: RepairOrderDetail;
  actor?: Membership;
  userId?: string;
  onReload?: () => Promise<void>;
}) {
  const [order, setOrder] = useState(initialOrder);
  return (
    <QcPanel
      api={api}
      membership={actor}
      onOrderChange={setOrder}
      onReload={onReload}
      order={order}
      shopId={shopId}
      userId={userId}
    />
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("QcPanel", () => {
  it("orders immutable history by runNo and lets a receptionist read but not submit", async () => {
    const receptionist = { ...membership, role: "RECEPTIONIST" as const };
    const api = fakeApi({ listQcTemplates: vi.fn().mockResolvedValue([template]) });
    const { container } = render(
      <StatefulPanel
        actor={receptionist}
        api={api}
        initialOrder={detail({ status: "REPAIRING", qcRuns: [run(2, "FAIL"), run(1, "PASS")] })}
      />,
    );

    await screen.findByText(/Lễ tân được xem lịch sử QC/);
    const entries = Array.from(container.querySelectorAll(".qc-run-list > li"));
    expect(entries[0]?.textContent).toContain("Lần 1");
    expect(entries[1]?.textContent).toContain("Lần 2");
    expect(entries[1]?.textContent).toContain("Mới nhất");
    expect(screen.getByText(/đã đưa phiếu trở lại Đang sửa/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Xem lại checklist" })).toBeNull();
    expect(screen.queryByRole("button", { name: /sẵn sàng trả máy/ })).toBeNull();
  });

  it("enforces the owner, receptionist, assigned and unassigned technician action matrix", async () => {
    const assignedTechnician = { ...membership, role: "TECHNICIAN" as const };
    const user = userEvent.setup();
    const assigned = render(
      <StatefulPanel actor={assignedTechnician} api={fakeApi()} userId={technicianId} />,
    );
    expect(await screen.findByRole("button", { name: "Xem lại checklist" })).toBeTruthy();
    assigned.unmount();

    const unassigned = render(
      <StatefulPanel actor={assignedTechnician} api={fakeApi()} userId={ownerId} />,
    );
    expect(await screen.findByText(/biểu mẫu QC đã bị khóa/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Xem lại checklist" })).toBeNull();
    unassigned.unmount();

    const receptionist = { ...membership, role: "RECEPTIONIST" as const };
    render(
      <StatefulPanel
        actor={receptionist}
        api={fakeApi({
          transitionRepairOrder: vi.fn().mockResolvedValue({
            ...detail(),
            status: "READY_FOR_PICKUP",
            completionOutcome: "REPAIRED",
            lockVersion: 9,
          }),
        })}
        initialOrder={detail({ qcRuns: [run(1, "PASS")], lockVersion: 8 })}
      />,
    );
    const ready = await screen.findByRole("button", { name: "Đánh dấu sẵn sàng trả máy" });
    await user.click(ready);
    expect(await screen.findByText(/sẵn sàng trả khách/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Xem lại checklist" })).toBeNull();
  });

  it("shows a safe template error, retries, and explains an empty active-template list", async () => {
    const listQcTemplates = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce([]);
    const user = userEvent.setup();
    render(<StatefulPanel api={fakeApi({ listQcTemplates })} />);

    expect(await screen.findByRole("alert")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Thử tải lại mẫu" }));
    expect(await screen.findByText("Chưa có mẫu QC đang hoạt động.")).toBeTruthy();
    expect(listQcTemplates).toHaveBeenCalledTimes(2);
  });

  it("submits every answer, trusts the server result and uses the advanced lock for ready", async () => {
    const serverRun = run(1, "PASS");
    const submitQcRun = vi.fn().mockResolvedValue({
      run: serverRun,
      orderStatus: "QUALITY_CHECK",
      orderLockVersion: 8,
    });
    const transitionRepairOrder = vi.fn().mockResolvedValue({
      ...detail(),
      status: "READY_FOR_PICKUP",
      completionOutcome: "REPAIRED",
      lockVersion: 9,
    });
    const api = fakeApi({ submitQcRun, transitionRepairOrder });
    const user = userEvent.setup();
    render(<StatefulPanel api={api} />);

    const startup = await screen.findByRole("group", { name: /Thiết bị khởi động ổn định/ });
    const camera = screen.getByRole("group", { name: /Kiểm tra camera phụ/ });
    expect(within(startup).queryByLabelText("Không áp dụng")).toBeNull();
    await user.click(within(startup).getByLabelText("Đạt"));
    await user.click(within(camera).getByLabelText("Không áp dụng"));
    await user.click(screen.getByRole("button", { name: "Xem lại checklist" }));
    expect(await screen.findByRole("dialog", { name: "Xác nhận gửi checklist QC" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Gửi QC bất biến" }));

    await waitFor(() => expect(submitQcRun).toHaveBeenCalledTimes(1));
    expect(submitQcRun.mock.calls[0]![2]).toEqual({
      qcTemplateId: template.id,
      expectedLockVersion: 7,
      notes: null,
      results: [
        {
          qcTemplateItemId: template.items[0]!.id,
          result: "PASS",
          note: null,
          evidenceMediaAssetIds: [],
        },
        {
          qcTemplateItemId: template.items[1]!.id,
          result: "NOT_APPLICABLE",
          note: null,
          evidenceMediaAssetIds: [],
        },
      ],
    });
    expect(await screen.findByText(/Máy chủ ghi nhận QC lần 1 đạt/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Đánh dấu sẵn sàng trả máy" }));
    await waitFor(() => expect(transitionRepairOrder).toHaveBeenCalledTimes(1));
    expect(transitionRepairOrder.mock.calls[0]![2]).toEqual({
      targetStatus: "READY_FOR_PICKUP",
      completionOutcome: "REPAIRED",
      expectedLockVersion: 8,
    });
  });

  it("requires failure notes, preserves draft on conflict, and reuses a key for an unchanged retry", async () => {
    const conflict = new RepairFlowApiError(409, "CONCURRENT_UPDATE", "Phiếu vừa thay đổi.");
    const submitQcRun = vi
      .fn()
      .mockRejectedValueOnce(conflict)
      .mockResolvedValueOnce({
        run: run(1, "FAIL"),
        orderStatus: "REPAIRING",
        orderLockVersion: 8,
      });
    const onReload = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<StatefulPanel api={fakeApi({ submitQcRun })} onReload={onReload} />);

    const startup = await screen.findByRole("group", { name: /Thiết bị khởi động ổn định/ });
    const camera = screen.getByRole("group", { name: /Kiểm tra camera phụ/ });
    await user.click(within(startup).getByLabelText("Không đạt"));
    await user.click(within(camera).getByLabelText("Đạt"));
    await user.click(screen.getByRole("button", { name: "Xem lại checklist" }));
    expect(screen.getByText(/Kết quả không đạt cần ghi rõ lý do/)).toBeTruthy();
    await user.type(screen.getByLabelText(/Ghi chú chung/), "Camera vẫn chập chờn");
    await user.click(screen.getByRole("button", { name: "Xem lại checklist" }));
    await user.click(await screen.findByRole("button", { name: "Gửi QC bất biến" }));

    expect(await screen.findByText(/Checklist và ảnh vẫn được giữ/)).toBeTruthy();
    expect(onReload).toHaveBeenCalledOnce();
    expect((within(startup).getByLabelText("Không đạt") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText(/Ghi chú chung/) as HTMLTextAreaElement).value).toBe(
      "Camera vẫn chập chờn",
    );
    await user.click(screen.getByRole("button", { name: "Tôi đã xem dữ liệu mới" }));
    await user.click(screen.getByRole("button", { name: "Xem lại checklist" }));
    await user.click(await screen.findByRole("button", { name: "Gửi QC bất biến" }));
    await waitFor(() => expect(submitQcRun).toHaveBeenCalledTimes(2));
    expect(submitQcRun.mock.calls[1]![3]).toBe(submitQcRun.mock.calls[0]![3]);
    expect(await screen.findByText(/đã đưa phiếu về sửa chữa/)).toBeTruthy();
  });

  it("uploads only verified QC evidence IDs and supports retry after upload failure", async () => {
    const uploadQcEvidence = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    const submitQcRun = vi.fn().mockResolvedValue({
      run: run(1, "PASS"),
      orderStatus: "QUALITY_CHECK",
      orderLockVersion: 8,
    });
    const user = userEvent.setup();
    render(<StatefulPanel api={fakeApi({ uploadQcEvidence, submitQcRun })} />);

    const startup = await screen.findByRole("group", { name: /Thiết bị khởi động ổn định/ });
    const camera = screen.getByRole("group", { name: /Kiểm tra camera phụ/ });
    await user.click(within(startup).getByLabelText("Đạt"));
    await user.click(within(camera).getByLabelText("Đạt"));
    await user.upload(
      within(startup).getByLabelText("Thêm ảnh bằng chứng"),
      new File(["image"], "qc.jpg", { type: "image/jpeg" }),
    );
    expect(await within(startup).findByText("Lỗi")).toBeTruthy();
    await user.click(within(startup).getByRole("button", { name: "Thử lại" }));
    expect(await within(startup).findByText("Xong")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Xem lại checklist" }));
    await user.click(await screen.findByRole("button", { name: "Gửi QC bất biến" }));

    await waitFor(() => expect(submitQcRun).toHaveBeenCalledOnce());
    expect(submitQcRun.mock.calls[0]![2].results[0].evidenceMediaAssetIds).toEqual([
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    ]);
  });

  it("returns focus after closing the review dialog and keeps primary actions visible at 360px", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 360 });
    const user = userEvent.setup();
    render(<StatefulPanel api={fakeApi()} />);
    const startup = await screen.findByRole("group", { name: /Thiết bị khởi động ổn định/ });
    const camera = screen.getByRole("group", { name: /Kiểm tra camera phụ/ });
    await user.click(within(startup).getByLabelText("Đạt"));
    await user.click(within(camera).getByLabelText("Đạt"));
    const review = screen.getByRole("button", { name: "Xem lại checklist" });
    await user.click(review);
    const cancel = await screen.findByRole("button", { name: "Quay lại chỉnh sửa" });
    expect(document.activeElement).toBe(cancel);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(document.activeElement).toBe(review));
    expect(document.body.contains(review)).toBe(true);
  });
});
