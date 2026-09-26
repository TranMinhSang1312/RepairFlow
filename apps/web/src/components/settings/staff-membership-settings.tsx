"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { safeErrorMessage } from "@/lib/api/errors";
import type { BrowserIntakeApi } from "@/lib/api/intake-api";
import type {
  CurrentUser,
  MembershipRole,
  MembershipStatus,
  StaffInvitation,
  StaffMembership,
} from "@/lib/api/types";

function commandKey(prefix: string): string {
  return `${prefix}-${globalThis.crypto.randomUUID()}`;
}

function dateTime(value: string | null): string {
  if (!value) return "Chưa tham gia";
  return new Date(value).toLocaleString("vi-VN");
}

export function StaffMembershipSettings({
  api,
  user,
  search,
  replaceUrl,
}: {
  api: BrowserIntakeApi;
  user: CurrentUser;
  search: string;
  replaceUrl(url: string): void;
}) {
  const active = user.memberships.filter((item) => item.status === "ACTIVE");
  const requested = useMemo(() => new URLSearchParams(search).get("shopId"), [search]);
  const [shopId, setShopId] = useState(
    active.find((item) => item.shopId === requested)?.shopId ?? active[0]?.shopId ?? "",
  );
  const membership = active.find((item) => item.shopId === shopId);
  const canRead = membership?.role === "OWNER" || membership?.role === "RECEPTIONIST";
  const canManage = membership?.role === "OWNER";
  const [members, setMembers] = useState<StaffMembership[]>([]);
  const [invitations, setInvitations] = useState<StaffInvitation[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"RECEPTIONIST" | "TECHNICIAN">("TECHNICIAN");
  const [setupUrl, setSetupUrl] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    if (!shopId || !canRead) return;
    setState("loading");
    setError("");
    try {
      const [memberPage, invitationRows] = await Promise.all([
        api.listStaffMemberships(shopId, {
          ...(query.trim() ? { query: query.trim() } : {}),
          ...(roleFilter ? { role: roleFilter as MembershipRole } : {}),
          ...(statusFilter ? { status: statusFilter as MembershipStatus } : {}),
        }),
        canManage ? api.listStaffInvitations(shopId) : Promise.resolve([]),
      ]);
      setMembers(memberPage.data);
      setInvitations(invitationRows);
      setState("ready");
    } catch (reason) {
      setError(safeErrorMessage(reason));
      setState("error");
    }
  }, [api, canManage, canRead, query, roleFilter, shopId, statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!canRead) {
    return (
      <main className="settings-shell">
        <section className="settings-card">
          <h1>Quản lý nhân viên</h1>
          <p role="alert">Bạn không có quyền xem khu vực này.</p>
        </section>
      </main>
    );
  }

  async function invite() {
    if (!email.trim()) {
      setError("Hãy nhập email nhân viên.");
      return;
    }
    setBusy("invite");
    setError("");
    setMessage("");
    try {
      const created = await api.createStaffInvitation(
        shopId,
        { email: email.trim(), role: inviteRole },
        commandKey("staff-invite"),
      );
      setSetupUrl(created.setupUrl);
      setEmail("");
      setMessage("Đã tạo link mời. Hãy gửi link này cho đúng nhân viên.");
      await load();
    } catch (reason) {
      setError(safeErrorMessage(reason));
    } finally {
      setBusy("");
    }
  }

  async function invitationAction(item: StaffInvitation, action: "reissue" | "revoke") {
    setBusy(item.id);
    setError("");
    setMessage("");
    try {
      if (action === "reissue") {
        const next = await api.reissueStaffInvitation(
          shopId,
          item.id,
          item.lockVersion,
          commandKey("staff-reissue"),
        );
        setSetupUrl(next.setupUrl);
        setMessage("Đã cấp link mới; link cũ không còn hiệu lực.");
      } else {
        await api.revokeStaffInvitation(
          shopId,
          item.id,
          item.lockVersion,
          commandKey("staff-revoke"),
        );
        setMessage("Đã thu hồi lời mời.");
      }
      await load();
    } catch (reason) {
      setError(safeErrorMessage(reason));
    } finally {
      setBusy("");
    }
  }

  async function updateMember(
    item: StaffMembership,
    patch: { role?: MembershipRole; status?: MembershipStatus },
  ) {
    if (!globalThis.confirm("Xác nhận thay đổi quyền truy cập của nhân viên này?")) return;
    setBusy(item.userId);
    setError("");
    setMessage("");
    try {
      await api.updateStaffMembership(
        shopId,
        item.userId,
        { ...patch, expectedLockVersion: item.lockVersion },
        commandKey("staff-update"),
      );
      setMessage("Đã cập nhật nhân viên. Quyền mới có hiệu lực từ yêu cầu tiếp theo.");
      await load();
    } catch (reason) {
      setError(safeErrorMessage(reason));
      await load();
    } finally {
      setBusy("");
    }
  }

  return (
    <main className="settings-shell staff-settings">
      <header className="settings-heading">
        <div>
          <p className="eyebrow">CÀI ĐẶT CỬA HÀNG</p>
          <h1>Nhân viên</h1>
          <p>Mời người mới, phân vai và kiểm soát quyền truy cập theo từng cửa hàng.</p>
        </div>
        <label>
          Cửa hàng
          <select
            value={shopId}
            onChange={(event) => {
              const next = event.target.value;
              setShopId(next);
              replaceUrl(`/settings/staff?shopId=${encodeURIComponent(next)}`);
            }}
          >
            {active.map((item) => (
              <option key={item.shopId} value={item.shopId}>
                {item.shopName}
              </option>
            ))}
          </select>
        </label>
      </header>
      {error && (
        <p className="notice notice-error" role="alert">
          {error}{" "}
          <button className="text-button" onClick={() => void load()}>
            Tải lại
          </button>
        </p>
      )}
      {message && (
        <p className="notice notice-success" role="status">
          {message}
        </p>
      )}
      {canManage && (
        <section className="settings-card staff-invite-card">
          <div>
            <h2>Mời nhân viên</h2>
            <p>
              RepairFlow tạo link dùng một lần, hiệu lực 72 giờ. Chủ cửa hàng không đặt hoặc xem mật
              khẩu nhân viên.
            </p>
          </div>
          <div className="staff-invite-form">
            <label>
              Email
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="nhanvien@example.com"
              />
            </label>
            <label>
              Vai trò
              <select
                value={inviteRole}
                onChange={(event) => setInviteRole(event.target.value as typeof inviteRole)}
              >
                <option value="TECHNICIAN">Kỹ thuật viên</option>
                <option value="RECEPTIONIST">Lễ tân</option>
              </select>
            </label>
            <button
              className="button button-primary"
              disabled={busy === "invite"}
              onClick={() => void invite()}
            >
              {busy === "invite" ? "Đang tạo…" : "Tạo link mời"}
            </button>
          </div>
          {setupUrl && (
            <div className="setup-link-result">
              <label>
                Link thiết lập
                <input readOnly value={setupUrl} />
              </label>
              <button
                className="button button-secondary"
                onClick={() => void navigator.clipboard.writeText(setupUrl)}
              >
                Sao chép link
              </button>
            </div>
          )}
        </section>
      )}
      <section className="settings-card">
        <div className="staff-section-heading">
          <div>
            <h2>Danh sách nhân viên</h2>
            <p>
              {canManage
                ? "Thay đổi vai trò hoặc trạng thái sau khi xem lại tác động."
                : "Bạn có quyền xem danh sách; chỉ chủ cửa hàng được thay đổi."}
            </p>
          </div>
          <div className="staff-filters">
            <input
              aria-label="Tìm nhân viên"
              placeholder="Tên hoặc email"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <select
              aria-label="Lọc vai trò"
              value={roleFilter}
              onChange={(event) => setRoleFilter(event.target.value)}
            >
              <option value="">Mọi vai trò</option>
              <option value="OWNER">Chủ cửa hàng</option>
              <option value="RECEPTIONIST">Lễ tân</option>
              <option value="TECHNICIAN">Kỹ thuật viên</option>
            </select>
            <select
              aria-label="Lọc trạng thái"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            >
              <option value="">Mọi trạng thái</option>
              <option value="ACTIVE">Đang hoạt động</option>
              <option value="INACTIVE">Đã tắt</option>
            </select>
          </div>
        </div>
        {state === "loading" ? (
          <p aria-busy="true">Đang tải nhân viên…</p>
        ) : members.length === 0 ? (
          <p>Chưa có nhân viên phù hợp.</p>
        ) : (
          <div className="staff-card-list">
            {members.map((item) => (
              <article className="staff-member-card" key={item.userId}>
                <div>
                  <h3>
                    {item.displayName}
                    {item.userId === user.id ? " (Bạn)" : ""}
                  </h3>
                  <p>{item.email}</p>
                  <small>Tham gia: {dateTime(item.joinedAt)}</small>
                </div>
                <div className="staff-member-actions">
                  <label>
                    Vai trò
                    <select
                      disabled={!canManage || busy === item.userId}
                      value={item.role}
                      onChange={(event) =>
                        void updateMember(item, { role: event.target.value as MembershipRole })
                      }
                    >
                      <option value="OWNER">Chủ cửa hàng</option>
                      <option value="RECEPTIONIST">Lễ tân</option>
                      <option value="TECHNICIAN">Kỹ thuật viên</option>
                    </select>
                  </label>
                  <label>
                    Trạng thái
                    <select
                      disabled={!canManage || busy === item.userId}
                      value={item.status}
                      onChange={(event) =>
                        void updateMember(item, { status: event.target.value as MembershipStatus })
                      }
                    >
                      <option value="ACTIVE">Đang hoạt động</option>
                      <option value="INACTIVE">Đã tắt</option>
                    </select>
                  </label>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
      {canManage && (
        <section className="settings-card">
          <h2>Lời mời</h2>
          {invitations.length === 0 ? (
            <p>Không có lời mời nào.</p>
          ) : (
            <div className="staff-card-list">
              {invitations.map((item) => (
                <article className="staff-invitation-card" key={item.id}>
                  <div>
                    <strong>{item.email}</strong>
                    <p>
                      {item.role} · {item.status}
                    </p>
                    <small>Hết hạn: {dateTime(item.expiresAt)}</small>
                  </div>
                  {(item.status === "PENDING" || item.status === "EXPIRED") && (
                    <div className="inline-actions">
                      <button
                        className="button button-secondary"
                        disabled={busy === item.id}
                        onClick={() => void invitationAction(item, "reissue")}
                      >
                        Cấp link mới
                      </button>
                      {item.status === "PENDING" && (
                        <button
                          className="button button-danger"
                          disabled={busy === item.id}
                          onClick={() => void invitationAction(item, "revoke")}
                        >
                          Thu hồi
                        </button>
                      )}
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>
      )}
    </main>
  );
}
