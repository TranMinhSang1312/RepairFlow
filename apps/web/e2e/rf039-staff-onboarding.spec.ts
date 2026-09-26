import { expect, test } from "@playwright/test";

test("owner invites a technician who creates their own account through the real API", async ({
  page,
  browser,
}) => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const ownerEmail = `rf039-owner-${suffix}@example.test`;
  const technicianEmail = `rf039-tech-${suffix}@example.test`;
  const password = "correct horse battery staple";

  await page.goto("/register");
  await page.getByLabel("Tên của bạn").fill("RF039 E2E Owner");
  await page.getByLabel("Email").fill(ownerEmail);
  await page.getByLabel("Tên cửa hàng").fill(`RF039 E2E ${suffix}`);
  await page.getByLabel("Chi nhánh đầu tiên").fill("Main");
  await page.getByLabel("Mật khẩu", { exact: true }).fill(password);
  await page.getByLabel("Nhập lại mật khẩu").fill(password);
  await page.getByRole("button", { name: "Tạo cửa hàng" }).click();
  await expect(page).toHaveURL(/\/orders/);

  await page.getByRole("link", { name: "Nhân viên" }).click();
  await expect(page.getByRole("heading", { name: "Nhân viên", exact: true })).toBeVisible();
  await page.getByPlaceholder("nhanvien@example.com").fill(technicianEmail);
  await page.getByRole("button", { name: "Tạo link mời" }).click();
  const setupUrl = await page.getByLabel("Link thiết lập").inputValue();
  expect(setupUrl).toContain("/join/");

  const technicianContext = await browser.newContext();
  const technicianPage = await technicianContext.newPage();
  const setupPath = new URL(setupUrl).pathname;
  await technicianPage.goto(setupPath);
  await expect(technicianPage.getByRole("heading", { name: /Tham gia RF039 E2E/ })).toBeVisible();
  await technicianPage.getByLabel("Họ tên").fill("RF039 E2E Technician");
  await technicianPage.getByLabel("Mật khẩu", { exact: true }).fill(password);
  await technicianPage.getByLabel("Xác nhận mật khẩu").fill(password);
  await technicianPage.getByRole("button", { name: "Tạo tài khoản và tham gia" }).click();
  await expect(technicianPage).toHaveURL(/\/orders\?shopId=/);
  await page.reload();
  const technicianCard = page.locator(".staff-member-card").filter({
    has: page.getByRole("heading", { name: "RF039 E2E Technician" }),
  });
  await expect(technicianCard).toBeVisible();
  await expect(technicianCard.getByText(technicianEmail)).toBeVisible();

  await page.getByRole("link", { name: "Tiếp nhận" }).click();
  await page.getByRole("button", { name: "+ Tạo khách hàng mới" }).click();
  await page.getByLabel("Họ tên *").fill("Khách RF039");
  await page.getByLabel("Số điện thoại *").fill("0901234567");
  await page.getByRole("button", { name: "Tạo và chọn khách hàng" }).click();
  await page.getByRole("button", { name: "+ Thêm thiết bị mới" }).click();
  await page.getByLabel("Hãng *").fill("RepairFlow");
  await page.getByLabel("Model *").fill("RF039 Test Device");
  await page.getByRole("button", { name: "Tạo và chọn thiết bị" }).click();
  await page.getByLabel("Khách báo lỗi gì? *").fill("Thiết bị không khởi động");
  await page.getByLabel("Tình trạng bên ngoài khi nhận *").fill("Ngoại hình nguyên vẹn");
  await page.locator('input[type="file"]').setInputFiles({
    name: "intake.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nWQAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await expect(page.getByText("Đã tải lên")).toBeVisible();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Xem lại phiếu →" }).click();
  await page.getByRole("button", { name: "Xác nhận nhận thiết bị" }).click();
  const orderCode = await page.locator("#receipt-title").textContent();
  expect(orderCode).toBeTruthy();

  await page.goto("/orders");
  await page.getByText(orderCode!, { exact: true }).click();
  await page.getByLabel("Kỹ thuật viên hoạt động").selectOption({ label: "RF039 E2E Technician" });
  await page.getByRole("button", { name: "Phân công", exact: true }).click();
  await expect(page.getByText("Đã cập nhật kỹ thuật viên phụ trách.")).toBeVisible();
  const assignedOrderPath = new URL(page.url()).pathname + new URL(page.url()).search;

  await technicianPage.goto(assignedOrderPath);
  await expect(technicianPage.getByRole("heading", { name: orderCode! })).toBeVisible();
  await technicianContext.close();
});
