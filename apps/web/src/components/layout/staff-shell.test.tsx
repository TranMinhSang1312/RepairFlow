// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProtectedStaffLayout } from "./staff-shell";

const replace = vi.fn();
let authState: Record<string, unknown>;

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  usePathname: () => "/orders/example",
  useSearchParams: () => new URLSearchParams("shopId=shop-one"),
}));
vi.mock("@/lib/auth/auth-provider", () => ({ useAuth: () => authState }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ProtectedStaffLayout", () => {
  it("does not render business children while checking", () => {
    authState = { status: "checking", user: null };
    render(
      <ProtectedStaffLayout>
        <div>secret order</div>
      </ProtectedStaffLayout>,
    );
    expect(screen.queryByText("secret order")).toBeNull();
    expect(screen.getByText("Đang kiểm tra phiên làm việc")).toBeTruthy();
  });

  it("redirects anonymous users with an encoded internal return path", async () => {
    authState = { status: "anonymous", user: null };
    render(
      <ProtectedStaffLayout>
        <div>secret order</div>
      </ProtectedStaffLayout>,
    );
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith("/login?next=%2Forders%2Fexample%3FshopId%3Dshop-one"),
    );
    expect(screen.queryByText("secret order")).toBeNull();
  });

  it("blocks users without an active membership", () => {
    authState = {
      status: "authenticated",
      user: { displayName: "Inactive", memberships: [{ status: "INACTIVE" }] },
      logout: vi.fn(),
    };
    render(
      <ProtectedStaffLayout>
        <div>tenant API screen</div>
      </ProtectedStaffLayout>,
    );
    expect(screen.getByText("Chưa có quyền truy cập")).toBeTruthy();
    expect(screen.queryByText("tenant API screen")).toBeNull();
    expect(screen.getByRole("button", { name: "Đăng xuất" })).toBeTruthy();
  });
});
