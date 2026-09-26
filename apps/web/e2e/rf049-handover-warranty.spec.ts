import { expect, test, type Page, type Route } from "@playwright/test";

const shopId = "11111111-1111-4111-8111-111111111111";
const branchId = "22222222-2222-4222-8222-222222222222";
const orderId = "33333333-3333-4333-8333-333333333333";
const rawToken = "raw-track-token-must-stay-out-of-dom";

const membership = {
  shopId,
  shopName: "RepairFlow E2E",
  role: "RECEPTIONIST",
  status: "ACTIVE",
  timezone: "Asia/Ho_Chi_Minh",
  intakePhotoMinimum: 1,
  branches: [{ id: branchId, name: "Chi nhánh chính" }],
};

const user = {
  id: "44444444-4444-4444-8444-444444444444",
  email: "reception@example.test",
  displayName: "Lễ tân E2E",
  memberships: [membership],
};

function detail(status: "READY_FOR_PICKUP" | "COMPLETED") {
  const completed = status === "COMPLETED";
  return {
    id: orderId,
    code: "RFE-2609-00001",
    serviceType: "STANDARD",
    sourceOrderId: null,
    status,
    completionOutcome: "REPAIRED",
    priority: "NORMAL",
    branchId,
    reportedProblem: "Máy không lên nguồn",
    intakeCondition: "Xước nhẹ góc máy",
    assignedTechnicianUserId: null,
    customer: {
      id: "customer",
      name: "Khách E2E",
      phone: "0901000000",
      email: null,
      notes: null,
      createdAt: "2026-09-01T00:00:00.000Z",
    },
    device: {
      id: "device",
      customerId: "customer",
      type: "PHONE",
      brand: "Samsung",
      model: "S25",
      color: "Đen",
      serialMasked: "••1234",
      imeiMasked: null,
    },
    promisedAt: null,
    receivedAt: "2026-09-01T00:00:00.000Z",
    readyAt: "2026-09-25T08:00:00.000Z",
    returnedAt: completed ? "2026-09-26T08:00:00.000Z" : null,
    lockVersion: completed ? 9 : 8,
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
    paymentSummary: {
      approvedTotal: 500000,
      paidTotal: completed ? 500000 : 400000,
      amountDue: completed ? 0 : 100000,
    },
    payments: completed
      ? [
          {
            id: "payment",
            amount: 100000,
            method: "CASH",
            reference: null,
            receivedByUserId: user.id,
            receivedAt: "2026-09-26T08:00:00.000Z",
          },
        ]
      : [],
    handover: completed
      ? {
          id: "handover",
          recipientName: "Nguyễn Văn A",
          paymentDisposition: "PAID",
          paymentNote: null,
          handedOverByUserId: user.id,
          handedOverAt: "2026-09-26T08:00:00.000Z",
        }
      : null,
    warranty: completed
      ? {
          id: "warranty",
          startsAt: "2026-09-26T08:00:00.000Z",
          endsAt: "2099-12-26T08:00:00.000Z",
          terms: "Bảo hành nguồn 90 ngày",
        }
      : null,
    sourceOrder: null,
    followUpOrders: [],
    timeline: [],
  };
}

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function installApi(page: Page) {
  let completed = false;
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/v1/auth/refresh") {
      return json(route, { data: { accessToken: "memory-only", expiresInSeconds: 900, user } });
    }
    if (path === `/api/v1/repair-orders/${orderId}` && request.method() === "GET") {
      return json(route, { data: detail(completed ? "COMPLETED" : "READY_FOR_PICKUP") });
    }
    if (path === "/api/v1/technicians") return json(route, { data: [] });
    if (path === `/api/v1/repair-orders/${orderId}/handovers`) {
      completed = true;
      const current = detail("COMPLETED");
      return json(
        route,
        {
          data: {
            order: current,
            handover: current.handover,
            payment: current.payments[0],
            warranty: current.warranty,
            paymentSummary: current.paymentSummary,
            trackingUrl: `http://127.0.0.1:3100/p/${rawToken}`,
            trackingExpiresAt: "2099-12-31T00:00:00.000Z",
          },
        },
        201,
      );
    }
    if (path === "/api/v1/media/presign") {
      return json(
        route,
        {
          data: {
            mediaAssetId: "media-warranty",
            uploadUrl: "http://127.0.0.1:3100/test-upload/warranty",
            expiresAt: "2099-12-31T00:00:00.000Z",
          },
        },
        201,
      );
    }
    if (path === `/api/v1/repair-orders/${orderId}/warranty-orders`) {
      return json(
        route,
        {
          data: {
            ...detail("COMPLETED"),
            id: "follow-up-order",
            code: "RFW-2609-00002",
            serviceType: "WARRANTY",
            sourceOrderId: orderId,
            status: "RECEIVED",
            returnedAt: null,
            handover: null,
            warranty: null,
          },
        },
        201,
      );
    }
    return json(
      route,
      { error: { code: "UNEXPECTED_E2E_ROUTE", message: path, requestId: "e2e" } },
      500,
    );
  });
  await page.route("**/test-upload/warranty", (route) => route.fulfill({ status: 200, body: "" }));
  await page.route("**/api/public", async (route) => {
    expect(route.request().headers()["x-repairflow-public-token"]).toBe(rawToken);
    return json(route, {
      data: {
        shopName: "RepairFlow E2E",
        shopContact: "0901000000",
        orderCode: "RFE-2609-00001",
        deviceLabel: "Samsung S25",
        status: "COMPLETED",
        completionOutcome: "REPAIRED",
        readyAt: "2026-09-25T08:00:00.000Z",
        returnedAt: "2026-09-26T08:00:00.000Z",
        timeline: [
          {
            type: "HANDOVER_COMPLETED",
            message: "Thiết bị đã được bàn giao.",
            createdAt: "2026-09-26T08:00:00.000Z",
          },
        ],
        quote: null,
        warranty: {
          startsAt: "2026-09-26T08:00:00.000Z",
          endsAt: "2099-12-26T08:00:00.000Z",
          terms: "Bảo hành nguồn 90 ngày",
          status: "ACTIVE",
        },
        linkedOrders: [],
      },
    });
  });
}

