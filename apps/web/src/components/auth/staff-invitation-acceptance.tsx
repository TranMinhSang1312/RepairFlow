"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";

import { safeErrorMessage } from "@/lib/api/errors";
import type { PublicStaffInvitation } from "@/lib/api/types";
import { useAuth } from "@/lib/auth/auth-provider";

function destination(
  user: { memberships: Array<{ shopId: string; shopName: string; status: string }> },
  shopName: string,
): string {
  const membership =
    user.memberships.find((item) => item.status === "ACTIVE" && item.shopName === shopName) ??
    user.memberships.find((item) => item.status === "ACTIVE");
  return membership ? `/orders?shopId=${encodeURIComponent(membership.shopId)}` : "/orders";
}

export function StaffInvitationAcceptance({ token }: { token: string }) {
  const auth = useAuth();
  const router = useRouter();
  const [invitation, setInvitation] = useState<PublicStaffInvitation | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error" | "done">("loading");
  const [error, setError] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    setState("loading");
    void auth.api
      .inspectStaffInvitation(token)
      .then((data) => {
        if (!active) return;
        setInvitation(data);
        setState("ready");
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setError(safeErrorMessage(reason));
        setState("error");
      });
    return () => {
      active = false;
    };
  }, [auth.api, token]);

  async function acceptNew(event: FormEvent) {
    event.preventDefault();
    if (password !== confirmPassword) {
      setError("Mật khẩu xác nhận chưa khớp.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await auth.api.acceptNewStaffInvitation(token, {
        displayName: displayName.trim(),
        password,
      });
      setState("done");
      router.replace(destination(result.user, invitation!.shopName));
    } catch (reason) {
      setError(safeErrorMessage(reason));
      setBusy(false);
    }
  }

  async function acceptExisting() {
    setBusy(true);
    setError("");
    try {
      const user = await auth.api.acceptExistingStaffInvitation(token);
      await auth.reloadCurrentUser();
      setState("done");
      router.replace(destination(user, invitation!.shopName));
    } catch (reason) {
      setError(safeErrorMessage(reason));
      setBusy(false);
    }
  }

  if (state === "loading")
    return (
      <main className="join-shell">
        <section className="join-card" aria-busy="true">
          <span className="spinner" />
          <h1>Đang kiểm tra lời mời</h1>
        </section>
      </main>
    );
  if (state === "error" || !invitation)
    return (
      <main className="join-shell">
        <section className="join-card">
          <span className="state-icon">!</span>
          <h1>Không thể dùng lời mời</h1>
          <p role="alert">{error || "Link mời không hợp lệ hoặc đã hết hạn."}</p>
          <Link className="button button-secondary" href="/login">
            Về trang đăng nhập
          </Link>
        </section>
      </main>
    );

  return (
    <main className="join-shell">
      <section className="join-card">
        <div className="brand">
          <span>R</span>RepairFlow
        </div>
        <p className="eyebrow">LỜI MỜI NHÂN VIÊN</p>
        <h1>Tham gia {invitation.shopName}</h1>
        <dl className="invite-summary">
          <div>
            <dt>Email</dt>
            <dd>{invitation.maskedEmail}</dd>
          </div>
          <div>
            <dt>Vai trò</dt>
            <dd>{invitation.role === "TECHNICIAN" ? "Kỹ thuật viên" : "Lễ tân"}</dd>
          </div>
          <div>
            <dt>Hết hạn</dt>
            <dd>{new Date(invitation.expiresAt).toLocaleString("vi-VN")}</dd>
          </div>
        </dl>
        {error && (
          <p className="notice notice-error" role="alert">
            {error}
          </p>
        )}
        {invitation.acceptanceMode === "CREATE_ACCOUNT" ? (
          <form className="join-form" onSubmit={(event) => void acceptNew(event)}>
            <label>
              Họ tên
              <input
                required
                maxLength={100}
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
              />
            </label>
            <label>
              Mật khẩu
              <input
                required
                minLength={10}
                maxLength={128}
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <label>
              Xác nhận mật khẩu
              <input
                required
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
              />
            </label>
            <button className="button button-primary" disabled={busy}>
              {busy ? "Đang tạo tài khoản…" : "Tạo tài khoản và tham gia"}
            </button>
          </form>
        ) : auth.status === "authenticated" ? (
          <div className="join-form">
            <p>
              Bạn đang đăng nhập bằng <strong>{auth.user?.email}</strong>. Email này phải khớp lời
              mời.
            </p>
            <button
              className="button button-primary"
              disabled={busy}
              onClick={() => void acceptExisting()}
            >
              {busy ? "Đang tham gia…" : "Xác nhận tham gia cửa hàng"}
            </button>
          </div>
        ) : (
          <div className="join-form">
            <p>Email này đã có tài khoản RepairFlow. Hãy đăng nhập đúng tài khoản để nhận quyền.</p>
            <Link
              className="button button-primary"
              href={`/login?next=${encodeURIComponent(`/join/${token}`)}`}
            >
              Đăng nhập để tiếp tục
            </Link>
          </div>
        )}
      </section>
    </main>
  );
}
