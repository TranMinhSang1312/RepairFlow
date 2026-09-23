// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RepairFlowApiError } from "./errors";
import { BrowserPublicPortalApi } from "./public-api";

afterEach(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("BrowserPublicPortalApi", () => {
  it("reads an order through the fixed same-origin URL without credentials or persistence", async () => {
    const rawToken = "raw-public-token-that-must-not-appear-in-the-url";
    const order = {
      shopName: "RepairFlow Demo",
      shopContact: null,
      orderCode: "RFD-2609-00001",
      deviceLabel: "Samsung S25",
      status: "AWAITING_APPROVAL",
      completionOutcome: null,
      timeline: [],
      quote: null,
    };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ data: order }));
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const api = new BrowserPublicPortalApi(fetcher);

    await expect(api.getOrder(rawToken)).resolves.toEqual(order);

    const [url, init] = fetcher.mock.calls[0]!;
    const headers = new Headers(init?.headers);
    expect(String(url)).toBe("/api/public");
    expect(String(url)).not.toContain(rawToken);
    expect(init?.method).toBe("GET");
    expect(init?.credentials).toBe("omit");
    expect(init?.cache).toBe("no-store");
    expect(init?.referrerPolicy).toBe("no-referrer");
    expect(headers.get("x-repairflow-public-token")).toBe(rawToken);
    expect(headers.get("authorization")).toBeNull();
    expect(headers.get("x-shop-id")).toBeNull();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect(consoleLog).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("submits a decision with JSON and the caller-owned idempotency key", async () => {
    const result = {
      quoteVersionId: "22222222-2222-4222-8222-222222222222",
      decision: "PARTIALLY_ACCEPTED",
      approvedTotal: 150_000,
      decidedAt: "2026-09-23T01:00:00.000Z",
    };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ data: result }));
    const api = new BrowserPublicPortalApi(fetcher);
    const input = {
      decision: "PARTIALLY_ACCEPTED" as const,
      approvedItemIds: ["33333333-3333-4333-8333-333333333333"],
      customerNote: "Đồng ý phần này",
    };

    await expect(
      api.decideQuote("decision-token", input, "11111111-1111-4111-8111-111111111111"),
    ).resolves.toEqual(result);

    const [url, init] = fetcher.mock.calls[0]!;
    const headers = new Headers(init?.headers);
    expect(String(url)).toBe("/api/public");
    expect(init?.method).toBe("POST");
    expect(init?.credentials).toBe("omit");
    expect(init?.referrerPolicy).toBe("no-referrer");
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("idempotency-key")).toBe("11111111-1111-4111-8111-111111111111");
    expect(headers.get("x-repairflow-public-token")).toBe("decision-token");
    expect(JSON.parse(String(init?.body))).toEqual(input);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it("turns a public error envelope into RepairFlowApiError", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: "PUBLIC_QUOTE_UNAVAILABLE",
            message: "Báo giá không còn khả dụng.",
            requestId: "request-1",
          },
        },
        410,
      ),
    );
    const api = new BrowserPublicPortalApi(fetcher);

    const request = api.getOrder("unavailable-token");

    await expect(request).rejects.toBeInstanceOf(RepairFlowApiError);
    await expect(request).rejects.toMatchObject({
      status: 410,
      code: "PUBLIC_QUOTE_UNAVAILABLE",
      requestId: "request-1",
    });
  });
});