async function expectNoHorizontalOverflow(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    )
    .toBe(true);
}

test("handover, public completion and warranty follow-up stay binding and responsive", async ({
  page,
}) => {
  await installApi(page);
  await page.goto(`/orders/${orderId}?shopId=${shopId}&tab=handover`);
  await expect(page.getByRole("heading", { name: "Xác nhận bàn giao" })).toBeVisible();
  await page.getByRole("textbox", { name: "Người nhận thiết bị" }).fill("Nguyễn Văn A");
  await page.getByRole("textbox", { name: /Thanh toán cuối/ }).fill("100000");
  await page.getByLabel("Bảo hành đến").fill("2099-12-26T08:00");
  await page.getByRole("textbox", { name: "Điều khoản bảo hành" }).fill("Bảo hành nguồn 90 ngày");
  await page.getByRole("button", { name: "Kiểm tra và bàn giao" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Xác nhận bàn giao" }).click();
  await expect(page.getByRole("heading", { name: "Thiết bị đã rời cửa hàng" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sao chép liên kết" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText(rawToken);

  await page.goto(`/p/${rawToken}`);
  await expect(page.getByRole("heading", { name: "Thông tin hoàn tất" })).toBeVisible();
  await expect(page.getByText("Bảo hành nguồn 90 ngày")).toBeVisible();
  await expect(page.getByRole("button", { name: /đồng ý|từ chối/i })).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("Nguyễn Văn A");

  await page.goto(`/orders/${orderId}?shopId=${shopId}&tab=handover`);
  await page.getByRole("button", { name: "Tạo phiếu bảo hành" }).click();
  await expect(page.getByText("Khách E2E", { exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "Vấn đề bảo hành" }).fill("Lỗi nguồn tái phát");
  await page
    .getByRole("textbox", { name: "Tình trạng khi nhận lại" })
    .fill("Máy không lên nguồn, vỏ nguyên trạng");
  await page
    .getByLabel(/Ảnh tiếp nhận mới/)
    .setInputFiles({ name: "warranty.jpg", mimeType: "image/jpeg", buffer: Buffer.from("photo") });
  await expect(page.getByText("Đã tải lên", { exact: true })).toBeVisible();
  const checks = page.getByRole("checkbox");
  await checks.nth(0).check();
  await checks.nth(1).check();
  await page.getByRole("button", { name: "Tạo phiếu bảo hành" }).click();
  await expect(page.getByRole("link", { name: "Mở phiếu bảo hành" })).toHaveAttribute(
    "href",
    `/orders/follow-up-order?shopId=${shopId}`,
  );
  await expectNoHorizontalOverflow(page);
});
