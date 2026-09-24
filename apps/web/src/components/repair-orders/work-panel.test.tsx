// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RepairFlowApiError } from "@/lib/api/errors";
import type { RepairOrderWorkspaceApi } from "@/lib/api/intake-api";
import type { Membership, RepairOrderDetail, WorkLog } from "@/lib/api/types";

import { WorkPanel } from "./work-panel";

afterEach(cleanup);

const shopId = "11111111-1111-4111-8111-111111111111";
const orderId = "22222222-2222-4222-8222-222222222222";
const ownerId = "33333333-3333-4333-8333-333333333333";
const quoteId = "44444444-4444-4444-8444-444444444444";
const serviceId = "55555555-5555-4555-8555-555555555555";
const serviceScope = "66666666-6666-4666-8666-666666666666";
const partId = "77777777-7777-4777-8777-777777777777";
const partScope = "88888888-8888-4888-8888-888888888888";

function membership(role: Membership["role"] = "OWNER"): Membership {
  return {
    shopId,
    shopName: "RepairFlow Demo",
    role,
    status: "ACTIVE",
    timezone: "Asia/Ho_Chi_Minh",
    intakePhotoMinimum: 1,
    branches: [],
  };
}

function detail(overrides: Partial<RepairOrderDetail> = {}): RepairOrderDetail {
  const quoteItems = [
    {
      id: serviceId,
      scopeKey: serviceScope,
      carriedFromQuoteItemId: null,
      kind: "SERVICE" as const,
      description: "Sửa nguồn",
      displayNote: null,
      quantity: 1,
      quantityUnit: "EACH" as const,
      unitPrice: 300_000,
      lineTotal: 300_000,
      isOptional: false,
      approvalGroup: null,
    },
    {
      id: partId,
      scopeKey: partScope,
      carriedFromQuoteItemId: null,
      kind: "PART" as const,
      description: "IC nguồn",
      displayNote: "Linh kiện chính hãng",
      quantity: 1,
      quantityUnit: "EACH" as const,
      unitPrice: 500_000,
      lineTotal: 500_000,
      isOptional: false,
      approvalGroup: null,
    },
  ];
  return {
    id: orderId,
    code: "RFD-2609-00001",
    status: "REPAIRING",
    completionOutcome: null,
    priority: "NORMAL",
    branchId: "99999999-9999-4999-8999-999999999999",
    reportedProblem: "Không lên nguồn",
    intakeCondition: "Xước nhẹ",
    assignedTechnicianUserId: ownerId,
    customer: {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      name: "Khách hàng",
      phone: "0900000000",
      email: null,
      notes: null,
      createdAt: "2026-09-23T00:00:00.000Z",
    },
    device: {
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      customerId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      type: "PHONE",
      brand: "Samsung",
      model: "S25",
      color: null,
      serialMasked: null,
      imeiMasked: null,
    },
    promisedAt: null,
    receivedAt: "2026-09-23T00:00:00.000Z",
    readyAt: null,
    returnedAt: null,
    lockVersion: 4,
    accessories: [],
    media: [],
    activeAssignment: null,
    diagnoses: [],
    quoteVersions: [
      {
        id: quoteId,
        repairOrderId: orderId,
        diagnosisId: null,
        versionNo: 1,
        status: "ACCEPTED",
        currency: "VND",
        items: quoteItems,
        subtotal: 800_000,
        discount: 0,
        total: 800_000,
        customerNote: null,
        expiresAt: null,
        sentAt: "2026-09-23T00:00:00.000Z",
        decidedAt: "2026-09-23T00:30:00.000Z",
        createdAt: "2026-09-23T00:00:00.000Z",
        updatedAt: "2026-09-23T00:30:00.000Z",
      },
    ],
    approvedScope: {
      quoteVersionId: quoteId,
      decision: "ACCEPTED",
      approvedTotal: 800_000,
      decidedAt: "2026-09-23T00:30:00.000Z",
      items: quoteItems.map((item) => ({
        quoteItemId: item.id,
        scopeKey: item.scopeKey,
        kind: item.kind,
        description: item.description,
        displayNote: item.displayNote,
        quantity: item.quantity,
        quantityUnit: item.quantityUnit,
        unitPrice: item.unitPrice,
        lineTotal: item.lineTotal,
        isOptional: item.isOptional,
        approvalGroup: item.approvalGroup,
      })),
    },
    workLogs: [],
    partRequirements: [],
    partsUsed: [],
    timeline: [],
    ...overrides,
  };
}

