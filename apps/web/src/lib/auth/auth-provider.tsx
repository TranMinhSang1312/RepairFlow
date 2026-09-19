"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { BrowserIntakeApi } from "@/lib/api/intake-api";
import type { CurrentUser, LoginInput, RegisterOwnerInput } from "@/lib/api/types";

export type SessionStatus = "checking" | "authenticated" | "anonymous" | "session-error";

interface AuthContextValue {
  status: SessionStatus;
  user: CurrentUser | null;
  api: BrowserIntakeApi;
  sessionError: string;
  login(input: LoginInput): Promise<void>;
  registerOwner(input: RegisterOwnerInput): Promise<void>;
  logout(): Promise<void>;
  retrySession(): Promise<void>;
  reloadCurrentUser(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>("checking");
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [sessionError, setSessionError] = useState("");
  const initialized = useRef(false);
  const [api] = useState(
    () =>
      new BrowserIntakeApi("/api/v1", fetch, {
        onSession(auth) {
          setUser(auth.user);
          setSessionError("");
          setStatus("authenticated");
        },
        onSessionExpired() {
          setUser(null);
          setSessionError("");
          setStatus("anonymous");
        },
      }),
  );

  const restore = useCallback(async () => {
    setStatus("checking");
    setSessionError("");
    try {
      await api.restoreSession();
    } catch (error) {
      const code = error instanceof Error && "code" in error ? String(error.code) : "";
      if (code === "SESSION_EXPIRED" || code === "AUTH_REQUIRED") {
        api.clearSession();
        return;
      }
      setSessionError("Không thể kiểm tra phiên làm việc. Hãy kiểm tra kết nối và thử lại.");
      setStatus("session-error");
    }
  }, [api]);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    void restore();
  }, [restore]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      api,
      sessionError,
      async login(input) {
        await api.login(input);
      },
      async registerOwner(input) {
        await api.registerOwner(input);
      },
      async logout() {
        await api.logout();
      },
      retrySession: restore,
      async reloadCurrentUser() {
        const currentUser = await api.getMe();
        setUser(currentUser);
      },
    }),
    [api, restore, sessionError, status, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}

export function useOptionalAuth(): AuthContextValue | null {
  return useContext(AuthContext);
}
