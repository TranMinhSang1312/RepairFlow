// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RepairFlowApiError } from "@/lib/api/errors";
import { BrowserPublicPortalApi, type PublicPortalApi } from "@/lib/api/public-api";
import type { PublicOrder, PublicQuote, QuoteDecisionResult } from "@/lib/api/types";

import { PublicQuotePortal, PublicQuotePortalScreen } from "./public-quote-portal";

const route = vi.hoisted(() => ({ token: "route-only-secret-token" }));

vi.mock("next/navigation", () => ({ useParams: () => ({ token: route.token }) }));

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

const token = "public-token-that-must-not-render";

const sentQuote: PublicQuote = {
  id: "11111111-1111-4111-8111-111111111111",
  versionNo: 2,
  status: "SENT",
  currency: "VND",
  items: [
    {
      id: "21111111-1111-4111-8111-111111111111",
      kind: "SERVICE",
      description: "Công sửa chữa",
      quantity: 1,
      unitPrice: 100_000,
      lineTotal: 100_000,
      isOptional: false,
      approvalGroup: null,
    },
    {
      id: "31111111-1111-4111-8111-111111111111",
      kind: "PART",
      description: "Camera trước",
      quantity: 1,
      unitPrice: 50_000,
      lineTotal: 50_000,
      isOptional: true,
      approvalGroup: "camera",
    },
    {
      id: "41111111-1111-4111-8111-111111111111",
      kind: "SERVICE",
      description: "Công thay camera",
      quantity: 1,
      unitPrice: 20_000,
      lineTotal: 20_000,
      isOptional: true,
      approvalGroup: "camera",
    },
    {
      id: "51111111-1111-4111-8111-111111111111",
      kind: "SERVICE",
      description: "Vệ sinh thiết bị",
      quantity: 1,
      unitPrice: 30_000,
      lineTotal: 30_000,
      isOptional: true,
      approvalGroup: null,
    },
  ],
  subtotal: 200_000,
  discount: 10_000,
  total: 190_000,
  customerNote: "Vui lòng xem kỹ các hạng mục tùy chọn.",
  expiresAt: "2026-10-01T08:00:00.000Z",
  sentAt: "2026-09-23T08:00:00.000Z",
  decidedAt: null,
};

const publicOrder: PublicOrder = {
  shopName: "RepairFlow Quận 1",
  shopContact: "090 123 4567",
  orderCode: "RFQ-2609-00042",
  deviceLabel: "Samsung Galaxy S25",
  status: "AWAITING_APPROVAL",
  completionOutcome: null,
  timeline: [
    {
      type: "QUOTE_SENT",
      message: "Cửa hàng đã gửi báo giá để xác nhận.",
      createdAt: "2026-09-23T08:00:00.000Z",
    },
  ],
  quote: sentQuote,
};

const acceptedResult: QuoteDecisionResult = {
  quoteVersionId: sentQuote.id,
  decision: "ACCEPTED",
  approvedTotal: sentQuote.total,
  decidedAt: "2026-09-23T09:00:00.000Z",
};

function fakeApi(overrides: Partial<PublicPortalApi> = {}): PublicPortalApi {
  return {
    getOrder: vi.fn().mockResolvedValue(publicOrder),
    decideQuote: vi.fn().mockResolvedValue(acceptedResult),
    ...overrides,
  };
}

async function openConfirmation(
  user: ReturnType<typeof userEvent.setup>,
  label: string | RegExp = /đồng ý toàn bộ/i,
) {
  await screen.findByRole("heading", { name: "RepairFlow Quận 1" });
  await user.click(screen.getByRole("button", { name: label }));
  await user.click(screen.getByRole("checkbox", { name: /Tôi đã kiểm tra/i }));
}

