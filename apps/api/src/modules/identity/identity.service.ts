/* eslint-disable @typescript-eslint/consistent-type-imports -- Nest needs constructor tokens at runtime for DI. */

import { Injectable, HttpStatus } from "@nestjs/common";
import { MembershipRole, MembershipStatus, Prisma, UserStatus } from "@prisma/client";
import { parseApiEnvironment } from "@repairflow/config";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import type { Request } from "express";

import { ApiException } from "../../common/api-exception.js";
import { PasswordHasherService } from "../../common/auth/password-hasher.service.js";
import { RateLimiterService } from "../../common/auth/rate-limiter.service.js";
import { RefreshCookieService } from "../../common/auth/refresh-cookie.service.js";
import { TokenService } from "../../common/auth/token.service.js";
import { PrismaService } from "../../infra/database/prisma.service.js";
import type { LoginDto, RegisterOwnerDto } from "./identity.dto.js";
import {
  identityUserInclude,
  type AuthResponse,
  type CurrentUser,
  type IdentityUser,
  type IssuedAuth,
} from "./identity.types.js";

const ACCESS_FAILURE_MESSAGE = "Invalid email or password.";
const SESSION_FAILURE_MESSAGE = "The refresh session is invalid or expired.";
const REGISTER_POLICY = { limit: 5, windowMs: 60 * 60 * 1000 } as const;
const LOGIN_POLICY = { limit: 10, windowMs: 15 * 60 * 1000 } as const;
const LOGIN_IP_POLICY = { limit: 50, windowMs: 15 * 60 * 1000 } as const;
const REFRESH_POLICY = { limit: 20, windowMs: 15 * 60 * 1000 } as const;

export type IdentityDbClient = PrismaService | Prisma.TransactionClient;
type RefreshResult = { kind: "expired" | "reused" } | { kind: "issued"; issued: IssuedAuth };

function normalizedEmail(email: string): string {
  return email.trim().toLowerCase();
}

function slugBase(value: string): string {
  const base = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return base || "repair-shop";
}

function clientIp(request: Request): string {
  return request.ip || request.socket.remoteAddress || "unknown";
}

