/* eslint-disable @typescript-eslint/consistent-type-imports -- Nest constructor tokens are runtime values. */

import { HttpStatus, Injectable } from "@nestjs/common";
import {
  MembershipRole,
  MembershipStatus,
  Prisma,
  StaffInvitationStatus,
  UserStatus,
} from "@prisma/client";
import { randomUUID } from "node:crypto";
import type { Request } from "express";

import { ApiException } from "../../common/api-exception.js";
import { PasswordHasherService } from "../../common/auth/password-hasher.service.js";
import { RateLimiterService } from "../../common/auth/rate-limiter.service.js";
import { IdempotencyService } from "../../common/idempotency/idempotency.service.js";
import type { TenantContext } from "../../common/tenant/tenant-context.js";
import { PrismaService } from "../../infra/database/prisma.service.js";
import { IdentityService } from "../identity/identity.service.js";
import type { IssuedAuth } from "../identity/identity.types.js";
import type {
  AcceptNewStaffInvitationDto,
  CreateStaffInvitationDto,
  ListStaffMembershipsQueryDto,
  UpdateStaffMembershipDto,
  VersionedInvitationDto,
} from "./staff-membership.dto.js";
import {
  StaffInvitationTokenService,
  type StaffInvitationTokenMetadata,
} from "./staff-invitation-token.service.js";
import type {
  InvitationCommandView,
  PublicStaffInvitationView,
  StaffInvitationView,
  StaffMembershipView,
} from "./staff-membership.types.js";

const INVITATION_TTL_MS = 72 * 60 * 60 * 1000;
const PUBLIC_POLICY = { limit: 30, windowMs: 15 * 60 * 1000 } as const;
const ACCEPT_POLICY = { limit: 8, windowMs: 60 * 60 * 1000 } as const;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type StaffInvitationRecord = Prisma.StaffInvitationGetPayload<Record<string, never>>;

interface StoredInvitationCommand {
  invitation: StaffInvitationView;
  token: StaffInvitationTokenMetadata;
}

function normalizedEmail(value: string): string {
  return value.trim().toLowerCase();
}

function clientIp(request: Request): string {
  return request.ip || request.socket.remoteAddress || "unknown";
}

