// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { GET, POST } from "./route";

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

describe("public API bridge", () => {
  it("moves the token from the internal header to the encoded upstream order path", async () => {
    const upstreamFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ data: { orderCode: "RF-1" } }));
    vi.stubGlobal("fetch", upstreamFetch);

    const response = await GET(
      new Request("http://localhost:3000/api/public", {
        headers: {
          Accept: "application/json",
          Authorization: "Bearer must-not-leak",
          Cookie: "repairflow_refresh=must-not-leak",
          "User-Agent": "RepairFlow public browser",
          "X-Shop-Id": "must-not-leak",
          "X-RepairFlow-Public-Token": "raw/token+value",
          "X-Untrusted": "must-not-leak",
        },
      }),
    );

    const [url, init] = upstreamFetch.mock.calls[0]!;
    const headers = new Headers(init?.headers);
    expect(String(url)).toBe("http://localhost:3001/public/v1/orders/raw%2Ftoken%2Bvalue");
    expect(init?.method).toBe("GET");
    expect(init?.cache).toBe("no-store");
    expect(init?.redirect).toBe("manual");
    expect(headers.get("accept")).toBe("application/json");
    expect(headers.get("user-agent")).toBe("RepairFlow public browser");
    expect(headers.get("x-repairflow-public-token")).toBeNull();
    expect(headers.get("authorization")).toBeNull();
    expect(headers.get("cookie")).toBeNull();
    expect(headers.get("x-shop-id")).toBeNull();
    expect(headers.get("x-untrusted")).toBeNull();
    await expect(response.json()).resolves.toEqual({ data: { orderCode: "RF-1" } });
  });

  it("forwards a decision body and idempotency key without sensitive staff headers", async () => {
    const upstreamFetch = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ data: { decision: "DECLINED", approvedTotal: 0 } }, 200, {
        "Retry-After": "30",
        "Set-Cookie": "must-not-return=1",
      }),
    );
    vi.stubGlobal("fetch", upstreamFetch);
    const body = JSON.stringify({ decision: "DECLINED", approvedItemIds: [] });

    const response = await POST(
      new Request("http://localhost:3000/api/public", {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: "Bearer must-not-leak",
          Cookie: "repairflow_refresh=must-not-leak",
          "Content-Type": "application/json",
          "Idempotency-Key": "11111111-1111-4111-8111-111111111111",
          "X-Shop-Id": "must-not-leak",
          "X-RepairFlow-Public-Token": "decision-token",
        },
        body,
      }),
    );

    const [url, init] = upstreamFetch.mock.calls[0]!;
    const headers = new Headers(init?.headers);
    expect(String(url)).toBe("http://localhost:3001/public/v1/quotes/decision-token/decision");
    expect(init?.method).toBe("POST");
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("idempotency-key")).toBe("11111111-1111-4111-8111-111111111111");
    expect(headers.get("authorization")).toBeNull();
    expect(headers.get("cookie")).toBeNull();
    expect(headers.get("x-shop-id")).toBeNull();
    expect(new TextDecoder().decode(init?.body as ArrayBuffer)).toBe(body);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("retry-after")).toBe("30");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("no-store, private");
    expect(response.headers.get("vary")).toBe("X-RepairFlow-Public-Token");
  });

  it("preserves an upstream error status and envelope", async () => {
    const error = {
      error: {
        code: "PUBLIC_LINK_EXPIRED",
        message: "expired",
        requestId: "request-1",
      },
    };
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(error, 410)));

    const response = await GET(
      new Request("http://localhost:3000/api/public", {
        headers: { "X-RepairFlow-Public-Token": "expired-token" },
      }),
    );

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toEqual(error);
  });

  it("rejects a missing internal token without calling upstream", async () => {
    const upstreamFetch = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", upstreamFetch);

    const response = await GET(new Request("http://localhost:3000/api/public"));

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store, private");
    expect(upstreamFetch).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "PUBLIC_LINK_INVALID" },
    });
  });
});
