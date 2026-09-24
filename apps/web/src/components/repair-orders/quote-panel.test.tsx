// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RepairOrderWorkspaceApi } from "@/lib/api/intake-api";
import type { Membership, Quote, RepairOrderDetail } from "@/lib/api/types";

import { QuotePanel } from "./quote-panel";

const shopId = "11111111-1111-4111-8111-111111111111";
const orderId = "22222222-2222-4222-8222-222222222222";
const quoteOneId = "33333333-3333-4333-8333-333333333333";
const quoteTwoId = "44444444-4444-4444-8444-444444444444";

const membership: Membership = {
  shopId,
  shopName: "RepairFlow Demo",
  role: "RECEPTIONIST",
  status: "ACTIVE",
  timezone: "Asia/Ho_Chi_Minh",
  intakePhotoMinimum: 1,
  branches: [],
};

function quote(overrides: Partial<Quote> = {}): Quote {
  return {
    id: quoteOneId,
    repairOrderId: orderId,
    diagnosisId: null,
    versionNo: 1,
    status: "DRAFT",
    currency: "VND",
    items: [
      {
        id: "55555555-5555-4555-8555-555555555555",
        scopeKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        carriedFromQuoteItemId: null,
        kind: "SERVICE",
        description: "Kiểm tra và sửa nguồn",
        displayNote: null,
        quantity: 1,
        quantityUnit: "EACH",
        unitPrice: 100_000,
        lineTotal: 100_000,
        isOptional: false,
        approvalGroup: null,
      },
    ],
    subtotal: 100_000,
    discount: 0,
    total: 100_000,
    customerNote: null,
    expiresAt: "2099-12-31T00:00:00.000Z",
    sentAt: null,
    decidedAt: null,
    createdAt: "2026-09-23T00:00:00.000Z",
    updatedAt: "2026-09-23T00:00:00.000Z",
    ...overrides,
  };
}

function approvedItemsFrom(value: Quote) {
  return value.items.map((item) => ({
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
  }));
}