function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@", 2);
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${"*".repeat(Math.max(3, local.length - visible.length))}@${domain}`;
}

@Injectable()
export class StaffMembershipsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: IdempotencyService,
    private readonly tokens: StaffInvitationTokenService,
    private readonly passwordHasher: PasswordHasherService,
    private readonly identity: IdentityService,
    private readonly rateLimiter: RateLimiterService,
  ) {}

  async listMemberships(tenant: TenantContext, query: ListStaffMembershipsQueryDto) {
    const cursor = this.decodeCursor(query.cursor);
    const search = query.query?.trim();
    const rows = await this.prisma.shopMembership.findMany({
      where: {
        shopId: tenant.shopId,
        ...(query.role ? { role: query.role } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(search
          ? {
              user: {
                OR: [
                  { displayName: { contains: search, mode: "insensitive" } },
                  { email: { contains: search, mode: "insensitive" } },
                ],
              },
            }
          : {}),
        ...(cursor
          ? {
              OR: [
                { updatedAt: { lt: cursor.updatedAt } },
                { updatedAt: cursor.updatedAt, userId: { gt: cursor.userId } },
              ],
            }
          : {}),
      },
      include: { user: { select: { email: true, displayName: true } } },
      orderBy: [{ updatedAt: "desc" }, { userId: "asc" }],
      take: query.limit + 1,
    });
    const hasMore = rows.length > query.limit;
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      data: page.map((row) => this.membershipView(row)),
      meta: { nextCursor: hasMore && last ? this.encodeCursor(last.updatedAt, last.userId) : null },
    };
  }

  async listInvitations(tenant: TenantContext) {
    const now = new Date();
    await this.prisma.staffInvitation.updateMany({
      where: {
        shopId: tenant.shopId,
        status: StaffInvitationStatus.PENDING,
        expiresAt: { lte: now },
      },
      data: { status: StaffInvitationStatus.EXPIRED, lockVersion: { increment: 1 } },
    });
    const invitations = await this.prisma.staffInvitation.findMany({
      where: { shopId: tenant.shopId },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: 100,
    });
    return { data: invitations.map((item) => this.invitationView(item)) };
  }

  async createInvitation(
    tenant: TenantContext,
    dto: CreateStaffInvitationDto,
    key: string | undefined,
  ) {
    this.assertInvitableRole(dto.role);
    const email = normalizedEmail(dto.email);
    const stored = await this.idempotency.executeStored<StoredInvitationCommand>({
      tenant,
      scope: "staff-invitations.create",
      key,
      request: { email, role: dto.role },
      recordExpiresAt: (result) => new Date(result.token.expiresAt),
      operation: async (tx) => {
        await this.lockSlot(tx, tenant.shopId, email);
        const user = await tx.user.findUnique({ where: { email }, select: { id: true } });
        if (user) {
          const membership = await tx.shopMembership.findUnique({
            where: { shopId_userId: { shopId: tenant.shopId, userId: user.id } },
            select: { userId: true },
          });
          if (membership) throw this.membershipExists();
        }
        const pending = await tx.staffInvitation.findFirst({
          where: { shopId: tenant.shopId, email, status: StaffInvitationStatus.PENDING },
          select: { id: true, expiresAt: true },
        });
        if (pending && pending.expiresAt > new Date()) {
          throw new ApiException(
            HttpStatus.CONFLICT,
            "STAFF_INVITATION_ALREADY_PENDING",
            "A usable invitation already exists for this recipient.",
          );
        }
        if (pending) {
          await tx.staffInvitation.update({
            where: { id: pending.id },
            data: { status: StaffInvitationStatus.EXPIRED, lockVersion: { increment: 1 } },
          });
        }
        const metadata = this.newTokenMetadata();
        const invitation = await tx.staffInvitation.create({
          data: {
            id: metadata.invitationId,
            shopId: tenant.shopId,
            email,
            role: dto.role,
            tokenHash: this.tokens.hash(this.tokens.deriveRaw(metadata)),
            expiresAt: new Date(metadata.expiresAt),
            createdByUserId: tenant.userId,
          },
        });
        await this.audit(tx, tenant, "staff.invitation_created", invitation.id, null, {
          role: invitation.role,
          emailFingerprint: this.tokens.emailFingerprint(email),
        });
        return { invitation: this.invitationView(invitation), token: metadata };
      },
    });
    return { data: this.commandView(stored) };
  }

  async reissueInvitation(
    tenant: TenantContext,
    invitationId: string,
    dto: VersionedInvitationDto,
    key: string | undefined,
  ) {
    this.assertUuid(invitationId);
    const normalizedId = invitationId.toLowerCase();
    const stored = await this.idempotency.executeStored<StoredInvitationCommand>({
      tenant,
      scope: `staff-invitations.reissue:${normalizedId}`,
      key,
      request: { invitationId: normalizedId, expectedLockVersion: dto.expectedLockVersion },
      recordExpiresAt: (result) => new Date(result.token.expiresAt),
      operation: async (tx) => {
        await this.lockShop(tx, tenant.shopId);
        const current = await tx.staffInvitation.findFirst({
          where: { id: normalizedId, shopId: tenant.shopId },
        });
        if (!current) throw this.notFound();
        if (current.lockVersion !== dto.expectedLockVersion) throw this.concurrent();
        if (
          current.status !== StaffInvitationStatus.PENDING &&
          current.status !== StaffInvitationStatus.EXPIRED
        ) {
          throw this.invalidInvitation();
        }
        const now = new Date();
        if (current.status === StaffInvitationStatus.PENDING) {
          await tx.staffInvitation.update({
            where: { id: current.id },
            data: {
              status: StaffInvitationStatus.SUPERSEDED,
              supersededAt: now,
              lockVersion: { increment: 1 },
            },
          });
        }
        const metadata = this.newTokenMetadata();
        const invitation = await tx.staffInvitation.create({
          data: {
            id: metadata.invitationId,
            shopId: tenant.shopId,
            email: current.email,
            role: current.role,
            tokenHash: this.tokens.hash(this.tokens.deriveRaw(metadata)),
            expiresAt: new Date(metadata.expiresAt),
            createdByUserId: tenant.userId,
          },
        });
        await this.audit(
          tx,
          tenant,
          "staff.invitation_reissued",
          invitation.id,
          { invitationId: current.id },
          {
            role: invitation.role,
            emailFingerprint: this.tokens.emailFingerprint(invitation.email),
          },
        );
        return { invitation: this.invitationView(invitation), token: metadata };
      },
    });
    return { data: this.commandView(stored) };
  }

  async revokeInvitation(
    tenant: TenantContext,
    invitationId: string,
    dto: VersionedInvitationDto,
    key: string | undefined,
  ) {
    this.assertUuid(invitationId);
    const normalizedId = invitationId.toLowerCase();
    const response = await this.idempotency.executeStored<{ invitation: StaffInvitationView }>({
      tenant,
      scope: `staff-invitations.revoke:${normalizedId}`,
      key,
      request: { invitationId: normalizedId, expectedLockVersion: dto.expectedLockVersion },
      responseStatus: HttpStatus.OK,
      operation: async (tx) => {
        await this.lockShop(tx, tenant.shopId);
        const current = await tx.staffInvitation.findFirst({
          where: { id: normalizedId, shopId: tenant.shopId },
        });
        if (!current) throw this.notFound();
        if (current.lockVersion !== dto.expectedLockVersion) throw this.concurrent();
        if (current.status !== StaffInvitationStatus.PENDING) throw this.invalidInvitation();
        const invitation = await tx.staffInvitation.update({
          where: { id: current.id },
          data: {
            status: StaffInvitationStatus.REVOKED,
            revokedAt: new Date(),
            revokedByUserId: tenant.userId,
            lockVersion: { increment: 1 },
          },
        });
        await this.audit(
          tx,
          tenant,
          "staff.invitation_revoked",
          invitation.id,
          { role: current.role },
          { role: invitation.role },
        );
        return { invitation: this.invitationView(invitation) };
      },
    });
    return { data: response.invitation };
  }

  async updateMembership(
    tenant: TenantContext,
    userId: string,
    dto: UpdateStaffMembershipDto,
    key: string | undefined,
  ) {
    this.assertUuid(userId);
    this.assertMembershipMutation(dto);
    const normalizedUserId = userId.toLowerCase();
    const response = await this.idempotency.executeStored<{ membership: StaffMembershipView }>({
      tenant,
      scope: `staff-memberships.update:${normalizedUserId}`,
      key,
      request: {
        userId: normalizedUserId,
        role: dto.role ?? null,
        status: dto.status ?? null,
        expectedLockVersion: dto.expectedLockVersion,
      },
      responseStatus: HttpStatus.OK,
      operation: async (tx) => {
        await this.lockShop(tx, tenant.shopId);
        const current = await tx.shopMembership.findUnique({
          where: { shopId_userId: { shopId: tenant.shopId, userId: normalizedUserId } },
          include: { user: { select: { email: true, displayName: true } } },
        });
        if (!current) throw this.notFound();
        if (current.lockVersion !== dto.expectedLockVersion) throw this.concurrent();
        const role = dto.role ?? current.role;
        const status = dto.status ?? current.status;
        if (status === MembershipStatus.INVITED)
          throw this.validation("status", "INVITED_NOT_ALLOWED");
        if (
          current.role === MembershipRole.OWNER &&
          current.status === MembershipStatus.ACTIVE &&
          (role !== MembershipRole.OWNER || status !== MembershipStatus.ACTIVE)
        ) {
          const activeOwners = await tx.shopMembership.count({
            where: {
              shopId: tenant.shopId,
              role: MembershipRole.OWNER,
              status: MembershipStatus.ACTIVE,
            },
          });
          if (activeOwners <= 1) {
            throw new ApiException(
              HttpStatus.CONFLICT,
              "LAST_OWNER_REQUIRED",
              "At least one active owner must remain.",
            );
          }
        }
        if (role === current.role && status === current.status) {
          return { membership: this.membershipView(current) };
        }
        const changed = await tx.shopMembership.updateMany({
          where: {
            shopId: tenant.shopId,
            userId: normalizedUserId,
            lockVersion: dto.expectedLockVersion,
          },
          data: { role, status, lockVersion: { increment: 1 } },
        });
        if (changed.count !== 1) throw this.concurrent();
        const updated = await tx.shopMembership.findUniqueOrThrow({
          where: { shopId_userId: { shopId: tenant.shopId, userId: normalizedUserId } },
          include: { user: { select: { email: true, displayName: true } } },
        });
        const action =
          role !== current.role
            ? "staff.membership_role_changed"
            : status === MembershipStatus.ACTIVE
              ? "staff.membership_activated"
              : "staff.membership_deactivated";
        await this.audit(
          tx,
          tenant,
          action,
          normalizedUserId,
          { role: current.role, status: current.status },
          { role, status },
        );
        return { membership: this.membershipView(updated) };
      },
    });
    return { data: response.membership };
  }

  async inspectInvitation(rawToken: string | undefined, request: Request) {
    const token = this.validatedToken(rawToken);
    this.rateLimiter.assertAllowed(
      this.tokens.rateLimitKey(token, clientIp(request)),
      PUBLIC_POLICY,
    );
    const invitation = await this.findUsableInvitation(token);
    const existing = await this.prisma.user.findUnique({
      where: { email: invitation.email },
      select: { id: true },
    });
    const data: PublicStaffInvitationView = {
      shopName: invitation.shop.name,
      maskedEmail: maskEmail(invitation.email),
      role: invitation.role,
      expiresAt: invitation.expiresAt.toISOString(),
      acceptanceMode: existing ? "SIGN_IN" : "CREATE_ACCOUNT",
    };
    return { data };
  }

  async acceptNewInvitation(
    rawToken: string | undefined,
    dto: AcceptNewStaffInvitationDto,
    request: Request,
  ): Promise<IssuedAuth> {
    const token = this.validatedToken(rawToken);
    this.rateLimiter.assertAllowed(
      this.tokens.rateLimitKey(token, clientIp(request)),
      ACCEPT_POLICY,
    );
    const passwordHash = await this.passwordHasher.hash(dto.password);
    const tokenHash = this.tokens.hash(token);
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.lockToken(tx, tokenHash);
        const invitation = await tx.staffInvitation.findUnique({ where: { tokenHash } });
        this.assertAcceptable(invitation);
        const existing = await tx.user.findUnique({
          where: { email: invitation.email },
          select: { id: true },
        });
        if (existing) {
          throw new ApiException(
            HttpStatus.CONFLICT,
            "STAFF_INVITATION_SIGN_IN_REQUIRED",
            "Sign in with the invited account to continue.",
          );
        }
        const user = await tx.user.create({
          data: { email: invitation.email, displayName: dto.displayName, passwordHash },
        });
        await this.createAcceptedMembership(tx, invitation, user.id);
        await this.acceptInvitationRow(tx, invitation, user.id);
        await this.auditForInvitation(
          tx,
          invitation,
          "staff.invitation_accepted",
          user.id,
          request,
        );
        return this.identity.issueAuthForUser(user.id, request, tx);
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ApiException(
          HttpStatus.CONFLICT,
          "STAFF_INVITATION_SIGN_IN_REQUIRED",
          "Sign in with the invited account to continue.",
        );
      }
      throw error;
    }
  }

  async acceptExistingInvitation(rawToken: string | undefined, userId: string, request: Request) {
    const token = this.validatedToken(rawToken);
    this.rateLimiter.assertAllowed(
      this.tokens.rateLimitKey(token, clientIp(request)),
      ACCEPT_POLICY,
    );
    const tokenHash = this.tokens.hash(token);
    await this.prisma.$transaction(async (tx) => {
      await this.lockToken(tx, tokenHash);
      const invitation = await tx.staffInvitation.findUnique({ where: { tokenHash } });
      this.assertAcceptable(invitation);
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true, status: true },
      });
      if (!user || user.status !== UserStatus.ACTIVE) {
        throw new ApiException(
          HttpStatus.UNAUTHORIZED,
          "AUTH_REQUIRED",
          "Authentication is required.",
        );
      }
      if (normalizedEmail(user.email) !== invitation.email) {
        throw new ApiException(
          HttpStatus.FORBIDDEN,
          "STAFF_INVITATION_RECIPIENT_MISMATCH",
          "The signed-in account is not the invitation recipient.",
        );
      }
      await this.createAcceptedMembership(tx, invitation, user.id);
      await this.acceptInvitationRow(tx, invitation, user.id);
      await this.auditForInvitation(tx, invitation, "staff.invitation_accepted", user.id, request);
    });
    return this.identity.currentUser(userId);
  }

  private async createAcceptedMembership(
    tx: Prisma.TransactionClient,
    invitation: StaffInvitationRecord,
    userId: string,
  ) {
    const existing = await tx.shopMembership.findUnique({
      where: { shopId_userId: { shopId: invitation.shopId, userId } },
    });
    if (existing) throw this.membershipExists();
    await tx.shopMembership.create({
      data: {
        shopId: invitation.shopId,
        userId,
        role: invitation.role,
        status: MembershipStatus.ACTIVE,
        joinedAt: new Date(),
      },
    });
  }

  private async acceptInvitationRow(
    tx: Prisma.TransactionClient,
    invitation: StaffInvitationRecord,
    userId: string,
  ) {
    const updated = await tx.staffInvitation.updateMany({
      where: {
        id: invitation.id,
        status: StaffInvitationStatus.PENDING,
        lockVersion: invitation.lockVersion,
      },
      data: {
        status: StaffInvitationStatus.ACCEPTED,
        acceptedAt: new Date(),
        acceptedByUserId: userId,
        lockVersion: { increment: 1 },
      },
    });
    if (updated.count !== 1) throw this.concurrent();
  }

  private async findUsableInvitation(rawToken: string) {
    const invitation = await this.prisma.staffInvitation.findUnique({
      where: { tokenHash: this.tokens.hash(rawToken) },
      include: { shop: { select: { name: true } } },
    });
    this.assertAcceptable(invitation);
    return invitation;
  }

  private assertAcceptable(
    invitation: StaffInvitationRecord | null,
  ): asserts invitation is StaffInvitationRecord {
    if (!invitation) throw this.invalidInvitation();
    if (invitation.status === StaffInvitationStatus.ACCEPTED) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        "STAFF_INVITATION_ALREADY_ACCEPTED",
        "This invitation was already accepted.",
      );
    }
    if (invitation.status !== StaffInvitationStatus.PENDING) throw this.invalidInvitation();
    if (invitation.expiresAt <= new Date()) {
      throw new ApiException(
        HttpStatus.GONE,
        "STAFF_INVITATION_EXPIRED",
        "This invitation has expired.",
      );
    }
  }

  private newTokenMetadata(): StaffInvitationTokenMetadata {
    return {
      invitationId: randomUUID(),
      expiresAt: new Date(Date.now() + INVITATION_TTL_MS).toISOString(),
    };
  }

  private commandView(stored: StoredInvitationCommand): InvitationCommandView {
    return { ...stored.invitation, setupUrl: this.tokens.publicUrl(stored.token) };
  }

  private membershipView(row: {
    userId: string;
    role: MembershipRole;
    status: MembershipStatus;
    joinedAt: Date | null;
    updatedAt: Date;
    lockVersion: number;
    user: { email: string; displayName: string };
  }): StaffMembershipView {
    return {
      userId: row.userId,
      email: row.user.email,
      displayName: row.user.displayName,
      role: row.role,
      status: row.status,
      joinedAt: row.joinedAt?.toISOString() ?? null,
      updatedAt: row.updatedAt.toISOString(),
      lockVersion: row.lockVersion,
    };
  }

  private invitationView(item: StaffInvitationRecord): StaffInvitationView {
    return {
      id: item.id,
      email: item.email,
      role: item.role,
      status: item.status,
      expiresAt: item.expiresAt.toISOString(),
      createdAt: item.createdAt.toISOString(),
      lockVersion: item.lockVersion,
    };
  }

  private async audit(
    tx: Prisma.TransactionClient,
    tenant: TenantContext,
    action: string,
    entityId: string,
    beforeData: Prisma.InputJsonObject | null,
    afterData: Prisma.InputJsonObject | null,
  ) {
    await tx.auditLog.create({
      data: {
        shopId: tenant.shopId,
        actorUserId: tenant.userId,
        action,
        entityType: action.startsWith("staff.invitation_")
          ? "STAFF_INVITATION"
          : "STAFF_MEMBERSHIP",
        entityId,
        ...(beforeData ? { beforeData } : {}),
        ...(afterData ? { afterData } : {}),
        requestId: tenant.requestId,
      },
    });
  }

  private async auditForInvitation(
    tx: Prisma.TransactionClient,
    invitation: StaffInvitationRecord,
    action: string,
    userId: string,
    request: Request,
  ) {
    await tx.auditLog.create({
      data: {
        shopId: invitation.shopId,
        actorUserId: userId,
        action,
        entityType: "STAFF_INVITATION",
        entityId: invitation.id,
        afterData: {
          userId,
          role: invitation.role,
          emailFingerprint: this.tokens.emailFingerprint(invitation.email),
        },
        requestId: String(request.id ?? "unknown"),
      },
    });
  }

  private async lockShop(tx: Prisma.TransactionClient, shopId: string) {
    await tx.$queryRaw`SELECT "id" FROM "shops" WHERE "id" = ${shopId}::uuid FOR UPDATE`;
  }

  private async lockSlot(tx: Prisma.TransactionClient, shopId: string, email: string) {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${shopId}:${email}`}, 0))::text AS locked`;
  }

  private async lockToken(tx: Prisma.TransactionClient, tokenHash: string) {
    await tx.$queryRaw`SELECT "id" FROM "staff_invitations" WHERE "tokenHash" = ${tokenHash} FOR UPDATE`;
  }

  private validatedToken(token: string | undefined): string {
    if (!token || token.length < 32 || token.length > 256) throw this.invalidInvitation();
    return token;
  }

  private assertInvitableRole(role: MembershipRole) {
    if (role !== MembershipRole.RECEPTIONIST && role !== MembershipRole.TECHNICIAN) {
      throw this.validation("role", "INVITABLE_ROLE_REQUIRED");
    }
  }

  private assertMembershipMutation(dto: UpdateStaffMembershipDto) {
    if (dto.role === undefined && dto.status === undefined)
      throw this.validation("body", "CHANGE_REQUIRED");
    if (dto.status === MembershipStatus.INVITED)
      throw this.validation("status", "INVITED_NOT_ALLOWED");
  }

  private assertUuid(value: string) {
    if (!UUID_PATTERN.test(value)) throw this.notFound();
  }

  private encodeCursor(updatedAt: Date, userId: string): string {
    return Buffer.from(
      JSON.stringify({ updatedAt: updatedAt.toISOString(), userId }),
      "utf8",
    ).toString("base64url");
  }

  private decodeCursor(value?: string): { updatedAt: Date; userId: string } | null {
    if (!value) return null;
    try {
      const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as {
        updatedAt?: string;
        userId?: string;
      };
      const updatedAt = new Date(parsed.updatedAt ?? "");
      if (!parsed.userId || !UUID_PATTERN.test(parsed.userId) || Number.isNaN(updatedAt.getTime()))
        throw new Error("invalid");
      return { updatedAt, userId: parsed.userId.toLowerCase() };
    } catch {
      throw this.validation("cursor", "INVALID_CURSOR");
    }
  }

  private validation(field: string, code: string) {
    return new ApiException(
      HttpStatus.UNPROCESSABLE_ENTITY,
      "VALIDATION_FAILED",
      "One or more input fields are invalid.",
      [{ field, code }],
    );
  }

  private concurrent() {
    return new ApiException(
      HttpStatus.CONFLICT,
      "CONCURRENT_UPDATE",
      "The resource changed. Reload and try again.",
    );
  }

  private membershipExists() {
    return new ApiException(
      HttpStatus.CONFLICT,
      "STAFF_MEMBERSHIP_ALREADY_EXISTS",
      "This user already has a membership in the shop.",
    );
  }

  private invalidInvitation() {
    return new ApiException(
      HttpStatus.NOT_FOUND,
      "STAFF_INVITATION_INVALID",
      "The staff invitation is unavailable.",
    );
  }

  private notFound() {
    return new ApiException(HttpStatus.NOT_FOUND, "RESOURCE_NOT_FOUND", "Resource not found.");
  }
}
