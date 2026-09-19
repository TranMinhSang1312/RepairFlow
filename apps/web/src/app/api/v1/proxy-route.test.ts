// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "./[...path]/route";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("same-origin API proxy", () => {
  it("forwards auth request headers and auth response headers", async () => {
    const upstreamFetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "RATE_LIMITED" } }), {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": "30",
          "Set-Cookie": "repairflow_refresh=rotated; HttpOnly; Path=/api/v1/auth",
        },
      }),
    );
    vi.stubGlobal("fetch", upstreamFetch);

    const response = await POST(
      new Request("http://localhost:3000/api/v1/auth/refresh", {
        method: "POST",
        headers: {
          Authorization: "Bearer memory-token",
          Cookie: "repairflow_refresh=opaque",
        },
      }),
      { params: Promise.resolve({ path: ["auth", "refresh"] }) },
    );

    const [url, init] = upstreamFetch.mock.calls[0]!;
    const headers = new Headers(init?.headers);
    expect(String(url)).toBe("http://localhost:3001/api/v1/auth/refresh");
    expect(headers.get("authorization")).toBe("Bearer memory-token");
    expect(headers.get("cookie")).toBe("repairflow_refresh=opaque");
    expect(response.headers.get("retry-after")).toBe("30");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
  });
});
