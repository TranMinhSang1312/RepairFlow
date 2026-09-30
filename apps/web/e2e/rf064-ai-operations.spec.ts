import { expect, test, type Page, type Route } from "@playwright/test";

const shopId = "11111111-1111-4111-8111-111111111111";
const branchId = "22222222-2222-4222-8222-222222222222";
const ownerId = "33333333-3333-4333-8333-333333333333";
const technicianId = "44444444-4444-4444-8444-444444444444";
const orderId = "55555555-5555-4555-8555-555555555555";
const templateId = "66666666-6666-4666-8666-666666666666";
const itemOne = "77777777-7777-4777-8777-777777777777";
const itemTwo = "88888888-8888-4888-8888-888888888888";
const runId = "99999999-9999-4999-8999-999999999999";
const crossTenantCanary = "SHOP-B-CUSTOMER-MUST-NOT-RENDER";

const membership = {
  shopId,
  shopName: "RepairFlow AI E2E",
  role: "OWNER",
  status: "ACTIVE",
  timezone: "Asia/Ho_Chi_Minh",
  intakePhotoMinimum: 1,
  branches: [{ id: branchId, name: "Chi nhánh chính" }],
};
const user = {
  id: ownerId,
  email: "owner-ai@example.test",
  displayName: "Owner AI E2E",
  memberships: [membership],
};
const template = {
  id: templateId,
  name: "Kiểm tra bàn giao",
  versionNo: 1,
  isActive: true,
  createdAt: "2026-09-29T00:00:00.000Z",
  items: [
    {
      id: itemOne,
      label: "Thiết bị khởi động ổn định",
      isRequired: true,
      allowNa: false,
      sortOrder: 1,
    },
    {
      id: itemTwo,
      label: "Kiểm tra camera phụ",
      isRequired: false,
      allowNa: true,
      sortOrder: 2,
    },
  ],
};
const aiOutput = {
  suggestedItemIds: [itemOne],
  reasoningSummary: "Nên chú ý nguồn theo triệu chứng đã ghi nhận.",
  safetyWarnings: ["Nhân viên vẫn phải thực hiện đầy đủ quy trình của cửa hàng."],
};
const capabilities = ["CUSTOMER_SUMMARY", "DEVICE_OCR", "INTAKE_DRAFT", "CHECKLIST_SUGGESTION"];

