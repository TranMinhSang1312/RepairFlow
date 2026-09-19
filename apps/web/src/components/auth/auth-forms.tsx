"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

import { RepairFlowApiError, safeErrorMessage } from "@/lib/api/errors";
import { useAuth } from "@/lib/auth/auth-provider";
import { safeStaffNext } from "@/lib/auth/safe-next";

type FieldErrors = Record<string, string>;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateLogin(email: string, password: string): FieldErrors {
  const errors: FieldErrors = {};
  if (!EMAIL_PATTERN.test(email.trim())) errors.email = "Nhập một địa chỉ email hợp lệ.";
  if (!password) errors.password = "Nhập mật khẩu.";
  return errors;
}

export function validateRegistration(input: {
  email: string;
  password: string;
  confirmPassword: string;
  displayName: string;
  shopName: string;
  branchName: string;
}): FieldErrors {
  const errors: FieldErrors = {};
  if (!EMAIL_PATTERN.test(input.email.trim()) || input.email.trim().length > 254) {
    errors.email = "Nhập email hợp lệ, tối đa 254 ký tự.";
  }
  if (input.password.length < 10 || input.password.length > 128) {
    errors.password = "Mật khẩu phải có từ 10 đến 128 ký tự.";
  }
  if (input.confirmPassword !== input.password) errors.confirmPassword = "Mật khẩu chưa khớp.";
  for (const [field, value, max] of [
    ["displayName", input.displayName, 100],
    ["shopName", input.shopName, 150],
    ["branchName", input.branchName, 150],
  ] as const) {
    if (!value.trim() || value.trim().length > max) {
      errors[field] = `Thông tin này bắt buộc và không quá ${max} ký tự.`;
    }
  }
  return errors;
}

function FieldError({ id, message }: { id: string; message: string | undefined }) {
  if (!message) return null;
  return (
    <span className="field-error" id={id}>
      {message}
    </span>
  );
}

function AuthCard({
  eyebrow,
  title,
  copy,
  children,
}: {
  eyebrow: string;
  title: string;
  copy: string;
  children: React.ReactNode;
}) {
  return (
    <main className="auth-shell">
      <section className="auth-intro">
        <Link className="brand" href="/">
          <span>R</span>RepairFlow
        </Link>
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          <p>{copy}</p>
        </div>
        <ul>
          <li>Một hồ sơ xuyên suốt cho từng thiết bị</li>
          <li>Lịch sử rõ ràng từ tiếp nhận đến bàn giao</li>
          <li>Dữ liệu cửa hàng được tách biệt theo tenant</li>
        </ul>
      </section>
      <section className="auth-card">{children}</section>
    </main>
  );
}

export function LoginForm({ next }: { next?: string | undefined }) {
  const auth = useAuth();
  const router = useRouter();
  const destination = safeStaffNext(next);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pageError, setPageError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (auth.status === "authenticated") router.replace(destination);
  }, [auth.status, destination, router]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const nextErrors = validateLogin(email, password);
    setErrors(nextErrors);
    setPageError("");
    if (Object.keys(nextErrors).length) return;
    setSubmitting(true);
    try {
      await auth.login({ email: email.trim(), password });
      router.replace(destination);
    } catch (error) {
      setPassword("");
      if (error instanceof RepairFlowApiError && error.code === "VALIDATION_FAILED") {
        setErrors(error.fieldErrors);
      } else if (error instanceof RepairFlowApiError && error.code === "RATE_LIMITED") {
        setPageError("Bạn đã thử quá nhiều lần. Vui lòng chờ rồi đăng nhập lại.");
      } else if (error instanceof RepairFlowApiError && error.code === "AUTH_REQUIRED") {
        setPageError("Email hoặc mật khẩu không đúng.");
      } else {
        setPageError(safeErrorMessage(error));
      }
      setSubmitting(false);
    }
  }

  return (
    <AuthCard
      eyebrow="Khu vực nhân viên"
      title="Đăng nhập"
      copy="Tiếp tục quản lý các phiếu sửa chữa của cửa hàng."
    >
      <form className="auth-form" onSubmit={(event) => void submit(event)} noValidate>
        <div>
          <h2>Chào mừng trở lại</h2>
          <p>Dùng tài khoản được cấp cho cửa hàng.</p>
        </div>
        {pageError && (
          <div className="notice notice-error" role="alert">
            {pageError}
          </div>
        )}
        <label className="field">
          <span>Email</span>
          <input
            aria-describedby={errors.email ? "login-email-error" : undefined}
            autoComplete="email"
            maxLength={254}
            onChange={(event) => setEmail(event.target.value)}
            type="email"
            value={email}
          />
          <FieldError id="login-email-error" message={errors.email} />
        </label>
        <label className="field">
          <span>Mật khẩu</span>
          <input
            aria-describedby={errors.password ? "login-password-error" : undefined}
            autoComplete="current-password"
            onChange={(event) => setPassword(event.target.value)}
            type="password"
            value={password}
          />
          <FieldError id="login-password-error" message={errors.password} />
        </label>
        <button
          className="button button-primary auth-submit"
          disabled={submitting || auth.status === "checking"}
          type="submit"
        >
          {submitting ? "Đang đăng nhập…" : "Đăng nhập"}
        </button>
        <p className="auth-switch">
          Chưa có cửa hàng? <Link href="/register">Đăng ký cửa hàng đầu tiên</Link>
        </p>
      </form>
    </AuthCard>
  );
}

