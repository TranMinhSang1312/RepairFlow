import { DeviceType, MembershipRole, MembershipStatus } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaService } from "../src/infra/database/prisma.service.js";

describe("assignment persistence constraints", () => {
  let prisma: PrismaService;

  beforeAll(() => {
    prisma = new PrismaService();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("allows assignment history but rejects two active assignments for one order", async () => {
    const suffix = randomUUID();
    const userIds: string[] = [];
    let shopId: string | undefined;

    try {
      const users = await Promise.all(
        ["Owner", "First Technician", "Second Technician"].map((displayName, index) =>
          prisma.user.create({
            data: {
              email: `rf030-${index}-${suffix}@example.com`,
              passwordHash: "test-only",
              displayName,
            },
          }),
        ),
      );
      const owner = users[0]!;
      const firstTechnician = users[1]!;
      const secondTechnician = users[2]!;
      userIds.push(owner.id, firstTechnician.id, secondTechnician.id);

      const shop = await prisma.shop.create({
        data: { name: `RF-030 ${suffix}`, slug: `rf-030-${suffix}` },
      });
      shopId = shop.id;
      const branch = await prisma.branch.create({
        data: { shopId: shop.id, name: "Main" },
      });
      await prisma.shopMembership.createMany({
        data: [
          {
            shopId: shop.id,
            userId: owner.id,
            role: MembershipRole.OWNER,
            status: MembershipStatus.ACTIVE,
          },
          {
            shopId: shop.id,
            userId: firstTechnician.id,
            role: MembershipRole.TECHNICIAN,
            status: MembershipStatus.ACTIVE,
          },
          {
            shopId: shop.id,
            userId: secondTechnician.id,
            role: MembershipRole.TECHNICIAN,
            status: MembershipStatus.ACTIVE,
          },
        ],
      });
      const customer = await prisma.customer.create({
        data: {
          shopId: shop.id,
          name: "Constraint Customer",
          phoneRaw: "0900000030",
          phoneNormalized: "+84900000030",
        },
      });
      const device = await prisma.device.create({
        data: {
          shopId: shop.id,
          customerId: customer.id,
          type: DeviceType.PHONE,
          brand: "Test",
          model: "Constraint",
        },
      });
      const order = await prisma.repairOrder.create({
        data: {
          shopId: shop.id,
          branchId: branch.id,
          customerId: customer.id,
          deviceId: device.id,
          orderNo: 1,
          code: "RF-000001",
          reportedProblem: "Constraint test",
          intakeCondition: "Constraint test",
          consentAcknowledgedAt: new Date(),
          customerSnapshot: { name: customer.name, phone: customer.phoneRaw },
          deviceSnapshot: { type: device.type, brand: device.brand, model: device.model },
          createdByUserId: owner.id,
        },
      });

      const firstAssignment = await prisma.assignment.create({
        data: {
          shopId: shop.id,
          repairOrderId: order.id,
          technicianUserId: firstTechnician.id,
          assignedByUserId: owner.id,
        },
      });

      await expect(
        prisma.assignment.create({
          data: {
            shopId: shop.id,
            repairOrderId: order.id,
            technicianUserId: secondTechnician.id,
            assignedByUserId: owner.id,
          },
        }),
      ).rejects.toMatchObject({ code: "P2002" });

      await prisma.assignment.update({
        where: { id: firstAssignment.id },
        data: { unassignedAt: new Date() },
      });
      const replacement = await prisma.assignment.create({
        data: {
          shopId: shop.id,
          repairOrderId: order.id,
          technicianUserId: secondTechnician.id,
          assignedByUserId: owner.id,
        },
      });

      expect(replacement.technicianUserId).toBe(secondTechnician.id);
      expect(await prisma.assignment.count({ where: { repairOrderId: order.id } })).toBe(2);
      expect(
        await prisma.assignment.count({
          where: { repairOrderId: order.id, unassignedAt: null },
        }),
      ).toBe(1);
    } finally {
      if (shopId) {
        await prisma.assignment.deleteMany({ where: { shopId } });
        await prisma.repairOrder.deleteMany({ where: { shopId } });
        await prisma.device.deleteMany({ where: { shopId } });
        await prisma.customer.deleteMany({ where: { shopId } });
        await prisma.shopMembership.deleteMany({ where: { shopId } });
        await prisma.branch.deleteMany({ where: { shopId } });
        await prisma.shop.deleteMany({ where: { id: shopId } });
      }
      if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
  });
});
