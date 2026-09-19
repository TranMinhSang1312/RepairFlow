// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RepairFlowApiError } from "@/lib/api/errors";

import { LoginForm, RegisterOwnerForm, validateRegistration } from "./auth-forms";

const replace = vi.fn();
const login = vi.fn();
const registerOwner = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));
vi.mock("@/lib/auth/auth-provider", () => ({
  useAuth: () => ({
    status: "anonymous",
    user: null,
    login,
    registerOwner,
  }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("auth forms", () => {
  it("rejects registration contract boundaries and password mismatch", () => {
    expect(
      validateRegistration({
        email: "bad",
        password: "short",
        confirmPassword: "different",
        displayName: "",
        shopName: "Shop",
        branchName: "Main",
      }),
    ).toMatchObject({
      email: expect.any(String),
      password: expect.any(String),
      confirmPassword: expect.any(String),
      displayName: expect.any(String),
    });
  });

  it("uses the same generic login message and clears the password", async () => {
    login.mockRejectedValue(new RepairFlowApiError(401, "AUTH_REQUIRED", "internal detail"));
    const user = userEvent.setup();
    render(<LoginForm />);
    await user.type(screen.getByLabelText("Email"), "owner@example.com");
    await user.type(screen.getByLabelText("Mật khẩu"), "wrong-password");
    await user.click(screen.getByRole("button", { name: "Đăng nhập" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Email hoặc mật khẩu không đúng.",
    );
    expect((screen.getByLabelText("Mật khẩu") as HTMLInputElement).value).toBe("");
  });

  it("registers without sending confirmPassword or timezone", async () => {
    registerOwner.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<RegisterOwnerForm />);
    await user.type(screen.getByLabelText("Tên của bạn"), "Minh Sang");
    await user.type(screen.getByLabelText("Email"), "owner@example.com");
    await user.type(screen.getByLabelText("Tên cửa hàng"), "RepairFlow Demo");
    await user.type(screen.getByLabelText("Chi nhánh đầu tiên"), "Chi nhánh chính");
    await user.type(screen.getByLabelText("Mật khẩu"), "very-secure-password");
    await user.type(screen.getByLabelText("Nhập lại mật khẩu"), "very-secure-password");
    await user.click(screen.getByRole("button", { name: "Tạo cửa hàng" }));
    expect(registerOwner).toHaveBeenCalledWith({
      email: "owner@example.com",
      password: "very-secure-password",
      displayName: "Minh Sang",
      shopName: "RepairFlow Demo",
      branchName: "Chi nhánh chính",
    });
    expect(replace).toHaveBeenCalledWith("/orders");
  });
});
