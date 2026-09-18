import { Injectable } from "@nestjs/common";
import { parseApiEnvironment } from "@repairflow/config";
import { parseCookie, stringifySetCookie } from "cookie";
import type { Request, Response } from "express";

const REFRESH_TTL_SECONDS = 60 * 60 * 24 * 30;

@Injectable()
export class RefreshCookieService {
  private readonly cookieName: string;
  private readonly secure: boolean;

  constructor() {
    const environment = parseApiEnvironment(process.env);
    this.cookieName = environment.REFRESH_COOKIE_NAME;
    this.secure = environment.NODE_ENV === "production";
  }

  read(request: Request): string | null {
    const header = request.headers.cookie;
    if (!header) {
      return null;
    }

    return parseCookie(header)[this.cookieName] ?? null;
  }

  set(response: Response, token: string): void {
    response.setHeader(
      "Set-Cookie",
      stringifySetCookie({
        name: this.cookieName,
        value: token,
        httpOnly: true,
        secure: this.secure,
        sameSite: "lax",
        path: "/api/v1/auth",
        maxAge: REFRESH_TTL_SECONDS,
      }),
    );
  }

  clear(response: Response): void {
    response.setHeader(
      "Set-Cookie",
      stringifySetCookie({
        name: this.cookieName,
        value: "",
        httpOnly: true,
        secure: this.secure,
        sameSite: "lax",
        path: "/api/v1/auth",
        maxAge: 0,
      }),
    );
  }

  get ttlSeconds(): number {
    return REFRESH_TTL_SECONDS;
  }
}
