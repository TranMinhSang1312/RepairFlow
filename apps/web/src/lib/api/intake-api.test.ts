// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

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

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("BrowserIntakeApi", () => {
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
});