function detail(quotes: Quote[] = [], status: RepairOrderDetail["status"] = "DIAGNOSING") {
  return {
    id: orderId,
    code: "RFD-2609-00001",
    status,
    completionOutcome: null,
    priority: "NORMAL",
    branchId: "66666666-6666-4666-8666-666666666666",
    reportedProblem: "Không lên nguồn",
    intakeCondition: "Xước nhẹ",
    assignedTechnicianUserId: null,
    customer: {
      id: "77777777-7777-4777-8777-777777777777",
      name: "Khách thử nghiệm",
      phone: "0900000000",
      email: null,
      notes: null,
      createdAt: "2026-09-23T00:00:00.000Z",
    },
    device: {
      id: "88888888-8888-4888-8888-888888888888",
      customerId: "77777777-7777-4777-8777-777777777777",
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
    lockVersion: 0,
    accessories: [],
    media: [],
    activeAssignment: null,
    diagnoses: [],
    quoteVersions: quotes,
    approvedScope: null,
    workLogs: [],
    partRequirements: [],
    partsUsed: [],
    qcRuns: [],
    timeline: [],
  } as RepairOrderDetail;
}

function fakeApi(overrides: Record<string, unknown> = {}) {
  return {
    createQuote: vi.fn(),
    replaceDraftQuote: vi.fn(),
    sendQuote: vi.fn(),
    ...overrides,
  } as unknown as RepairOrderWorkspaceApi;
}

function setup(
  options: {
    api?: RepairOrderWorkspaceApi;
    membership?: Membership;
    order?: RepairOrderDetail;
    onReload?: () => Promise<void>;
  } = {},
) {
  const api = options.api ?? fakeApi();
  const onReload = options.onReload ?? vi.fn().mockResolvedValue(undefined);
  render(
    <QuotePanel
      api={api}
      membership={options.membership ?? membership}
      onReload={onReload}
      order={options.order ?? detail()}
      shopId={shopId}
    />,
  );
  return { api, onReload };
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("QuotePanel", () => {
  it("shows immutable history without mutation controls to a technician", () => {
    const sent = quote({
      status: "SENT",
      sentAt: "2026-09-23T01:00:00.000Z",
      updatedAt: "2026-09-23T01:00:00.000Z",
    });
    setup({
      membership: { ...membership, role: "TECHNICIAN" },
      order: detail([sent]),
    });

    expect(screen.getByRole("heading", { name: "1 phiên bản báo giá" })).toBeTruthy();
    expect(screen.getByText("Đã gửi")).toBeTruthy();
    expect(screen.getByText(/đã được khóa và không thể chỉnh sửa/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /bản nháp/i })).toBeNull();
    expect(screen.queryByRole("button", { name: "Xem lại và gửi" })).toBeNull();
  });

  it("validates fields, creates a draft, and sends the normalized full payload", async () => {
    const created = quote();
    const createQuote = vi.fn().mockResolvedValue(created);
    const { api, onReload } = setup({ api: fakeApi({ createQuote }) });
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Tạo bản nháp" }));
    expect(screen.getByText("Vui lòng nhập mô tả hạng mục.")).toBeTruthy();
    expect(createQuote).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText(/^Mô tả/), "  Kiểm tra và sửa nguồn  ");
    const price = screen.getByLabelText("Đơn giá (VND)");
    await user.clear(price);
    await user.type(price, "100000");
    const discount = screen.getByLabelText("Giảm giá (VND)");
    await user.clear(discount);
    await user.type(discount, "150000");
    await user.click(screen.getByRole("button", { name: "Tạo bản nháp" }));
    expect(screen.getByText("Giảm giá không được lớn hơn tạm tính.")).toBeTruthy();
    expect(createQuote).not.toHaveBeenCalled();

    await user.clear(discount);
    await user.type(discount, "10000");
    await user.click(screen.getByRole("button", { name: "Tạo bản nháp" }));

    await waitFor(() => expect(createQuote).toHaveBeenCalledOnce());
    expect(createQuote).toHaveBeenCalledWith(shopId, orderId, {
      diagnosisId: null,
      discount: 10_000,
      customerNote: null,
      expiresAt: null,
      items: [
        {
          kind: "SERVICE",
          description: "Kiểm tra và sửa nguồn",
          displayNote: null,
          carriedFromQuoteItemId: null,
          quantity: 1,
          quantityUnit: "EACH",
          unitPrice: 100_000,
          isOptional: false,
          approvalGroup: null,
        },
      ],
    });
    expect(onReload).toHaveBeenCalledOnce();
    expect(api.replaceDraftQuote).not.toHaveBeenCalled();
  });

  it("edits only the highest draft and preserves immutable versions", async () => {
    const older = quote({ versionNo: 1 });
    const newest = quote({
      id: quoteTwoId,
      versionNo: 2,
      items: [
        {
          ...quote().items[0]!,
          id: "99999999-9999-4999-8999-999999999999",
          description: "Bản nháp mới nhất",
        },
      ],
    });
    const updated = {
      ...newest,
      customerNote: "Nội dung đã sửa",
      updatedAt: "2026-09-23T02:00:00.000Z",
    };
    const replaceDraftQuote = vi.fn().mockResolvedValue(updated);
    const createQuote = vi.fn();
    setup({
      api: fakeApi({ createQuote, replaceDraftQuote }),
      order: detail([older, newest]),
    });
    const user = userEvent.setup();

    expect((screen.getByLabelText("Mô tả") as HTMLInputElement).value).toBe("Bản nháp mới nhất");
    await user.type(screen.getByLabelText("Ghi chú gửi khách"), "Nội dung đã sửa");
    await user.click(screen.getByRole("button", { name: "Lưu bản nháp" }));

    await waitFor(() => expect(replaceDraftQuote).toHaveBeenCalledOnce());
    expect(replaceDraftQuote.mock.calls[0]![1]).toBe(quoteTwoId);
    expect(createQuote).not.toHaveBeenCalled();
    expect(screen.getByText("Báo giá #1")).toBeTruthy();
    expect(screen.getByText("Báo giá #2")).toBeTruthy();
  });

  it("requires review when server totals differ, then copies the link without rendering it", async () => {
    const rawToken = "super-secret-public-token-that-must-not-render";
    const authoritative = quote({
      items: [{ ...quote().items[0]!, lineTotal: 100_001 }],
      subtotal: 100_001,
      total: 100_001,
      updatedAt: "2026-09-23T02:00:00.000Z",
    });
    const sent = {
      ...authoritative,
      status: "SENT" as const,
      sentAt: "2026-09-23T02:05:00.000Z",
      updatedAt: "2026-09-23T02:05:00.000Z",
    };
    const createQuote = vi.fn().mockResolvedValue(authoritative);
    const sendQuote = vi.fn().mockResolvedValue({
      quote: sent,
      publicUrl: `http://localhost:3000/p/${rawToken}`,
    });
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    setup({ api: fakeApi({ createQuote, sendQuote }) });

    await user.type(screen.getByLabelText("Mô tả"), "Kiểm tra và sửa nguồn");
    const price = screen.getByLabelText("Đơn giá (VND)");
    await user.clear(price);
    await user.type(price, "100000");
    await user.click(screen.getByRole("button", { name: "Tạo bản nháp" }));

    expect(await screen.findByText(/Máy chủ đã điều chỉnh tổng tiền/)).toBeTruthy();
    expect(
      within(screen.getByRole("complementary", { name: "Tổng tiền xem trước" })).getAllByText(
        /100.001/,
      ).length,
    ).toBeGreaterThan(0);
    const openConfirmation = screen.getByRole("button", { name: "Xem lại và gửi" });
    expect((openConfirmation as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole("button", { name: "Tôi đã kiểm tra tổng tiền" }));
    expect((openConfirmation as HTMLButtonElement).disabled).toBe(false);
    await user.click(openConfirmation);

    expect(screen.getByRole("dialog", { name: "Gửi báo giá #1" })).toBeTruthy();
    expect(screen.getByText("Sao chép liên kết")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Xác nhận gửi và khóa" }));

    expect(
      await screen.findByRole("heading", { name: "Liên kết khách hàng đã sẵn sàng" }),
    ).toBeTruthy();
    expect(document.body.textContent).not.toContain(rawToken);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    await user.click(screen.getByRole("button", { name: "Sao chép liên kết khách hàng" }));
    expect(writeText).toHaveBeenCalledWith(`http://localhost:3000/p/${rawToken}`);
    expect(document.body.textContent).not.toContain(rawToken);
    expect(screen.queryByRole("button", { name: "Xem lại và gửi" })).toBeNull();
  });

  it("keeps one idempotency key for retry and prevents concurrent double submit", async () => {
    const draft = quote();
    let resolveSecond: ((value: { quote: Quote; publicUrl: string }) => void) | undefined;
    const secondAttempt = new Promise<{ quote: Quote; publicUrl: string }>((resolve) => {
      resolveSecond = resolve;
    });
    const sendQuote = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockReturnValueOnce(secondAttempt);
    setup({ api: fakeApi({ sendQuote }), order: detail([draft]) });
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Xem lại và gửi" }));
    await user.click(screen.getByRole("button", { name: "Xác nhận gửi và khóa" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    const confirm = screen.getByRole("button", { name: "Xác nhận gửi và khóa" });
    await user.click(confirm);
    await user.click(confirm);
    expect(sendQuote).toHaveBeenCalledTimes(2);
    expect(sendQuote.mock.calls[0]![3]).toBe(sendQuote.mock.calls[1]![3]);

    resolveSecond?.({
      quote: {
        ...draft,
        status: "SENT",
        sentAt: "2026-09-23T02:00:00.000Z",
        updatedAt: "2026-09-23T02:00:00.000Z",
      },
      publicUrl: "http://localhost:3000/p/hidden-token",
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("clears a prepared send key when confirmation is cancelled", async () => {
    const draft = quote();
    const sendQuote = vi.fn().mockResolvedValue({
      quote: { ...draft, status: "SENT", sentAt: draft.updatedAt },
      publicUrl: "http://localhost:3000/p/hidden-token",
    });
    setup({ api: fakeApi({ sendQuote }), order: detail([draft]) });
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Xem lại và gửi" }));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Xem lại và gửi" }));
    await user.click(screen.getByRole("button", { name: "Quay lại" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Xem lại và gửi" })),
    );
  });

  it("offers a prepared draft as send-only while awaiting approval", async () => {
    setup({ order: detail([quote()], "AWAITING_APPROVAL") });

    expect(screen.queryByRole("button", { name: "Lưu bản nháp" })).toBeNull();
    expect(screen.getByRole("button", { name: "Xem lại và gửi" })).toBeTruthy();
    expect(screen.getByText(/bản nháp không thể sửa/)).toBeTruthy();
  });

  it("carries replacement lineage only after an explicit approved-item selection", async () => {
    const accepted = quote({ status: "ACCEPTED" });
    const order = detail([accepted], "REPAIRING");
    order.approvedScope = {
      quoteVersionId: accepted.id,
      decision: "ACCEPTED",
      approvedTotal: accepted.total,
      decidedAt: "2026-09-23T01:00:00.000Z",
      items: approvedItemsFrom(accepted),
    };
    const createQuote = vi
      .fn()
      .mockImplementation(
        (
          _shop: string,
          _order: string,
          input: Parameters<RepairOrderWorkspaceApi["createQuote"]>[2],
        ) =>
          Promise.resolve(
            quote({
              id: quoteTwoId,
              versionNo: 2,
              items: input.items.map((item, index) => ({
                id:
                  index === 0
                    ? "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
                    : "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                scopeKey:
                  index === 0
                    ? accepted.items[0]!.scopeKey
                    : "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
                carriedFromQuoteItemId: item.carriedFromQuoteItemId ?? null,
                displayNote: item.displayNote ?? null,
                ...item,
                lineTotal: Math.round(item.quantity * item.unitPrice),
                approvalGroup: item.approvalGroup ?? null,
              })),
            }),
          ),
      );
    setup({ api: fakeApi({ createQuote }), order });
    const user = userEvent.setup();

    await user.selectOptions(screen.getByLabelText(/^Lineage phạm vi/), accepted.items[0]!.id);
    await user.click(screen.getByRole("button", { name: "Thêm hạng mục" }));
    const descriptions = screen.getAllByLabelText("Mô tả");
    await user.type(descriptions[1]!, "Hạng mục mới hoàn toàn");
    const prices = screen.getAllByLabelText("Đơn giá (VND)");
    await user.clear(prices[0]!);
    await user.type(prices[0]!, "120000");
    await user.clear(prices[1]!);
    await user.type(prices[1]!, "50000");
    await user.click(screen.getByRole("button", { name: "Tạo bản nháp" }));

    await waitFor(() => expect(createQuote).toHaveBeenCalledOnce());
    const submitted = createQuote.mock.calls[0]![2];
    expect(submitted.items[0]).toMatchObject({
      carriedFromQuoteItemId: accepted.items[0]!.id,
      description: accepted.items[0]!.description,
      quantityUnit: accepted.items[0]!.quantityUnit,
    });
    expect(submitted.items[1]!.carriedFromQuoteItemId).toBeNull();
  });

  it("blocks duplicated carried lineage instead of matching items by editable text or price", async () => {
    const accepted = quote({ status: "ACCEPTED" });
    const order = detail([accepted], "REPAIRING");
    order.approvedScope = {
      quoteVersionId: accepted.id,
      decision: "ACCEPTED",
      approvedTotal: accepted.total,
      decidedAt: "2026-09-23T01:00:00.000Z",
      items: approvedItemsFrom(accepted),
    };
    const createQuote = vi.fn();
    setup({ api: fakeApi({ createQuote }), order });
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText(/^Lineage phạm vi/), accepted.items[0]!.id);
    await user.click(screen.getByRole("button", { name: "Thêm hạng mục" }));
    await user.selectOptions(
      screen.getAllByLabelText(/^Lineage phạm vi/)[1]!,
      accepted.items[0]!.id,
    );
    await user.click(screen.getByRole("button", { name: "Tạo bản nháp" }));
    expect(screen.getByText("Một hạng mục nguồn chỉ được mang sang một lần.")).toBeTruthy();
    expect(createQuote).not.toHaveBeenCalled();
  });

  it("keeps the staff quote editor labelled and usable at 360px", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 360 });
    const user = userEvent.setup();
    setup();

    expect(screen.getByRole("group", { name: "Hạng mục báo giá" })).toBeTruthy();
    expect(screen.getByLabelText("Mô tả")).toBeTruthy();
    expect(screen.getByLabelText("Số lượng")).toBeTruthy();
    expect(screen.getByLabelText("Đơn giá (VND)")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Thêm hạng mục" }));
    expect(screen.getByRole("button", { name: "Đưa hạng mục 2 lên" })).toBeTruthy();
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
      document.documentElement.clientWidth,
    );
  });
});
