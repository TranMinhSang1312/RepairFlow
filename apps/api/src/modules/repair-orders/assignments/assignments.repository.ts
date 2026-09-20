/* eslint-disable @typescript-eslint/consistent-type-imports -- Nest needs PrismaService at runtime for DI. */

import { Injectable } from "@nestjs/common";
import { ActorType, MembershipRole, MembershipStatus, Prisma, UserStatus } from "@prisma/client";

import type { TenantContext } from "../../../common/tenant/tenant-context.js";
import { PrismaService } from "../../../infra/database/prisma.service.js";

const assignmentInclude = {
  technician: { select: { user: { select: { displayName: true } } } },
} satisfies Prisma.AssignmentInclude;

@Injectable()
export class AssignmentsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listAssignableTechnicians(shopId: string) {
    const memberships = await this.prisma.shopMembership.findMany({
      where: {
        shopId,
        role: MembershipRole.TECHNICIAN,
        status: MembershipStatus.ACTIVE,
        user: { status: UserStatus.ACTIVE },
      },
      select: { userId: true, user: { select: { displayName: true } } },
      orderBy: [{ user: { displayName: "asc" } }, { userId: "asc" }],
    });
    return memberships.map((membership) => ({
      userId: membership.userId,
      displayName: membership.user.displayName,
    }));
  }

  assign(tenant: TenantContext, repairOrderId: string, technicianUserId: string) {
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${`${tenant.shopId}:${repairOrderId}`}, 0)
        )::text AS locked
      `;

      const [order, technician, current] = await Promise.all([
        transaction.repairOrder.findFirst({
          where: { shopId: tenant.shopId, id: repairOrderId },
          select: { id: true },
        }),
        transaction.shopMembership.findFirst({
          where: {
            shopId: tenant.shopId,
            userId: technicianUserId,
            role: MembershipRole.TECHNICIAN,
            status: MembershipStatus.ACTIVE,
            user: { status: UserStatus.ACTIVE },
          },
          select: { userId: true },
        }),
        transaction.assignment.findFirst({
          where: { shopId: tenant.shopId, repairOrderId, unassignedAt: null },
          include: assignmentInclude,
        }),
      ]);

      if (!order || !technician) return null;
      if (current?.technicianUserId === technicianUserId) return current;

      const assignedAt = new Date();
      if (current) {
        await transaction.assignment.update({
          where: { id: current.id },
          data: { unassignedAt: assignedAt },
        });
      }

      const assignment = await transaction.assignment.create({
        data: {
          shopId: tenant.shopId,
          repairOrderId,
          technicianUserId,
          assignedByUserId: tenant.userId,
          assignedAt,
        },
        include: assignmentInclude,
      });

      await transaction.orderEvent.create({
        data: {
          shopId: tenant.shopId,
          repairOrderId,
          eventType: current ? "TECHNICIAN_REASSIGNED" : "TECHNICIAN_ASSIGNED",
          actorType: ActorType.USER,
          actorUserId: tenant.userId,
          publicPayload: { message: "A technician was assigned." },
          privatePayload: {
            technicianUserId,
            previousTechnicianUserId: current?.technicianUserId ?? null,
          },
          requestId: tenant.requestId,
        },
      });

      return assignment;
    });
  }
}
