"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { safeErrorMessage } from "@/lib/api/errors";
import { useAuth } from "@/lib/auth/auth-provider";

function currentRelativePath(pathname: string, search: URLSearchParams): string {
  const query = search.toString();
  return `${pathname}${query ? `?${query}` : ""}`;
}

export function ProtectedStaffLayout({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [logoutError, setLogoutError] = useState("");
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    if (auth.status !== "anonymous") return;
    const next = encodeURIComponent(currentRelativePath(pathname, searchParams));
    router.replace(`/login?next=${next}`);
  }, [auth.status, pathname, router, searchParams]);

  if (auth.status === "checking" || auth.status === "anonymous") {
    return (
      <main className="session-state" aria-busy="true">
        <span className="spinner" aria-hidden="true" />
        <h1>Đang kiểm tra phiên làm việc</h1>
        <p>RepairFlow đang xác nhận tài khoản của bạn.</p>
      </main>
    );
  }

  if (auth.status === "session-error") {
    return (
      <main className="session-state">
        <span className="state-icon" aria-hidden="true">
          !
        </span>
        <h1>Chưa thể kiểm tra phiên</h1>
        <p role="alert">{auth.sessionError}</p>
        <button className="button button-primary" onClick={() => void auth.retrySession()}>
          Thử lại
        </button>
      </main>
    );
  }

  const memberships = auth.user?.memberships.filter((item) => item.status === "ACTIVE") ?? [];
  if (!auth.user || memberships.length === 0) {
    return (
      <main className="session-state">
        <span className="state-icon" aria-hidden="true">
          ×
        </span>
        <h1>Chưa có quyền truy cập</h1>
        <p>Tài khoản không có cửa hàng đang hoạt động. Hãy liên hệ chủ cửa hàng.</p>
        {logoutError && <p role="alert">{logoutError}</p>}
        <button
          className="button button-secondary"
          disabled={loggingOut}
          onClick={() => {
            setLoggingOut(true);
            setLogoutError("");
            void auth.logout().catch((error: unknown) => {
              setLogoutError(safeErrorMessage(error));
              setLoggingOut(false);
            });
          }}
        >
          {loggingOut ? "Đang đăng xuất…" : "Đăng xuất"}
        </button>
      </main>
    );
  }

  const requestedShop = searchParams.get("shopId");
  const membership = memberships.find((item) => item.shopId === requestedShop) ?? memberships[0]!;

  async function logout() {
    setLoggingOut(true);
    setLogoutError("");
    try {
      await auth.logout();
      router.replace("/login");
    } catch (error) {
      setLogoutError(safeErrorMessage(error));
      setLoggingOut(false);
    }
  }

  return (
    <div className="staff-app-shell">
      <header className="global-staff-header">
        <Link className="brand" href="/orders">
          <span>R</span>RepairFlow
        </Link>
        <nav aria-label="Điều hướng nhân viên">
          <Link aria-current={pathname.startsWith("/orders") ? "page" : undefined} href="/orders">
            Bảng phiếu
          </Link>
          {membership.role !== "TECHNICIAN" && (
            <Link aria-current={pathname.startsWith("/intake") ? "page" : undefined} href="/intake">
              Tiếp nhận
            </Link>
          )}
        </nav>
        <div className="staff-account">
          <div>
            <strong>{auth.user.displayName}</strong>
            <small>{membership.role}</small>
          </div>
          <button
            className="button button-secondary"
            disabled={loggingOut}
            onClick={() => void logout()}
          >
            {loggingOut ? "Đang thoát…" : "Đăng xuất"}
          </button>
        </div>
      </header>
      {logoutError && (
        <div className="global-notice notice notice-error" role="alert">
          {logoutError}
        </div>
      )}
      {children}
    </div>
  );
}
