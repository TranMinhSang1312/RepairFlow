// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { IntakeApi } from "@/lib/api/intake-api";
import type { AiRunView, IntakeDraftOutput } from "@/lib/api/types";

import { AiIntakeDraft } from "./ai-intake-draft";

const shopId = "11111111-1111-4111-8111-111111111111";
const output: IntakeDraftOutput = {
  reportedProblem: "Thiết bị tự tắt nguồn khi pin còn khoảng 30%.",
  visibleCondition: "Màn hình trầy nhẹ ở góc phải.",
  accessories: ["Ốp lưng"],
  customerClaims: ["Chưa từng thay pin"],
  uncertainties: ["Chưa xác nhận thiết bị có vào nước"],
};
const run: AiRunView = {
  id: "22222222-2222-4222-8222-222222222222",
  capability: "INTAKE_DRAFT",
  status: "SUCCEEDED",
  promptVersion: "intake-draft-v1",
  schemaVersion: "1",
  output,
  confidence: null,
  errorCode: null,
  review: null,
  createdAt: "2026-09-29T00:00:00.000Z",
  startedAt: "2026-09-29T00:00:00.000Z",
  completedAt: "2026-09-29T00:00:01.000Z",
};

afterEach(cleanup);

function api(overrides: Record<string, unknown> = {}): IntakeApi {
  return {
    listAiCapabilities: vi.fn().mockResolvedValue([
      {
        capability: "INTAKE_DRAFT",
        effectiveEnabled: true,
        audioEffectiveEnabled: false,
      },
    ]),
    createIntakeDraft: vi.fn().mockResolvedValue(run),
    getAiRun: vi.fn().mockResolvedValue(run),
    reviewAiRun: vi.fn().mockResolvedValue({ ...run, review: { outcome: "ACCEPTED_EDITED" } }),
    uploadIntakeAudio: vi.fn().mockResolvedValue("33333333-3333-4333-8333-333333333333"),
    ...overrides,
  } as unknown as IntakeApi;
}

function setup(fake = api()) {
  const onApply = vi.fn();
  render(
    <AiIntakeDraft
      api={fake}
      shopId={shopId}
      deviceType="PHONE"
      current={{
        reportedProblem: "Nội dung đang nhập",
        intakeCondition: "Ngoại quan đang nhập",
        accessories: [],
      }}
      onApply={onApply}
      pollDelayMs={0}
    />,
  );
  return { fake, onApply };
}

describe("AiIntakeDraft", () => {
  it("hides when disabled and exposes audio as unavailable by default", async () => {
    const disabled = api({
      listAiCapabilities: vi
        .fn()
        .mockResolvedValue([{ capability: "INTAKE_DRAFT", effectiveEnabled: false }]),
    });
    setup(disabled);
    await waitFor(() => expect(disabled.listAiCapabilities).toHaveBeenCalled());
    expect(screen.queryByRole("region", { name: "AI tạo bản nháp tiếp nhận" })).toBeNull();

    cleanup();
    setup();
    expect(await screen.findByRole("region", { name: "AI tạo bản nháp tiếp nhận" })).toBeTruthy();
    expect((screen.getByRole("button", { name: /Ghi âm/ }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("creates a text draft, selects nothing by default and applies only selected fields at 360px", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 360 });
    const user = userEvent.setup();
    const { fake, onApply } = setup();
    const source = await screen.findByRole("textbox", { name: "Mô tả tự do" });
    await user.type(source, "Khách báo máy tự tắt nguồn, có ốp lưng.");
    await user.click(screen.getByRole("button", { name: "Tạo bản nháp bằng AI" }));
    expect(await screen.findByText(/Thiết bị tự tắt nguồn/)).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Áp dụng trường đã chọn" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    const editedProblem = screen.getByRole("textbox", { name: "AI: Lỗi khách báo" });
    await user.clear(editedProblem);
    await user.type(editedProblem, "Thiết bị tắt nguồn khi pin còn 25%.");
    await user.click(screen.getByRole("checkbox", { name: "Chọn Lỗi khách báo" }));
    await user.click(screen.getByRole("button", { name: "Áp dụng trường đã chọn" }));
    await waitFor(() =>
      expect(onApply).toHaveBeenCalledWith({
        reportedProblem: "Thiết bị tắt nguồn khi pin còn 25%.",
      }),
    );
    expect(fake.reviewAiRun).toHaveBeenCalledWith(
      shopId,
      run.id,
      expect.objectContaining({ outcome: "ACCEPTED_EDITED" }),
    );
  });

  it("keeps manual form untouched on provider or polling failure", async () => {
    const user = userEvent.setup();
    const failed = api({ createIntakeDraft: vi.fn().mockRejectedValue(new Error("unavailable")) });
    const { onApply } = setup(failed);
    await user.type(await screen.findByRole("textbox", { name: "Mô tả tự do" }), "Máy lỗi nguồn");
    await user.click(screen.getByRole("button", { name: "Tạo bản nháp bằng AI" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(onApply).not.toHaveBeenCalled();
  });

  it("keeps the prior draft with a stale label when later polling fails", async () => {
    const user = userEvent.setup();
    const queued = { ...run, status: "QUEUED" as const, output: null };
    const fake = api({
      createIntakeDraft: vi.fn().mockResolvedValueOnce(run).mockResolvedValueOnce(queued),
      getAiRun: vi.fn().mockRejectedValue(new Error("polling failed")),
    });
    setup(fake);
    await user.type(await screen.findByRole("textbox", { name: "Mô tả tự do" }), "Máy lỗi nguồn");
    await user.click(screen.getByRole("button", { name: "Tạo bản nháp bằng AI" }));
    expect(await screen.findByText(/Thiết bị tự tắt nguồn/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Tạo bản nháp bằng AI" }));
    expect(await screen.findByText("Kết quả cũ được giữ lại do polling thất bại.")).toBeTruthy();
    expect(screen.getByText(/Thiết bị tự tắt nguồn/)).toBeTruthy();
  });

  it("requires explicit consent before uploading available audio and supports rejection", async () => {
    const user = userEvent.setup();
    const fake = api({
      listAiCapabilities: vi.fn().mockResolvedValue([
        {
          capability: "INTAKE_DRAFT",
          effectiveEnabled: true,
          audioEffectiveEnabled: true,
        },
      ]),
    });
    setup(fake);
    await user.click(await screen.findByRole("button", { name: "Ghi âm" }));
    const file = new File([new Uint8Array([1, 2, 3])], "intake.wav", { type: "audio/wav" });
    await user.upload(screen.getByLabelText("File ghi âm WAV"), file);
    await user.click(screen.getByRole("button", { name: "Tạo bản nháp bằng AI" }));
    expect((await screen.findByRole("alert")).textContent).toContain("xác nhận khách hàng đồng ý");
    await user.click(screen.getByRole("checkbox", { name: /Khách hàng đồng ý ghi âm/ }));
    await user.click(screen.getByRole("button", { name: "Tạo bản nháp bằng AI" }));
    expect(await screen.findByText(/Thiết bị tự tắt nguồn/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Bỏ qua bản nháp" }));
    await waitFor(() =>
      expect(fake.reviewAiRun).toHaveBeenCalledWith(shopId, run.id, { outcome: "REJECTED" }),
    );
  });
});