@Injectable()
export class IdentityService {
  private readonly privacyKey = parseApiEnvironment(process.env).ACCESS_TOKEN_SECRET;

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordHasher: PasswordHasherService,
    private readonly tokenService: TokenService,
    private readonly refreshCookieService: RefreshCookieService,
    private readonly rateLimiter: RateLimiterService,
  ) {}

  async registerOwner(dto: RegisterOwnerDto, request: Request): Promise<IssuedAuth> {
    this.rateLimiter.assertAllowed(`register:${clientIp(request)}`, REGISTER_POLICY);
    const email = normalizedEmail(dto.email);
    const passwordHash = await this.passwordHasher.hash(dto.password);
    const shopSlug = `${slugBase(dto.shopName)}-${randomUUID().replaceAll("-", "")}`;

    try {
      return await this.prisma.$transaction(async (tx) => {
        const existing = await tx.user.findUnique({ where: { email } });
        if (existing) {
          throw new ApiException(
            HttpStatus.CONFLICT,
            "EMAIL_ALREADY_REGISTERED",
            "This email is already registered.",
          );
        }

        const shop = await tx.shop.create({
          data: {
            name: dto.shopName,
            slug: shopSlug,
            ...(dto.timezone ? { timezone: dto.timezone } : {}),
          },
        });
        await tx.branch.create({
          data: {
            shopId: shop.id,
            name: dto.branchName,
          },
        });
        const user = await tx.user.create({
          data: {
            email,
            passwordHash,
            displayName: dto.displayName,
          },
        });
        await tx.shopMembership.create({
          data: {
            shopId: shop.id,
            userId: user.id,
            role: MembershipRole.OWNER,
            status: MembershipStatus.ACTIVE,
            joinedAt: new Date(),
          },
        });

        const identityUser = await tx.user.findUniqueOrThrow({
          where: { id: user.id },
          include: identityUserInclude,
        });
        return this.issueAuth(identityUser, request, tx);
      });
    } catch (error) {
      if (error instanceof ApiException) {
        throw error;
      }

      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const rawTarget = error.meta?.target;
        const target = Array.isArray(rawTarget)
          ? rawTarget.map(String)
          : typeof rawTarget === "string"
            ? [rawTarget]
            : [];
        if (target.some((value) => value.toLowerCase().includes("email"))) {
          throw new ApiException(
            HttpStatus.CONFLICT,
            "EMAIL_ALREADY_REGISTERED",
            "This email is already registered.",
          );
        }
        if (target.some((value) => value.toLowerCase().includes("slug"))) {
          throw new ApiException(
            HttpStatus.CONFLICT,
            "CONCURRENT_UPDATE",
            "The shop identifier is already in use. Please try again.",
          );
        }
      }

      throw error;
    }
  }

  async login(dto: LoginDto, request: Request): Promise<IssuedAuth> {
    const email = normalizedEmail(dto.email);
    const ip = clientIp(request);
    this.rateLimiter.assertAllowed(`login-ip:${ip}`, LOGIN_IP_POLICY);
    this.rateLimiter.assertAllowed(
      `login-account:${ip}:${this.hashPrivateValue(email)}`,
      LOGIN_POLICY,
    );
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: identityUserInclude,
    });
    const validPassword = user
      ? await this.passwordHasher.verify(dto.password, user.passwordHash)
      : await this.passwordHasher.verifyAgainstDummy(dto.password);

    if (!user || user.status !== UserStatus.ACTIVE || !validPassword) {
      throw new ApiException(HttpStatus.UNAUTHORIZED, "AUTH_REQUIRED", ACCESS_FAILURE_MESSAGE);
    }

    return this.issueAuth(user, request, this.prisma);
  }

  async refresh(refreshToken: string | null, request: Request): Promise<IssuedAuth> {
    this.rateLimiter.assertAllowed(`refresh:${clientIp(request)}`, REFRESH_POLICY);
    if (!refreshToken) {
      throw this.sessionExpired();
    }

    const refreshTokenHash = this.hashRefreshToken(refreshToken);
    const result = await this.prisma.$transaction<RefreshResult>(async (tx) => {
      const session = await tx.authSession.findUnique({
        where: { refreshTokenHash },
        include: { user: { include: identityUserInclude } },
      });
      const now = new Date();

      if (!session) {
        return { kind: "expired" };
      }

      if (session.revokedAt) {
        await tx.authSession.updateMany({
          where: { familyId: session.familyId, revokedAt: null },
          data: { revokedAt: now },
        });
        return { kind: "reused" };
      }

      if (session.user.status !== UserStatus.ACTIVE) {
        await tx.authSession.updateMany({
          where: { userId: session.userId, revokedAt: null },
          data: { revokedAt: now },
        });
        return { kind: "expired" };
      }

      if (session.expiresAt <= now) {
        return { kind: "expired" };
      }

      const revoked = await tx.authSession.updateMany({
        where: { id: session.id, revokedAt: null },
        data: { revokedAt: now },
      });
      if (revoked.count !== 1) {
        await tx.authSession.updateMany({
          where: { familyId: session.familyId, revokedAt: null },
          data: { revokedAt: now },
        });
        return { kind: "reused" };
      }

      const nextRefreshToken = this.createRefreshToken();
      const issued = await this.issueAuth(
        session.user,
        request,
        tx,
        nextRefreshToken,
        session.familyId,
      );
      return { kind: "issued", issued };
    });

    if (result.kind !== "issued") {
      throw this.sessionExpired();
    }

    return result.issued;
  }

  async logout(userId: string, refreshToken: string | null): Promise<void> {
    if (!refreshToken) {
      throw this.sessionExpired();
    }

    const session = await this.prisma.authSession.findUnique({
      where: { refreshTokenHash: this.hashRefreshToken(refreshToken) },
    });
    if (
      !session ||
      session.userId !== userId ||
      session.revokedAt ||
      session.expiresAt <= new Date()
    ) {
      throw this.sessionExpired();
    }

    await this.prisma.authSession.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });
  }

  async currentUser(userId: string): Promise<{ data: CurrentUser }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: identityUserInclude,
    });
    if (!user || user.status !== UserStatus.ACTIVE) {
      throw new ApiException(
        HttpStatus.UNAUTHORIZED,
        "AUTH_REQUIRED",
        "Authentication is required.",
      );
    }

    return { data: this.toCurrentUser(user) };
  }

  async issueAuthForUser(
    userId: string,
    request: Request,
    db: IdentityDbClient,
  ): Promise<IssuedAuth> {
    const user = await db.user.findUnique({
      where: { id: userId },
      include: identityUserInclude,
    });
    if (!user || user.status !== UserStatus.ACTIVE) {
      throw new ApiException(
        HttpStatus.UNAUTHORIZED,
        "AUTH_REQUIRED",
        "Authentication is required.",
      );
    }
    return this.issueAuth(user, request, db);
  }

  private async issueAuth(
    user: IdentityUser,
    request: Request,
    db: IdentityDbClient,
    refreshToken = this.createRefreshToken(),
    familyId?: string,
  ): Promise<IssuedAuth> {
    await this.createSession(db, user.id, refreshToken, request, familyId);
    const accessToken = this.tokenService.createAccessToken(user.id);
    const response: AuthResponse = {
      data: {
        accessToken: accessToken.token,
        expiresInSeconds: accessToken.expiresInSeconds,
        user: this.toCurrentUser(user),
      },
    };

    return { response, refreshToken };
  }

  private async createSession(
    db: IdentityDbClient,
    userId: string,
    refreshToken: string,
    request: Request,
    familyId?: string,
  ): Promise<void> {
    const userAgent = request.get("user-agent")?.slice(0, 500);
    await db.authSession.create({
      data: {
        userId,
        refreshTokenHash: this.hashRefreshToken(refreshToken),
        ...(familyId ? { familyId } : {}),
        ...(userAgent ? { userAgent } : {}),
        ipHash: this.hashIp(clientIp(request)),
        expiresAt: new Date(Date.now() + this.refreshCookieService.ttlSeconds * 1000),
      },
    });
  }

  private createRefreshToken(): string {
    return randomBytes(48).toString("base64url");
  }

  private hashRefreshToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }

  private hashIp(ip: string): string {
    return this.hashPrivateValue(`session-ip:${ip}`);
  }

  private hashPrivateValue(value: string): string {
    return createHmac("sha256", this.privacyKey).update(value).digest("hex");
  }

  private sessionExpired(): ApiException {
    return new ApiException(HttpStatus.UNAUTHORIZED, "SESSION_EXPIRED", SESSION_FAILURE_MESSAGE);
  }

  private toCurrentUser(user: IdentityUser): CurrentUser {
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      memberships: user.memberships.map((membership) => ({
        shopId: membership.shopId,
        shopName: membership.shop.name,
        role: membership.role,
        status: membership.status,
        timezone: membership.shop.timezone,
        intakePhotoMinimum: membership.shop.intakePhotoMinimum,
        branches:
          membership.status === MembershipStatus.ACTIVE
            ? membership.shop.branches.map((branch) => ({
                id: branch.id,
                name: branch.name,
              }))
            : [],
      })),
    };
  }
}
