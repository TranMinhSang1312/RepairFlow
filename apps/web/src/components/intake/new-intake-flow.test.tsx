// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { IntakeApi } from "@/lib/api/intake-api";
import type {
  AuthData,
  CreateRepairOrderInput,
  Customer,
  Device,
  RepairOrderReceipt,
} from "@/lib/api/types";

import { NewIntakeFlow } from "./new-intake-flow";

afterEach(cleanup);

const shopId = "11111111-1111-4111-8111-111111111111";
const branchId = "22222222-2222-4222-8222-222222222222";
const customer: Customer = {
  id: "33333333-3333-4333-8333-333333333333",
  name: "Tran Minh An",
  phone: "0901234567",
  email: null,
  notes: null,
  createdAt: "2026-09-19T00:00:00.000Z",
};
const device: Device = {
  id: "44444444-4444-4444-8444-444444444444",
  customerId: customer.id,
  type: "PHONE",
  brand: "Samsung",
  model: "S25",
  color: "Black",
  serialMasked: null,
  imeiMasked: "••••1234",
};
const auth: AuthData = {
  accessToken: "memory-token",
  expiresInSeconds: 900,
  user: {
    id: "55555555-5555-4555-8555-555555555555",
    email: "owner@example.com",
    displayName: "Minh Sang",
    memberships: [
      {
        shopId,
        shopName: "RepairFlow Demo",
        role: "OWNER",
        status: "ACTIVE",
        timezone: "Asia/Ho_Chi_Minh",
        intakePhotoMinimum: 1,
        branches: [{ id: branchId, name: "Chi nhánh chính" }],
      },
    ],
  },
};

function fakeApi(overrides: Partial<IntakeApi> = {}): IntakeApi {
  return {
    restoreSession: vi.fn().mockResolvedValue(auth),
    searchCustomers: vi.fn().mockResolvedValue([customer]),
    createCustomer: vi.fn().mockResolvedValue(customer),
    listDevices: vi.fn().mockResolvedValue([device]),
    createDevice: vi.fn().mockResolvedValue(device),
    uploadIntakeMedia: vi.fn().mockImplementation(async (_shopId, _file, onProgress) => {
      onProgress?.({ stage: "uploading" });
      onProgress?.({ stage: "complete" });
      return "66666666-6666-4666-8666-666666666666";
    }),
    createRepairOrder: vi
      .fn()
      .mockImplementation(
        async (_shopId: string, input: CreateRepairOrderInput): Promise<RepairOrderReceipt> => ({
          id: "77777777-7777-4777-8777-777777777777",
          code: "RFD-00001",
          status: "RECEIVED",
          priority: input.priority,
          branchId: input.branchId,
          reportedProblem: input.reportedProblem,
          intakeCondition: input.intakeCondition,
          customer,
          device,
          promisedAt: input.promisedAt ?? null,
          receivedAt: "2026-09-19T01:00:00.000Z",
        }),
      ),
    ...overrides,
  };
}

describe("NewIntakeFlow", () => {
  it("completes the customer, device, evidence and receipt path at a mobile viewport", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 360 });
    window.dispatchEvent(new Event("resize"));
    const api = fakeApi();
    const user = userEvent.setup();
    render(<NewIntakeFlow api={api} />);

    expect(await screen.findByRole("heading", { name: "Tạo phiếu sửa chữa" })).toBeTruthy();
    await user.type(screen.getByLabelText("Tên hoặc số điện thoại"), "0901");
    await user.click(screen.getByRole("button", { name: "Tìm khách" }));
    await user.click(await screen.findByRole("button", { name: /Tran Minh An/ }));
    await user.click(await screen.findByRole("button", { name: /Samsung S25/ }));

    expect(
      (screen.getByRole("combobox", { name: "Chi nhánh tiếp nhận *" }) as HTMLSelectElement).value,
    ).toBe(branchId);
    await user.type(
      screen.getByRole("textbox", { name: /Khách báo lỗi gì/ }),
      "Máy không lên nguồn",
    );
    await user.type(
      screen.getByRole("textbox", { name: /Tình trạng bên ngoài khi nhận/ }),
      "Xước nhẹ góc trái",
    );
    const fileInput = screen.getByLabelText(/Chụp hoặc chọn ảnh/) as HTMLInputElement;
    await user.upload(fileInput, new File(["image"], "intake.jpg", { type: "image/jpeg" }));
    await waitFor(() => expect(screen.getByText("Đã tải lên")).toBeTruthy());
    await user.click(screen.getByLabelText(/Khách hàng đã xác nhận/));
    await user.click(screen.getByRole("button", { name: "Xem lại phiếu →" }));
    await user.click(screen.getByRole("button", { name: "Xác nhận nhận thiết bị" }));

    expect(await screen.findByRole("heading", { name: "RFD-00001" })).toBeTruthy();
    expect(screen.getByText("RECEIVED")).toBeTruthy();
    expect(api.createRepairOrder).toHaveBeenCalledTimes(1);
    expect(api.createRepairOrder).toHaveBeenCalledWith(
      shopId,
      expect.objectContaining({
        branchId,
        customerId: customer.id,
        deviceId: device.id,
        consentAcknowledged: true,
        mediaAssetIds: ["66666666-6666-4666-8666-666666666666"],
      }),
      expect.stringMatching(/^[0-9a-f-]{36}$/),
    );
  });

  it("shows an upload error and retries without losing the selected file", async () => {
    const upload = vi
      .fn<IntakeApi["uploadIntakeMedia"]>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce("88888888-8888-4888-8888-888888888888");
    const api = fakeApi({ uploadIntakeMedia: upload });
    const user = userEvent.setup();
    render(<NewIntakeFlow api={api} />);
    await screen.findByRole("heading", { name: "Tạo phiếu sửa chữa" });
    await user.type(screen.getByLabelText("Tên hoặc số điện thoại"), "0901");
    await user.click(screen.getByRole("button", { name: "Tìm khách" }));
    await user.click(await screen.findByRole("button", { name: /Tran Minh An/ }));
    await user.click(await screen.findByRole("button", { name: /Samsung S25/ }));

    await act(async () => {
      fireEvent.change(screen.getByLabelText(/Chụp hoặc chọn ảnh/), {
        target: { files: [new File(["image"], "retry.jpg", { type: "image/jpeg" })] },
      });
    });
    expect(await screen.findByRole("button", { name: "Thử lại" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Thử lại" }));
    await waitFor(() => expect(screen.getByText("Đã tải lên")).toBeTruthy());
    expect(upload).toHaveBeenCalledTimes(2);
  });
});