export function RegisterOwnerForm() {
  const auth = useAuth();
  const router = useRouter();
  const [form, setForm] = useState({
    email: "",
    password: "",
    confirmPassword: "",
    displayName: "",
    shopName: "",
    branchName: "",
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pageError, setPageError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (auth.status === "authenticated") router.replace("/orders");
  }, [auth.status, router]);

  function update(field: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const nextErrors = validateRegistration(form);
    setErrors(nextErrors);
    setPageError("");
    if (Object.keys(nextErrors).length) return;
    setSubmitting(true);
    try {
      await auth.registerOwner({
        email: form.email.trim(),
        password: form.password,
        displayName: form.displayName.trim(),
        shopName: form.shopName.trim(),
        branchName: form.branchName.trim(),
      });
      router.replace("/orders");
    } catch (error) {
      setForm((current) => ({ ...current, password: "", confirmPassword: "" }));
      if (error instanceof RepairFlowApiError && error.code === "EMAIL_ALREADY_REGISTERED") {
        setErrors({ email: "Email này đã được đăng ký." });
      } else if (error instanceof RepairFlowApiError && error.code === "VALIDATION_FAILED") {
        setErrors(error.fieldErrors);
      } else if (error instanceof RepairFlowApiError && error.code === "RATE_LIMITED") {
        setPageError("Bạn thao tác quá nhanh. Vui lòng chờ rồi thử lại.");
      } else {
        setPageError(safeErrorMessage(error));
      }
      setSubmitting(false);
    }
  }

  return (
    <AuthCard
      eyebrow="Bắt đầu với RepairFlow"
      title="Tạo cửa hàng"
      copy="Tạo tài khoản owner, cửa hàng và chi nhánh đầu tiên trong một bước."
    >
      <form
        className="auth-form auth-form-register"
        onSubmit={(event) => void submit(event)}
        noValidate
      >
        <div>
          <h2>Thông tin khởi tạo</h2>
          <p>Múi giờ mặc định: Asia/Ho_Chi_Minh.</p>
        </div>
        {pageError && (
          <div className="notice notice-error" role="alert">
            {pageError}
          </div>
        )}
        {(
          [
            ["displayName", "Tên của bạn", "name", "text", 100],
            ["email", "Email", "email", "email", 254],
            ["shopName", "Tên cửa hàng", "organization", "text", 150],
            ["branchName", "Chi nhánh đầu tiên", "organization", "text", 150],
            ["password", "Mật khẩu", "new-password", "password", 128],
            ["confirmPassword", "Nhập lại mật khẩu", "new-password", "password", 128],
          ] as const
        ).map(([field, label, autocomplete, type, maxLength]) => (
          <label className="field" key={field}>
            <span>{label}</span>
            <input
              aria-describedby={errors[field] ? `register-${field}-error` : undefined}
              autoComplete={autocomplete}
              maxLength={maxLength}
              onChange={(event) => update(field, event.target.value)}
              type={type}
              value={form[field]}
            />
            <FieldError id={`register-${field}-error`} message={errors[field]} />
          </label>
        ))}
        <button
          className="button button-primary auth-submit"
          disabled={submitting || auth.status === "checking"}
          type="submit"
        >
          {submitting ? "Đang tạo cửa hàng…" : "Tạo cửa hàng"}
        </button>
        <p className="auth-switch">
          Đã có tài khoản? <Link href="/login">Đăng nhập</Link>
        </p>
      </form>
    </AuthCard>
  );
}