function detail() {
  return {
    id: orderId,
    code: "RF-AI-2609-0001",
    serviceType: "STANDARD",
    sourceOrderId: null,
    status: "QUALITY_CHECK",
    completionOutcome: null,
    priority: "NORMAL",
    branchId,
    reportedProblem: "Máy tự tắt nguồn",
    intakeCondition: "Xước nhẹ",
    assignedTechnicianUserId: technicianId,
    customer: {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      name: "Khách AI E2E",
      phone: "0901000000",
      email: null,
      notes: null,
      createdAt: "2026-09-29T00:00:00.000Z",
    },
    device: {
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      customerId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      type: "PHONE",
      brand: "RepairFlow",
      model: "AI Test",
      color: null,
      serialMasked: null,
      imeiMasked: null,
    },
    promisedAt: null,
    receivedAt: "2026-09-29T00:00:00.000Z",
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
    paymentSummary: { approvedTotal: 0, paidTotal: 0, amountDue: 0 },
    payments: [],
    handover: null,
    warranty: null,
    sourceOrder: null,
    followUpOrders: [],
    timeline: [],
  };
}

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function installOwnerApi(page: Page) {
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/v1/auth/refresh") {
      return json(route, { data: { accessToken: "memory-only", expiresInSeconds: 900, user } });
    }
    if (path === "/api/v1/settings/ai" && request.method() === "GET") {
      return json(route, {
        data: {
          globalEnabled: true,
          capabilities: capabilities.map((capability) => ({
            capability,
            enabled: capability === "CHECKLIST_SUGGESTION",
            effectiveEnabled: capability === "CHECKLIST_SUGGESTION",
            monthlyBudgetMicrousd: "100000",
            maxRunCostMicrousd: "10000",
            lockVersion: 1,
            updatedAt: "2026-09-29T00:00:00.000Z",
            currentPeriodReservedMicrousd: "2000",
            currentPeriodSpentMicrousd: "500",
          })),
        },
      });
    }
    if (path.startsWith("/api/v1/settings/ai/") && request.method() === "PATCH") {
      expect(request.postData() ?? "").not.toMatch(/api.?key|secret|token/iu);
      return json(route, {
        data: {
          globalEnabled: true,
          capabilities: capabilities.map((capability) => ({
            capability,
            enabled: true,
            effectiveEnabled: true,
            monthlyBudgetMicrousd: "100000",
            maxRunCostMicrousd: "10000",
            lockVersion: 2,
            updatedAt: "2026-09-29T00:00:00.000Z",
            currentPeriodReservedMicrousd: "2000",
            currentPeriodSpentMicrousd: "500",
          })),
        },
      });
    }
    if (path === "/api/v1/settings/ai/analytics") {
      return json(route, {
        data: [
          {
            date: "2026-09-29",
            capability: "CHECKLIST_SUGGESTION",
            requestedCount: 2,
            succeededCount: 1,
            failedCount: 1,
            reviewedCount: 1,
            acceptedUnchangedCount: 1,
            acceptedEditedCount: 0,
            rejectedCount: 0,
            p50LatencyMs: 120,
            p95LatencyMs: 180,
            inputTokens: 40,
            outputTokens: 15,
            estimatedCostMicrousd: "50",
            averageEditDistancePermille: 0,
            averageTimeSavedSeconds: 30,
          },
        ],
        meta: { nextCursor: null },
      });
    }
    if (path === `/api/v1/repair-orders/${orderId}` && request.method() === "GET") {
      return json(route, { data: detail() });
    }
    if (path === "/api/v1/technicians") return json(route, { data: [] });
    if (path === "/api/v1/qc-templates") return json(route, { data: [template] });
    if (path === "/api/v1/ai/capabilities") {
      return json(route, {
        data: capabilities.map((capability) => ({
          capability,
          effectiveEnabled: capability === "CHECKLIST_SUGGESTION",
        })),
      });
    }
    if (path === "/api/v1/ai/checklist-suggestions" && request.method() === "POST") {
      expect(JSON.parse(request.postData() ?? "{}")).toEqual({
        repairOrderId: orderId,
        qcTemplateId: templateId,
        phase: "QC",
      });
      return json(
        route,
        {
          data: {
            id: runId,
            capability: "CHECKLIST_SUGGESTION",
            status: "QUEUED",
            promptVersion: "checklist-suggestion-v1",
            schemaVersion: "1",
            output: null,
            confidence: null,
            errorCode: null,
            review: null,
            createdAt: "2026-09-29T00:00:00.000Z",
            startedAt: null,
            completedAt: null,
          },
        },
        202,
      );
    }
    if (path === `/api/v1/ai/runs/${runId}` && request.method() === "GET") {
      return json(route, {
        data: {
          id: runId,
          capability: "CHECKLIST_SUGGESTION",
          status: "SUCCEEDED",
          promptVersion: "checklist-suggestion-v1",
          schemaVersion: "1",
          output: aiOutput,
          confidence: null,
          errorCode: null,
          review: null,
          createdAt: "2026-09-29T00:00:00.000Z",
          startedAt: "2026-09-29T00:00:00.100Z",
          completedAt: "2026-09-29T00:00:00.200Z",
        },
      });
    }
    if (path === `/api/v1/ai/runs/${runId}/review` && request.method() === "POST") {
      const review = JSON.parse(request.postData() ?? "{}");
      expect(review.reviewedOutput.suggestedItemIds).toEqual([itemOne]);
      expect(JSON.stringify(review)).not.toMatch(/PASS|FAIL/iu);
      return json(route, { data: { id: runId, status: "SUCCEEDED", output: aiOutput } });
    }
    if (path === `/api/v1/repair-orders/${orderId}/qc-runs` && request.method() === "POST") {
      const submitted = JSON.parse(request.postData() ?? "{}");
      expect(submitted.results).toEqual([
        {
          qcTemplateItemId: itemOne,
          result: "PASS",
          note: null,
          evidenceMediaAssetIds: [],
        },
        {
          qcTemplateItemId: itemTwo,
          result: "NOT_APPLICABLE",
          note: null,
          evidenceMediaAssetIds: [],
        },
      ]);
      return json(route, {
        data: {
          run: {
            id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            repairOrderId: orderId,
            qcTemplateId: templateId,
            templateName: template.name,
            templateVersionNo: 1,
            runNo: 1,
            result: "PASS",
            notes: null,
            checkedByUserId: ownerId,
            createdAt: "2026-09-29T00:00:01.000Z",
            results: submitted.results.map((result: Record<string, unknown>, index: number) => ({
              id: `dddddddd-dddd-4ddd-8ddd-ddddddddddd${index}`,
              labelSnapshot: template.items[index]!.label,
              ...result,
            })),
          },
          orderStatus: "QUALITY_CHECK",
          orderLockVersion: 8,
        },
      });
    }
    return json(
      route,
      { error: { code: "UNEXPECTED_E2E_ROUTE", message: path, requestId: "rf064-e2e" } },
      500,
    );
  });
}

