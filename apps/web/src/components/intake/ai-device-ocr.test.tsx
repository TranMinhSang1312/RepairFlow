// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { IntakeApi } from "@/lib/api/intake-api";
import type { AiRunView, DeviceOcrOutput, NewDevice } from "@/lib/api/types";

import { AiDeviceOcr } from "./ai-device-ocr";

const shopId = "11111111-1111-4111-8111-111111111111";
const output: DeviceOcrOutput = {
  brand: { value: "Samsung", confidence: 0.95 },
  model: { value: "Galaxy S24", confidence: 0.88 },
  serialNumber: { value: null, confidence: 0 },
  imei: { value: "490154203237518", confidence: 0.99 },
  warnings: ["Đối chiếu lại số IMEI trên máy."],
};
const run: AiRunView = {
  id: "22222222-2222-4222-8222-222222222222",
  capability: "DEVICE_OCR",
  status: "SUCCEEDED",
  promptVersion: "device-ocr-v1",
  schemaVersion: "1",
  output,
  confidence: 0.94,
  errorCode: null,
  review: null,
  createdAt: "2026-09-29T00:00:00.000Z",
  startedAt: "2026-09-29T00:00:00.000Z",
  completedAt: "2026-09-29T00:00:01.000Z",
};
const current: NewDevice = {
  type: "PHONE",
  brand: "Manual brand",
  model: "Manual model",
  color: "Black",
  serial: "MANUAL-SERIAL",
  imei: null,
};

beforeEach(() => {
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn(() => "blob:ocr"),
  });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
});

afterEach(cleanup);

function api(overrides: Record<string, unknown> = {}): IntakeApi {
  return {
    listAiCapabilities: vi
      .fn()
      .mockResolvedValue([{ capability: "DEVICE_OCR", effectiveEnabled: true }]),
    uploadIntakeMedia: vi.fn().mockResolvedValue("33333333-3333-4333-8333-333333333333"),
    createDeviceOcr: vi.fn().mockResolvedValue(run),
    getAiRun: vi.fn().mockResolvedValue(run),
    reviewAiRun: vi.fn().mockResolvedValue({ ...run, review: { outcome: "ACCEPTED_EDITED" } }),
    ...overrides,
  } as unknown as IntakeApi;
}

function setup(fake = api()) {
  const onMediaUploaded = vi.fn();
  const onApply = vi.fn();
  render(
    <AiDeviceOcr
      api={fake}
      shopId={shopId}
      current={current}
      onMediaUploaded={onMediaUploaded}
      onApply={onApply}
      pollDelayMs={0}
    />,
  );
  return { fake, onMediaUploaded, onApply };
}

describe("AiDeviceOcr", () => {
  it("stays hidden when the feature flag is off and has no scan action without an image", async () => {
    const disabled = api({
      listAiCapabilities: vi
        .fn()
        .mockResolvedValue([{ capability: "DEVICE_OCR", effectiveEnabled: false }]),
    });
    setup(disabled);
    await waitFor(() => expect(disabled.listAiCapabilities).toHaveBeenCalled());
    expect(screen.queryByRole("region", { name: "AI đọc thông tin thiết bị" })).toBeNull();

    cleanup();
    setup();
    expect(await screen.findByRole("region", { name: "AI đọc thông tin thiết bị" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Quét thông tin bằng AI" })).toBeNull();
  });

  it("uploads, compares, selects no fields by default and applies only checked values at 360px", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 360 });
    const fake = api();
    const { onApply, onMediaUploaded } = setup(fake);
    const user = userEvent.setup();
    const input = await screen.findByLabelText("Ảnh nhãn máy hoặc màn hình thông tin");
    await user.upload(input, new File(["safe-image"], "device.jpg", { type: "image/jpeg" }));
    expect(onMediaUploaded).toHaveBeenCalledWith(
      expect.objectContaining({ name: "device.jpg" }),
      "33333333-3333-4333-8333-333333333333",
    );
    await user.click(await screen.findByRole("button", { name: "Quét thông tin bằng AI" }));
    expect(await screen.findByText("AI: Samsung")).toBeTruthy();
    expect(screen.getByText("Hiện tại: Manual brand")).toBeTruthy();
    const apply = screen.getByRole("button", { name: "Áp dụng trường đã chọn" });
    expect((apply as HTMLButtonElement).disabled).toBe(true);
    const brandCheckbox = screen.getByRole("checkbox", { name: /Hãng/ });
    expect((brandCheckbox as HTMLInputElement).checked).toBe(false);
    await user.click(brandCheckbox);
    await user.click(apply);
    await waitFor(() => expect(onApply).toHaveBeenCalledWith({ brand: "Samsung" }));
    expect(fake.reviewAiRun).toHaveBeenCalledWith(
      shopId,
      run.id,
      expect.objectContaining({
        outcome: "ACCEPTED_EDITED",
        reviewedOutput: expect.objectContaining({
          brand: output.brand,
          model: { value: null, confidence: 0 },
          serialNumber: { value: null, confidence: 0 },
          imei: { value: null, confidence: 0 },
        }),
      }),
    );
  });

  it("keeps the manual draft unchanged on provider failure", async () => {
    const fake = api({ createDeviceOcr: vi.fn().mockRejectedValue(new Error("provider offline")) });
    const { onApply } = setup(fake);
    const user = userEvent.setup();
    await user.upload(
      await screen.findByLabelText("Ảnh nhãn máy hoặc màn hình thông tin"),
      new File(["safe-image"], "device.png", { type: "image/png" }),
    );
    const scan = await screen.findByRole("button", { name: "Quét thông tin bằng AI" });
    scan.focus();
    await user.keyboard("{Enter}");
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Không thể kết nối với máy chủ",
    );
    expect(onApply).not.toHaveBeenCalled();
    expect(current).toMatchObject({ brand: "Manual brand", model: "Manual model" });
  });

  it("shows queue state and lets keyboard users reject the draft", async () => {
    let resolveRun!: (value: AiRunView) => void;
    const create = vi.fn(
      () =>
        new Promise<AiRunView>((resolve) => {
          resolveRun = resolve;
        }),
    );
    const fake = api({ createDeviceOcr: create });
    setup(fake);
    const user = userEvent.setup();
    await user.upload(
      await screen.findByLabelText("Ảnh nhãn máy hoặc màn hình thông tin"),
      new File(["safe-image"], "device.webp", { type: "image/webp" }),
    );
    await user.click(await screen.findByRole("button", { name: "Quét thông tin bằng AI" }));
    expect(await screen.findByText("AI đang đọc ảnh… Bạn vẫn có thể nhập tay.")).toBeTruthy();
    resolveRun(run);
    const reject = await screen.findByRole("button", { name: "Bỏ qua gợi ý" });
    reject.focus();
    await user.keyboard("{Enter}");
    await waitFor(() =>
      expect(fake.reviewAiRun).toHaveBeenCalledWith(shopId, run.id, { outcome: "REJECTED" }),
    );
  });
});
