// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import type { RepairFlowApiError } from "./errors";
import { BrowserIntakeApi } from "./intake-api";
import type { CreateRepairOrderInput } from "./types";

const authBody = {
  data: {
    accessToken: "access-token-memory-only",
    expiresInSeconds: 900,
    user: {
      id: "11111111-1111-4111-8111-111111111111",
      email: "owner@example.com",
      displayName: "Owner",
      memberships: [
        {
          shopId: "22222222-2222-4222-8222-222222222222",
          shopName: "Repair Shop",
          role: "OWNER",
          status: "ACTIVE",
          timezone: "Asia/Ho_Chi_Minh",
          intakePhotoMinimum: 1,
          branches: [{ id: "33333333-3333-4333-8333-333333333333", name: "Main branch" }],
        },
      ],
    },
  },
};

const orderInput: CreateRepairOrderInput = {
  branchId: "33333333-3333-4333-8333-333333333333",
  customerId: "44444444-4444-4444-8444-444444444444",
  deviceId: "55555555-5555-4555-8555-555555555555",
  reportedProblem: "No power",
  intakeCondition: "Scratch on left corner",
  consentAcknowledged: true,
  priority: "NORMAL",
  promisedAt: null,
  accessories: [],
  mediaAssetIds: ["66666666-6666-4666-8666-666666666666"],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("BrowserIntakeApi", () => {
  it.each([
    ["default fetch", undefined],
    ["explicit browser fetch", "explicit"],
  ])("calls %s with the global context", async (_label, mode) => {
    const browserFetch = vi.fn(function (this: unknown) {
      if (this !== globalThis) throw new TypeError("Illegal invocation");
      return Promise.resolve(jsonResponse(authBody));
    });
    vi.stubGlobal("fetch", browserFetch);

    const api =
      mode === "explicit"
        ? new BrowserIntakeApi("/api/v1", globalThis.fetch)
        : new BrowserIntakeApi();
    await expect(
      api.login({ email: "owner@example.com", password: "very-secure-password" }),
    ).resolves.toEqual(authBody.data);
    expect(browserFetch).toHaveBeenCalledOnce();
  });

  it("registers and logs in without persisting credentials", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(authBody, 201));
    const api = new BrowserIntakeApi("/api/v1", fetcher);
    await api.registerOwner({
      email: "owner@example.com",
      password: "very-secure-password",
      displayName: "Owner",
      shopName: "Repair Shop",
      branchName: "Main branch",
    });
    const [url, init] = fetcher.mock.calls[0]!;
    expect(String(url)).toBe("/api/v1/auth/register-owner");
    expect(JSON.parse(String(init?.body))).not.toHaveProperty("confirmPassword");
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it("keeps the access token in memory and sends tenant plus idempotency headers", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(authBody))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            data: {
              id: "77777777-7777-4777-8777-777777777777",
              code: "RF-0001",
              status: "RECEIVED",
              priority: "NORMAL",
              branchId: orderInput.branchId,
              reportedProblem: orderInput.reportedProblem,
              intakeCondition: orderInput.intakeCondition,
              customer: {},
              device: {},
              promisedAt: null,
              receivedAt: "2026-09-19T00:00:00.000Z",
            },
          },
          201,
        ),
      );
    const api = new BrowserIntakeApi("/api/v1", fetcher);
    await api.restoreSession();
    await api.createRepairOrder(
      authBody.data.user.memberships[0]!.shopId,
      orderInput,
      "88888888-8888-4888-8888-888888888888",
    );

    const [, init] = fetcher.mock.calls[1]!;
    const headers = new Headers(init?.headers);
    expect(headers.get("Authorization")).toBe("Bearer access-token-memory-only");
    expect(headers.get("X-Shop-Id")).toBe(authBody.data.user.memberships[0]!.shopId);
    expect(headers.get("Idempotency-Key")).toBe("88888888-8888-4888-8888-888888888888");
    expect(JSON.parse(String(init?.body))).toEqual(orderInput);
    expect(localStorage.length).toBe(0);
  });

  it("surfaces upload failure without returning a media id", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(authBody))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            data: {
              mediaAssetId: "99999999-9999-4999-8999-999999999999",
              uploadUrl: "https://storage.test/upload",
              expiresAt: "2026-09-19T00:10:00.000Z",
            },
          },
          201,
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 503 }));
    const api = new BrowserIntakeApi("/api/v1", fetcher);
    await api.restoreSession();

    await expect(
      api.uploadIntakeMedia(
        authBody.data.user.memberships[0]!.shopId,
        new File(["image"], "phone.jpg", { type: "image/jpeg" }),
      ),
    ).rejects.toMatchObject<Partial<RepairFlowApiError>>({ code: "MEDIA_UPLOAD_FAILED" });
  });

  it("rotates one refresh session when concurrent requests receive 401", async () => {
    let refreshCalls = 0;
    let customerCalls = 0;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/auth/refresh")) {
        refreshCalls += 1;
        return jsonResponse({
          ...authBody,
          data: { ...authBody.data, accessToken: `access-token-${refreshCalls}` },
        });
      }
      if (url.includes("/customers")) {
        customerCalls += 1;
        if (customerCalls <= 2) {
          return jsonResponse(
            {
              error: {
                code: "AUTH_REQUIRED",
                message: "Authentication is required.",
                requestId: `request-${customerCalls}`,
              },
            },
            401,
          );
        }
        return jsonResponse({ data: [], meta: { nextCursor: null } });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    const api = new BrowserIntakeApi("/api/v1", fetcher);
    await api.restoreSession();

    await Promise.all([
      api.searchCustomers(authBody.data.user.memberships[0]!.shopId, "0901"),
      api.searchCustomers(authBody.data.user.memberships[0]!.shopId, "0902"),
    ]);

    expect(refreshCalls).toBe(2);
    expect(customerCalls).toBe(4);
  });

  it("moves the shared session to anonymous when refresh reuse is rejected", async () => {
    const expired = vi.fn();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(authBody))
      .mockResolvedValueOnce(
        jsonResponse(
          { error: { code: "AUTH_REQUIRED", message: "expired", requestId: "one" } },
          401,
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          { error: { code: "SESSION_EXPIRED", message: "reused", requestId: "two" } },
          401,
        ),
      );
    const api = new BrowserIntakeApi("/api/v1", fetcher, { onSessionExpired: expired });
    await api.restoreSession();
    await expect(api.searchCustomers("shop", "test")).rejects.toMatchObject({
      code: "SESSION_EXPIRED",
    });
    expect(expired).toHaveBeenCalledOnce();
  });

  it("sends bearer and cookie credentials on logout, then clears memory", async () => {
    const expired = vi.fn();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(authBody))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const api = new BrowserIntakeApi("/api/v1", fetcher, { onSessionExpired: expired });
    await api.restoreSession();
    await api.logout();
    const [, init] = fetcher.mock.calls[1]!;
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer access-token-memory-only");
    expect(init?.credentials).toBe("same-origin");
    expect(expired).toHaveBeenCalledOnce();
  });

  it("reloads /me without rotating the refresh session", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(authBody))
      .mockResolvedValueOnce(jsonResponse({ data: authBody.data.user }));
    const api = new BrowserIntakeApi("/api/v1", fetcher);
    await api.restoreSession();
    await expect(api.getMe()).resolves.toEqual(authBody.data.user);
    expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
      "/api/v1/auth/refresh",
      "/api/v1/me",
    ]);
  });

  it("serializes repeated board status filters and sends the active tenant", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(authBody))
      .mockResolvedValueOnce(jsonResponse({ data: [], meta: { nextCursor: null } }));
    const api = new BrowserIntakeApi("/api/v1", fetcher);
    await api.restoreSession();
    await api.listRepairOrders(
      authBody.data.user.memberships[0]!.shopId,
      {
        query: "RF-01",
        statuses: ["RECEIVED", "REPAIRING"],
        branchId: "33333333-3333-4333-8333-333333333333",
      },
      "next-page",
    );

    const [input, init] = fetcher.mock.calls[1]!;
    const url = new URL(String(input), "https://repairflow.test");
    expect(url.pathname).toBe("/api/v1/repair-orders");
    expect(url.searchParams.getAll("status")).toEqual(["RECEIVED", "REPAIRING"]);
    expect(url.searchParams.get("query")).toBe("RF-01");
    expect(url.searchParams.get("cursor")).toBe("next-page");
    expect(new Headers(init?.headers).get("X-Shop-Id")).toBe(
      authBody.data.user.memberships[0]!.shopId,
    );
  });

  it("maps assignment, transition and diagnosis workspace requests", async () => {
    const shopId = authBody.data.user.memberships[0]!.shopId;
    const orderId = "77777777-7777-4777-8777-777777777777";
    const technicianUserId = "88888888-8888-4888-8888-888888888888";
    const assignment = {
      id: "99999999-9999-4999-8999-999999999999",
      repairOrderId: orderId,
      technicianUserId,
      technicianDisplayName: "Technician",
      assignedByUserId: authBody.data.user.id,
      assignedAt: "2026-09-22T00:00:00.000Z",
      unassignedAt: null,
    };
    const diagnosis = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      repairOrderId: orderId,
      revisionNo: 1,
      finding: "Power fault",
      recommendation: "Replace IC",
      supersedesId: null,
      createdByUserId: authBody.data.user.id,
      createdAt: "2026-09-22T00:10:00.000Z",
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(authBody))
      .mockResolvedValueOnce(
        jsonResponse({ data: [{ userId: technicianUserId, displayName: "Technician" }] }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: assignment }, 201))
      .mockResolvedValueOnce(jsonResponse({ data: { id: orderId, status: "DIAGNOSING" } }))
      .mockResolvedValueOnce(jsonResponse({ data: diagnosis }, 201));
    const api = new BrowserIntakeApi("/api/v1", fetcher);
    await api.restoreSession();
    await api.listTechnicians(shopId);
    await api.assignTechnician(shopId, orderId, technicianUserId);
    await api.transitionRepairOrder(
      shopId,
      orderId,
      { targetStatus: "DIAGNOSING", expectedLockVersion: 0 },
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    );
    await api.createDiagnosis(shopId, orderId, {
      finding: diagnosis.finding,
      recommendation: diagnosis.recommendation,
      supersedesId: null,
    });

    expect(fetcher.mock.calls.slice(1).map(([url]) => String(url))).toEqual([
      "/api/v1/technicians",
      `/api/v1/repair-orders/${orderId}/assignments`,
      `/api/v1/repair-orders/${orderId}/transition`,
      `/api/v1/repair-orders/${orderId}/diagnoses`,
    ]);
    const transitionHeaders = new Headers(fetcher.mock.calls[3]![1]?.headers);
    expect(transitionHeaders.get("X-Shop-Id")).toBe(shopId);
    expect(transitionHeaders.get("Idempotency-Key")).toBe("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    expect(JSON.parse(String(fetcher.mock.calls[4]![1]?.body))).toEqual({
      finding: diagnosis.finding,
      recommendation: diagnosis.recommendation,
      supersedesId: null,
    });
  });
});