test("owner configures AI, reads safe analytics and applies checklist highlights before manual QC", async ({
  page,
}) => {
  await installOwnerApi(page);
  await page.goto(`/settings/ai?shopId=${shopId}`);
  await expect(page.getByRole("heading", { name: "Trợ lý AI" })).toBeVisible();
  for (const name of [
    "Tóm tắt kỹ thuật cho khách",
    "Đọc thông tin thiết bị từ ảnh",
    "Tạo nháp tiếp nhận",
    "Gợi ý checklist",
  ]) {
    await expect(page.getByRole("heading", { name })).toBeVisible();
  }
  await expect(page.getByText("2026-09-29")).toBeVisible();
  await expect(page.locator("body")).not.toContainText(crossTenantCanary);
  await page.getByLabel("Từ ngày").fill("2026-09-01");
  await page.getByLabel("Đến ngày").fill("2026-09-29");
  await page.locator(".ai-analytics-filters select").selectOption("CHECKLIST_SUGGESTION");
  await page.getByRole("button", { name: "Áp dụng bộ lọc" }).click();
  await expect(page).toHaveURL(/from=2026-09-01.*to=2026-09-29.*capability=CHECKLIST_SUGGESTION/u);

  await page.goto(`/orders/${orderId}?shopId=${shopId}&tab=qc`);
  await page.getByRole("button", { name: "Tạo gợi ý" }).click();
  await expect(page.getByText(aiOutput.reasoningSummary)).toBeVisible();
  await page.getByRole("button", { name: "Áp dụng đánh dấu" }).click();
  await expect(page.getByText("AI gợi ý kiểm tra")).toBeVisible();
  await page.getByLabel("Đạt").first().check();
  await page.getByLabel("Không áp dụng").check();
  await page.getByRole("button", { name: "Xem lại checklist" }).click();
  await page.getByRole("button", { name: "Gửi QC bất biến" }).click();
  await expect(page.getByText(/Máy chủ ghi nhận QC lần 1 đạt/)).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    )
    .toBe(true);
});

test("non-owner direct AI settings URL is denied without loading owner data", async ({ page }) => {
  let settingsRequested = false;
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/v1/auth/refresh") {
      return json(route, {
        data: {
          accessToken: "memory-only",
          expiresInSeconds: 900,
          user: {
            ...user,
            memberships: [{ ...membership, role: "RECEPTIONIST" }],
          },
        },
      });
    }
    settingsRequested = true;
    return json(
      route,
      { error: { code: "FORBIDDEN", message: "Forbidden", requestId: "e2e" } },
      403,
    );
  });
  await page.goto(`/settings/ai?shopId=${shopId}`);
  await expect(page.getByText("Chỉ chủ cửa hàng được truy cập khu vực này.")).toBeVisible();
  expect(settingsRequested).toBe(false);
  await expect(page.getByRole("link", { name: "AI", exact: true })).toHaveCount(0);
});