function fakeApi(overrides: Record<string, unknown> = {}): RepairOrderWorkspaceApi {
  return {
    createWorkLog: vi.fn(),
    createPartRequirement: vi.fn(),
    updatePartRequirement: vi.fn(),
    createPartUsed: vi.fn(),
    transitionRepairOrder: vi.fn(),
    ...overrides,
  } as unknown as RepairOrderWorkspaceApi;
}

function renderPanel(
  options: {
    order?: RepairOrderDetail;
    role?: Membership["role"];
    userId?: string;
    api?: RepairOrderWorkspaceApi;
    onReload?: () => Promise<void>;
  } = {},
) {
  const onReload = options.onReload ?? vi.fn().mockResolvedValue(undefined);
  const onNavigateQuote = vi.fn();
  const api = options.api ?? fakeApi();
  const rendered = render(
    <WorkPanel
      api={api}
      membership={membership(options.role)}
      onNavigateQuote={onNavigateQuote}
      onReload={onReload}
      order={options.order ?? detail()}
      shopId={shopId}
      userId={options.userId ?? ownerId}
    />,
  );
  return { api, onReload, onNavigateQuote, ...rendered };
}

describe("WorkPanel", () => {
  it("renders only the server approved allowlist and gives receptionists a useful read-only view", async () => {
    const user = userEvent.setup();
    const { onNavigateQuote } = renderPanel({ role: "RECEPTIONIST" });

    expect(screen.getByText("Sửa nguồn")).toBeTruthy();
    expect(screen.getByText("IC nguồn")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Ghi nhật ký" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Chuyển sang QC" })).toBeNull();
    await user.click(screen.getByRole("button", { name: /Phạm vi hoặc giá thay đổi/ }));
    expect(onNavigateQuote).toHaveBeenCalledOnce();
  });

  it("applies assignment and exact work-log state rules", () => {
    const approved = detail({ status: "APPROVED" });
    const { unmount } = renderPanel({
      order: approved,
      role: "TECHNICIAN",
      userId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    });
    expect(screen.queryByRole("button", { name: "Ghi nhật ký" })).toBeNull();
    unmount();

    renderPanel({ order: approved });
    expect(screen.getByRole("option", { name: "Trao đổi khách hàng" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Ghi chú nội bộ" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "Sửa chữa" })).toBeNull();
    expect(screen.queryByText("Ghi nhận linh kiện đã dùng")).toBeNull();
  });

  it("uses the server-provided root semantic type for correction visibility", () => {
    const baseLog = {
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      repairOrderId: orderId,
      quoteItemId: serviceId,
      scopeKey: serviceScope,
      type: "CORRECTION" as const,
      content: "Bản hiệu lực",
      supersedesId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      isEffective: true,
      createdByUserId: ownerId,
      createdAt: "2026-09-23T01:00:00.000Z",
    };
    renderPanel({
      order: detail({
        status: "APPROVED",
        workLogs: [
          { ...baseLog, effectiveType: "REPAIR" },
          {
            ...baseLog,
            id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
            effectiveType: "CUSTOMER_CONTACT",
            quoteItemId: null,
            scopeKey: null,
          },
        ],
      }),
    });
    expect(screen.getAllByRole("button", { name: "Đính chính bản ghi này" })).toHaveLength(1);
  });

  it("appends a technical log, prevents duplicate submit, and reloads authoritative history", async () => {
    const user = userEvent.setup();
    let resolveCreate!: (value: WorkLog) => void;
    const createWorkLog = vi.fn<RepairOrderWorkspaceApi["createWorkLog"]>(
      () =>
        new Promise<WorkLog>((resolve) => {
          resolveCreate = resolve;
        }),
    );
    const onReload = vi.fn().mockResolvedValue(undefined);
    renderPanel({ api: fakeApi({ createWorkLog }), onReload });

    await user.type(screen.getByLabelText("Nội dung"), "Đã thay IC nguồn");
    await user.click(screen.getByRole("button", { name: "Ghi nhật ký" }));
    await user.click(screen.getByRole("button", { name: "Đang ghi…" }));
    expect(createWorkLog).toHaveBeenCalledTimes(1);
    expect(createWorkLog.mock.calls[0]![2]).toEqual({
      type: "REPAIR",
      content: "Đã thay IC nguồn",
      quoteItemId: serviceId,
    });
    expect(createWorkLog.mock.calls[0]![3]).toMatch(/^work-log-/);
    resolveCreate({} as WorkLog);
    await waitFor(() => expect(onReload).toHaveBeenCalledOnce());
  });

  it("creates corrections without editing immutable history", async () => {
    const user = userEvent.setup();
    const original = {
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      repairOrderId: orderId,
      quoteItemId: serviceId,
      scopeKey: serviceScope,
      type: "REPAIR" as const,
      effectiveType: "REPAIR" as const,
      content: "Bản gốc",
      supersedesId: null,
      isEffective: true,
      createdByUserId: ownerId,
      createdAt: "2026-09-23T01:00:00.000Z",
    };
    const createWorkLog = vi.fn().mockResolvedValue({});
    renderPanel({ order: detail({ workLogs: [original] }), api: fakeApi({ createWorkLog }) });

    await user.click(screen.getByRole("button", { name: "Đính chính bản ghi này" }));
    await user.type(screen.getByLabelText("Nội dung"), "Nội dung chính xác");
    await user.click(screen.getByRole("button", { name: "Lưu đính chính" }));
    expect(createWorkLog.mock.calls[0]![2]).toEqual({
      type: "CORRECTION",
      content: "Nội dung chính xác",
      supersedesId: original.id,
    });
    expect(screen.getByText("Bản gốc")).toBeTruthy();
  });

  it("offers only allowed requirement transitions and keeps CANCELLED read-only", async () => {
    const user = userEvent.setup();
    const needed = {
      id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      repairOrderId: orderId,
      quoteItemId: partId,
      scopeKey: partScope,
      nameSnapshot: "IC nguồn",
      sku: "IC-01",
      quantity: 1,
      quantityUnit: "EACH" as const,
      status: "NEEDED" as const,
      lockVersion: 2,
      createdByUserId: ownerId,
      updatedByUserId: ownerId,
      createdAt: "2026-09-23T01:00:00.000Z",
      updatedAt: "2026-09-23T01:00:00.000Z",
    };
    const cancelled = {
      ...needed,
      id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      status: "CANCELLED" as const,
    };
    const updatePartRequirement = vi.fn().mockResolvedValue({});
    renderPanel({
      order: detail({ partRequirements: [needed, cancelled] }),
      api: fakeApi({ updatePartRequirement }),
    });

    expect(screen.queryByRole("button", { name: /hủy/i })).toBeNull();
    expect(screen.getByText("Đã hủy khi đối soát phạm vi")).toBeTruthy();
    const neededRow = screen.getByText("Cần linh kiện").closest("li")!;
    await user.click(within(neededRow).getByRole("button", { name: "Đánh dấu sẵn sàng" }));
    expect(updatePartRequirement.mock.calls[0]![2]).toEqual({
      targetStatus: "AVAILABLE",
      expectedLockVersion: 2,
    });
  });

  it("keeps resume disabled while the latest server snapshot has unavailable required parts", () => {
    const needed = {
      id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      repairOrderId: orderId,
      quoteItemId: partId,
      scopeKey: partScope,
      nameSnapshot: "IC nguồn",
      sku: null,
      quantity: 1,
      quantityUnit: "EACH" as const,
      status: "ORDERED" as const,
      lockVersion: 1,
      createdByUserId: ownerId,
      updatedByUserId: ownerId,
      createdAt: "2026-09-23T01:00:00.000Z",
      updatedAt: "2026-09-23T01:00:00.000Z",
    };
    renderPanel({ order: detail({ status: "WAITING_PARTS", partRequirements: [needed] }) });
    expect(
      (screen.getByRole("button", { name: "Tiếp tục sửa chữa" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByText(/Snapshot mới nhất còn linh kiện chưa sẵn sàng/)).toBeTruthy();
  });

  it("validates authoritative part price and appends a superseding snapshot", async () => {
    const user = userEvent.setup();
    const existing = {
      id: "12121212-1212-4212-8212-121212121212",
      repairOrderId: orderId,
      quoteItemId: partId,
      scopeKey: partScope,
      supersedesId: null,
      name: "IC nguồn cũ",
      sku: null,
      quantity: 1,
      unitCost: 200_000,
      unitSalePrice: 500_000,
      isEffective: true,
      createdByUserId: ownerId,
      createdAt: "2026-09-23T02:00:00.000Z",
    };
    const createPartUsed = vi.fn().mockResolvedValue({});
    renderPanel({ order: detail({ partsUsed: [existing] }), api: fakeApi({ createPartUsed }) });

    await user.click(screen.getByRole("button", { name: "Đính chính snapshot" }));
    const sale = screen.getByLabelText("Giá bán VND");
    await user.clear(sale);
    await user.type(sale, "499999");
    await user.click(screen.getByRole("button", { name: "Lưu đính chính" }));
    expect(screen.getByText(/Giá bán phải khớp đơn giá đã duyệt/)).toBeTruthy();
    await user.clear(sale);
    await user.type(sale, "500000");
    await user.click(screen.getByRole("button", { name: "Lưu đính chính" }));
    expect(createPartUsed.mock.calls[0]![2]).toMatchObject({
      quoteItemId: partId,
      supersedesId: existing.id,
      unitSalePrice: 500_000,
    });
  });

  it("uses current lockVersion, preserves input on conflict, and requires review", async () => {
    const user = userEvent.setup();
    const transitionRepairOrder = vi
      .fn()
      .mockRejectedValueOnce(new RepairFlowApiError(409, "CONCURRENT_UPDATE", "conflict"))
      .mockResolvedValue({});
    const onReload = vi.fn().mockResolvedValue(undefined);
    renderPanel({ api: fakeApi({ transitionRepairOrder }), onReload });
    await user.type(screen.getByLabelText("Nội dung"), "Giữ nội dung này");
    await user.click(screen.getByRole("button", { name: "Chuyển sang QC" }));

    await waitFor(() => expect(onReload).toHaveBeenCalledOnce());
    expect(transitionRepairOrder.mock.calls[0]![2]).toEqual({
      targetStatus: "QUALITY_CHECK",
      expectedLockVersion: 4,
    });
    expect((screen.getByLabelText("Nội dung") as HTMLTextAreaElement).value).toBe(
      "Giữ nội dung này",
    );
    await user.click(screen.getByRole("button", { name: "Tôi đã xem dữ liệu mới" }));
    await user.click(screen.getByRole("button", { name: "Chuyển sang QC" }));
    await waitFor(() => expect(transitionRepairOrder).toHaveBeenCalledTimes(2));
    expect(transitionRepairOrder.mock.calls[1]![3]).toBe(transitionRepairOrder.mock.calls[0]![3]);
  });

  it("retains an idempotency key for an unknown-result retry and changes it with the payload", async () => {
    const user = userEvent.setup();
    const createWorkLog = vi
      .fn()
      .mockRejectedValueOnce(new Error("connection reset"))
      .mockResolvedValue({});
    renderPanel({ api: fakeApi({ createWorkLog }) });
    const content = screen.getByLabelText("Nội dung");
    await user.type(content, "Kiểm tra lần một");
    await user.click(screen.getByRole("button", { name: "Ghi nhật ký" }));
    await screen.findByText(/Kết quả thao tác chưa xác định/);
    await user.click(screen.getByRole("button", { name: "Ghi nhật ký" }));
    await waitFor(() => expect(createWorkLog).toHaveBeenCalledTimes(2));
    expect(createWorkLog.mock.calls[1]![3]).toBe(createWorkLog.mock.calls[0]![3]);

    await user.type(content, "Payload mới");
    await user.click(screen.getByRole("button", { name: "Ghi nhật ký" }));
    await waitFor(() => expect(createWorkLog).toHaveBeenCalledTimes(3));
    expect(createWorkLog.mock.calls[2]![3]).not.toBe(createWorkLog.mock.calls[1]![3]);
  });

  it("blocks mutation when approved lineage is duplicated instead of inferring by text or price", () => {
    const invalid = detail();
    invalid.approvedScope = {
      ...invalid.approvedScope!,
      items: [
        invalid.approvedScope!.items[0]!,
        { ...invalid.approvedScope!.items[1]!, scopeKey: serviceScope },
      ],
    };
    renderPanel({ order: invalid });
    expect(screen.getByRole("alert").textContent).toMatch(/định danh bị trùng/);
    expect(screen.queryByRole("button", { name: "Ghi nhật ký" })).toBeNull();
  });

  it("accepts explicit stable lineage and blocks missing, foreign, or cyclic lineage", () => {
    const currentItemId = "23232323-2323-4232-8232-232323232323";
    const makeReplacement = (carriedFromQuoteItemId: string | null, cyclic = false) => {
      const order = detail();
      const prior = order.quoteVersions[0]!;
      const source = prior.items[0]!;
      const current = {
        ...source,
        id: currentItemId,
        carriedFromQuoteItemId,
        unitPrice: source.unitPrice + 10_000,
        lineTotal: source.lineTotal + 10_000,
      };
      if (cyclic) prior.items[0] = { ...source, carriedFromQuoteItemId: currentItemId };
      const replacement = {
        ...prior,
        id: "24242424-2424-4242-8242-242424242424",
        versionNo: 2,
        items: [current],
        subtotal: current.lineTotal,
        total: current.lineTotal,
      };
      order.quoteVersions = [prior, replacement];
      order.approvedScope = {
        quoteVersionId: replacement.id,
        decision: "ACCEPTED",
        approvedTotal: replacement.total,
        decidedAt: "2026-09-23T03:00:00.000Z",
        items: [
          {
            quoteItemId: current.id,
            scopeKey: current.scopeKey,
            kind: current.kind,
            description: current.description,
            displayNote: current.displayNote,
            quantity: current.quantity,
            quantityUnit: current.quantityUnit,
            unitPrice: current.unitPrice,
            lineTotal: current.lineTotal,
            isOptional: current.isOptional,
            approvalGroup: current.approvalGroup,
          },
        ],
      };
      return order;
    };

    renderPanel({ order: makeReplacement(serviceId) });
    expect(screen.queryByRole("alert")).toBeNull();
    cleanup();

    renderPanel({ order: makeReplacement(null) });
    expect(screen.getByRole("alert").textContent).toMatch(/thiếu lineage/);
    cleanup();

    renderPanel({ order: makeReplacement("25252525-2525-4252-8252-252525252525") });
    expect(screen.getByRole("alert").textContent).toMatch(/thiếu, lạ/);
    cleanup();

    renderPanel({ order: makeReplacement(serviceId, true) });
    expect(screen.getByRole("alert").textContent).toMatch(/vòng tham chiếu/);
  });

  it("keeps primary work controls visible without horizontal document overflow at 360px", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 360 });
    renderPanel();
    expect(screen.getByRole("button", { name: "Chuyển sang QC" })).toBeTruthy();
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
      document.documentElement.clientWidth,
    );
  });
});