describe("PublicQuotePortalScreen", () => {
  it("renders only public-safe fields and never exposes or stores the route token", async () => {
    const getOrder = vi.fn().mockResolvedValue(publicOrder);
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(<PublicQuotePortalScreen api={fakeApi({ getOrder })} token={token} />);

    expect(await screen.findByRole("heading", { name: "RepairFlow Quận 1" })).toBeTruthy();
    expect(screen.getByText("RFQ-2609-00042")).toBeTruthy();
    expect(screen.getByText("Samsung Galaxy S25")).toBeTruthy();
    expect(screen.getByText("Cửa hàng đã gửi báo giá để xác nhận.")).toBeTruthy();
    expect(document.documentElement.innerHTML).not.toContain(token);
    expect(JSON.stringify(localStorage)).not.toContain(token);
    expect(JSON.stringify(sessionStorage)).not.toContain(token);
    expect(consoleLog).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
    expect(getOrder).toHaveBeenCalledWith(token);
  });

  it("reads the production token from client route params without rendering it", async () => {
    const getOrder = vi
      .spyOn(BrowserPublicPortalApi.prototype, "getOrder")
      .mockResolvedValue(publicOrder);
    render(<PublicQuotePortal />);

    expect(await screen.findByText("RFQ-2609-00042")).toBeTruthy();
    expect(getOrder).toHaveBeenCalledWith(route.token);
    expect(document.body.textContent).not.toContain(route.token);
  });

  it("clears customer input when navigating to a different public token", async () => {
    const getOrder = vi.fn().mockResolvedValue(publicOrder);
    const user = userEvent.setup();
    const { rerender } = render(
      <PublicQuotePortalScreen api={fakeApi({ getOrder })} token="first-public-token" />,
    );

    const note = await screen.findByLabelText(/Lời nhắn cho cửa hàng/i);
    await user.type(note, "Nội dung của liên kết thứ nhất");
    rerender(<PublicQuotePortalScreen api={fakeApi({ getOrder })} token="second-public-token" />);

    await waitFor(() => expect(getOrder).toHaveBeenCalledWith("second-public-token"));
    await waitFor(() =>
      expect((screen.getByLabelText(/Lời nhắn/i) as HTMLTextAreaElement).value).toBe(""),
    );
  });

  it("locks required scope, selects approval groups together, and submits a partial total", async () => {
    const decideQuote = vi.fn().mockResolvedValue({
      ...acceptedResult,
      decision: "PARTIALLY_ACCEPTED",
      approvedTotal: 120_000,
    });
    const user = userEvent.setup();
    render(<PublicQuotePortalScreen api={fakeApi({ decideQuote })} token={token} />);

    const required = await screen.findByRole("checkbox", { name: /Công sửa chữa/i });
    expect((required as HTMLInputElement).disabled).toBe(true);
    expect((required as HTMLInputElement).checked).toBe(true);

    const group = screen.getByRole("checkbox", { name: /Nhóm camera/i });
    expect((group as HTMLInputElement).checked).toBe(true);
    await user.click(group);
    expect(screen.getByRole("button", { name: /đồng ý một phần/i })).toBeTruthy();

    await openConfirmation(user, /đồng ý một phần/i);
    const review = screen
      .getByRole("heading", { name: "Kiểm tra phạm vi đồng ý" })
      .closest("section")!;
    expect(within(review).getByText(/120.000/)).toBeTruthy();
    expect(within(review).queryByText("Camera trước")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Xác nhận quyết định" }));

    await waitFor(() =>
      expect(decideQuote).toHaveBeenCalledWith(
        token,
        {
          decision: "PARTIALLY_ACCEPTED",
          approvedItemIds: ["51111111-1111-4111-8111-111111111111"],
          customerNote: null,
        },
        expect.any(String),
      ),
    );
    expect(await screen.findByText("Đã đồng ý một phần báo giá")).toBeTruthy();
  });

  it("submits accept-all once when the confirmation button is activated twice", async () => {
    let resolveDecision!: (value: QuoteDecisionResult) => void;
    const pending = new Promise<QuoteDecisionResult>((resolve) => {
      resolveDecision = resolve;
    });
    const decideQuote = vi.fn().mockReturnValue(pending);
    const user = userEvent.setup();
    render(<PublicQuotePortalScreen api={fakeApi({ decideQuote })} token={token} />);
    await openConfirmation(user);

    const submit = screen.getByRole("button", { name: "Xác nhận quyết định" });
    fireEvent.click(submit);
    fireEvent.click(submit);
    expect(decideQuote).toHaveBeenCalledTimes(1);
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    resolveDecision(acceptedResult);
    expect(await screen.findByText("Đã đồng ý toàn bộ báo giá")).toBeTruthy();
  });

  it("reuses one idempotency key and preserves the decision after a network retry", async () => {
    const decideQuote = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce(acceptedResult);
    const user = userEvent.setup();
    render(<PublicQuotePortalScreen api={fakeApi({ decideQuote })} token={token} />);
    await screen.findByRole("heading", { name: "RepairFlow Quận 1" });
    await user.type(screen.getByLabelText(/Lời nhắn cho cửa hàng/i), "Xin gọi trước khi sửa");
    await openConfirmation(user);

    await user.click(screen.getByRole("button", { name: "Xác nhận quyết định" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Dữ liệu của bạn vẫn được giữ lại",
    );
    await user.click(screen.getByRole("button", { name: "Xác nhận quyết định" }));

    await screen.findByText("Đã đồng ý toàn bộ báo giá");
    expect(decideQuote).toHaveBeenCalledTimes(2);
    expect(decideQuote.mock.calls[0]?.[2]).toBe(decideQuote.mock.calls[1]?.[2]);
    expect(decideQuote.mock.calls[1]?.[1]).toMatchObject({
      decision: "ACCEPTED",
      customerNote: "Xin gọi trước khi sửa",
    });
  });

  it("records a decline with no approved item IDs", async () => {
    const decideQuote = vi.fn().mockResolvedValue({
      ...acceptedResult,
      decision: "DECLINED",
      approvedTotal: 0,
    });
    const user = userEvent.setup();
    render(<PublicQuotePortalScreen api={fakeApi({ decideQuote })} token={token} />);
    await openConfirmation(user, "Từ chối báo giá");
    await user.click(screen.getByRole("button", { name: "Xác nhận quyết định" }));

    await screen.findByText("Đã từ chối báo giá");
    expect(decideQuote).toHaveBeenCalledWith(
      token,
      { decision: "DECLINED", approvedItemIds: [], customerNote: null },
      expect.any(String),
    );
  });

  it.each([
    ["ACCEPTED", "Đã đồng ý toàn bộ báo giá"],
    ["PARTIALLY_ACCEPTED", "Đã đồng ý một phần báo giá"],
    ["DECLINED", "Đã từ chối báo giá"],
  ] as const)("renders terminal %s quotes as read-only", async (status, label) => {
    const decidedOrder: PublicOrder = {
      ...publicOrder,
      quote: { ...sentQuote, status, decidedAt: "2026-09-23T09:00:00.000Z" },
    };
    render(
      <PublicQuotePortalScreen
        api={fakeApi({ getOrder: vi.fn().mockResolvedValue(decidedOrder) })}
        token={token}
      />,
    );

    expect(await screen.findByText(label)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Tiếp tục đồng ý/i })).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.getByText("Tổng báo giá ban đầu")).toBeTruthy();
    if (status === "PARTIALLY_ACCEPTED") {
      expect(screen.getByText(/chỉ hiển thị trạng thái sau khi tải lại/)).toBeTruthy();
    }
  });

  it("keeps a terminal quote read-only when its decision timestamp is unavailable", async () => {
    const decidedOrder: PublicOrder = {
      ...publicOrder,
      quote: { ...sentQuote, status: "DECLINED", decidedAt: null },
    };
    render(
      <PublicQuotePortalScreen
        api={fakeApi({ getOrder: vi.fn().mockResolvedValue(decidedOrder) })}
        token={token}
      />,
    );

    expect(await screen.findByText("Đã từ chối báo giá")).toBeTruthy();
    expect(screen.getByText("Thời gian ghi nhận chưa được cung cấp.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /đồng ý|từ chối/i })).toBeNull();
  });

  it("renders a tracking-only token without decision controls", async () => {
    render(
      <PublicQuotePortalScreen
        api={fakeApi({ getOrder: vi.fn().mockResolvedValue({ ...publicOrder, quote: null }) })}
        token={token}
      />,
    );

    expect(await screen.findByText("Chưa có báo giá cần xác nhận")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /đồng ý/i })).toBeNull();
    expect(screen.getByText("Cửa hàng đã gửi báo giá để xác nhận.")).toBeTruthy();
  });

  it.each([
    [new RepairFlowApiError(404, "PUBLIC_LINK_INVALID", "unsafe"), "Liên kết không hợp lệ", false],
    [new RepairFlowApiError(410, "PUBLIC_LINK_EXPIRED", "unsafe"), "Liên kết đã hết hạn", false],
    [
      new RepairFlowApiError(410, "PUBLIC_QUOTE_UNAVAILABLE", "unsafe"),
      "Báo giá không còn hiệu lực",
      false,
    ],
    [new RepairFlowApiError(429, "RATE_LIMITED", "unsafe"), "Bạn thao tác quá nhanh", true],
    [new TypeError("secret upstream failure"), "Chưa thể tải thông tin", true],
  ] as const)("maps a public failure to the safe %s state", async (error, title, retryable) => {
    render(
      <PublicQuotePortalScreen
        api={fakeApi({ getOrder: vi.fn().mockRejectedValue(error) })}
        token={token}
      />,
    );

    expect(await screen.findByRole("heading", { name: title })).toBeTruthy();
    expect(document.body.textContent).not.toContain("unsafe");
    expect(document.body.textContent).not.toContain("secret upstream failure");
    expect(Boolean(screen.queryByRole("button", { name: "Thử lại" }))).toBe(retryable);
  });

  it("reloads a final decision when a concurrent submit reports already decided", async () => {
    const decidedOrder: PublicOrder = {
      ...publicOrder,
      quote: { ...sentQuote, status: "ACCEPTED", decidedAt: "2026-09-23T09:00:00.000Z" },
    };
    const getOrder = vi.fn().mockResolvedValueOnce(publicOrder).mockResolvedValueOnce(decidedOrder);
    const decideQuote = vi
      .fn()
      .mockRejectedValue(new RepairFlowApiError(409, "QUOTE_ALREADY_DECIDED", "unsafe"));
    const user = userEvent.setup();
    render(<PublicQuotePortalScreen api={fakeApi({ getOrder, decideQuote })} token={token} />);
    await openConfirmation(user);
    await user.click(screen.getByRole("button", { name: "Xác nhận quyết định" }));

    expect(await screen.findByText("Đã đồng ý toàn bộ báo giá")).toBeTruthy();
    expect(getOrder).toHaveBeenCalledTimes(2);
    expect(document.body.textContent).not.toContain("unsafe");
  });

  it("keeps the decision flow labelled and keyboard reachable at 360px", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 360 });
    const user = userEvent.setup();
    render(<PublicQuotePortalScreen api={fakeApi()} token={token} />);

    expect((await screen.findByRole("main")).classList.contains("public-portal-shell")).toBe(true);
    expect(screen.getByRole("group", { name: "Phạm vi báo giá" })).toBeTruthy();
    expect(screen.getByLabelText(/Lời nhắn cho cửa hàng/i)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /đồng ý toàn bộ/i }));
    const heading = screen.getByRole("heading", { name: "Kiểm tra phạm vi đồng ý" });
    expect(document.activeElement).toBe(heading);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
      document.documentElement.clientWidth,
    );
  });
});
