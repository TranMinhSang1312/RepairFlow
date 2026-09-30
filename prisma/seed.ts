import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";
import {
  ActorType,
  AiCapability,
  DeviceType,
  MembershipRole,
  MembershipStatus,
  PrismaClient,
  RepairOrderStatus,
  UserStatus,
} from "@prisma/client";
import { createHash, scryptSync } from "node:crypto";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is required to seed RepairFlow.");
}

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

function demoPasswordHash(password: string): string {
  const salt = createHash("sha256").update(`repairflow-demo:${password}`).digest().subarray(0, 16);
  const derived = scryptSync(password, salt, 64, { N: 16_384, r: 8, p: 1 });
  return ["scrypt", 16_384, 8, 1, salt.toString("base64url"), derived.toString("base64url")].join(
    "$",
  );
}

async function seed(): Promise<void> {
  const shop = await prisma.shop.upsert({
    where: { slug: "repairflow-demo" },
    update: {},
    create: {
      name: "RepairFlow Demo",
      slug: "repairflow-demo",
      orderCodePrefix: "RFD",
      contactPhone: "0900000000",
    },
  });

  await prisma.branch.upsert({
    where: {
      shopId_name: {
        shopId: shop.id,
        name: "Chi nhánh chính",
      },
    },
    update: {},
    create: {
      shopId: shop.id,
      name: "Chi nhánh chính",
      address: "Dữ liệu minh họa, không phải địa chỉ thật",
    },
  });

  await prisma.qcTemplate.upsert({
    where: {
      shopId_normalizedName_versionNo: {
        shopId: shop.id,
        normalizedName: "kiểm tra thiết bị cơ bản",
        versionNo: 1,
      },
    },
    // Published QC versions are immutable. A replay may encounter a newer active
    // version, so the seed must never reactivate or rewrite version 1.
    update: {},
    create: {
      shopId: shop.id,
      name: "Kiểm tra thiết bị cơ bản",
      normalizedName: "kiểm tra thiết bị cơ bản",
      versionNo: 1,
      items: {
        create: [
          {
            label: "Thiết bị khởi động ổn định",
            isRequired: true,
            allowNa: false,
            sortOrder: 1,
          },
          {
            label: "Sạc và kết nối nguồn bình thường",
            isRequired: true,
            allowNa: false,
            sortOrder: 2,
          },
          {
            label: "Ngoại quan sau sửa đã được kiểm tra",
            isRequired: true,
            allowNa: false,
            sortOrder: 3,
          },
        ],
      },
    },
  });

  for (const capability of Object.values(AiCapability)) {
    await prisma.aiCapabilitySetting.upsert({
      where: { shopId_capability: { shopId: shop.id, capability } },
      update: {},
      create: {
        shopId: shop.id,
        capability,
        enabled: false,
        monthlyBudgetMicrousd: 0n,
        maxRunCostMicrousd: 0n,
      },
    });
  }

  await seedDemoFixtures(shop.id);
}

async function seedDemoFixtures(shopId: string): Promise<void> {
  const isolationShop = await prisma.shop.upsert({
    where: { slug: "repairflow-isolation" },
    update: {},
    create: {
      name: "RepairFlow Isolation Fixture",
      slug: "repairflow-isolation",
      orderCodePrefix: "ISO",
    },
  });
  const isolationBranch = await prisma.branch.upsert({
    where: { shopId_name: { shopId: isolationShop.id, name: "Isolation" } },
    update: {},
    create: { shopId: isolationShop.id, name: "Isolation" },
  });
  const mainBranch = await prisma.branch.findFirstOrThrow({
    where: { shopId, isActive: true },
    orderBy: { createdAt: "asc" },
  });
  const users = [
    {
      email: "owner@repairflow.demo",
      displayName: "RepairFlow Owner",
      role: MembershipRole.OWNER,
      status: MembershipStatus.ACTIVE,
      userStatus: UserStatus.ACTIVE,
    },
    {
      email: "receptionist@repairflow.demo",
      displayName: "RepairFlow Receptionist",
      role: MembershipRole.RECEPTIONIST,
      status: MembershipStatus.ACTIVE,
      userStatus: UserStatus.ACTIVE,
    },
    {
      email: "technician@repairflow.demo",
      displayName: "RepairFlow Technician",
      role: MembershipRole.TECHNICIAN,
      status: MembershipStatus.ACTIVE,
      userStatus: UserStatus.ACTIVE,
    },
    {
      email: "inactive@repairflow.demo",
      displayName: "RepairFlow Inactive",
      role: MembershipRole.RECEPTIONIST,
      status: MembershipStatus.INACTIVE,
      userStatus: UserStatus.ACTIVE,
    },
  ] as const;
  const createdUsers = new Map<string, string>();
  for (const fixture of users) {
    const user = await prisma.user.upsert({
      where: { email: fixture.email },
      update: {
        displayName: fixture.displayName,
        passwordHash: demoPasswordHash("RepairFlow-demo-2026!"),
        status: fixture.userStatus,
      },
      create: {
        email: fixture.email,
        displayName: fixture.displayName,
        passwordHash: demoPasswordHash("RepairFlow-demo-2026!"),
        status: fixture.userStatus,
      },
    });
    createdUsers.set(fixture.email, user.id);
    await prisma.shopMembership.upsert({
      where: { shopId_userId: { shopId, userId: user.id } },
      update: {
        role: fixture.role,
        status: fixture.status,
        joinedAt:
          fixture.status === MembershipStatus.ACTIVE ? new Date("2026-01-01T00:00:00.000Z") : null,
      },
      create: {
        shopId,
        userId: user.id,
        role: fixture.role,
        status: fixture.status,
        joinedAt:
          fixture.status === MembershipStatus.ACTIVE ? new Date("2026-01-01T00:00:00.000Z") : null,
      },
    });
  }

  const customer = await prisma.customer.upsert({
    where: { shopId_id: { shopId, id: "00000000-0000-4000-8000-000000000101" } },
    update: {},
    create: {
      id: "00000000-0000-4000-8000-000000000101",
      shopId,
      name: "Khách hàng demo",
      phoneRaw: "0900000001",
      phoneNormalized: "+84900000001",
      email: "customer@repairflow.demo",
      notes: "Fixture không chứa dữ liệu thật.",
    },
  });
  const device = await prisma.device.upsert({
    where: { shopId_id: { shopId, id: "00000000-0000-4000-8000-000000000102" } },
    update: {},
    create: {
      id: "00000000-0000-4000-8000-000000000102",
      shopId,
      customerId: customer.id,
      type: DeviceType.PHONE,
      brand: "RepairFlow",
      model: "Demo Phone",
      color: "Đen",
      serialNormalized: "DEMO0001",
      imeiNormalized: "860000000000001",
      notes: "Thiết bị fixture.",
    },
  });
  const ownerId = createdUsers.get("owner@repairflow.demo")!;
  const order = await prisma.repairOrder.upsert({
    where: { shopId_code: { shopId, code: "RFD-1001" } },
    update: {},
    create: {
      shopId,
      branchId: mainBranch.id,
      customerId: customer.id,
      deviceId: device.id,
      orderNo: 1001,
      code: "RFD-1001",
      status: RepairOrderStatus.RECEIVED,
      reportedProblem: "Không bật nguồn (fixture)",
      intakeCondition: "Ngoại quan nguyên vẹn (fixture)",
      consentAcknowledgedAt: new Date("2026-01-01T00:00:00.000Z"),
      createdByUserId: ownerId,
      customerSnapshot: { name: customer.name, phone: customer.phoneRaw, email: customer.email },
      deviceSnapshot: {
        type: device.type,
        brand: device.brand,
        model: device.model,
        color: device.color,
      },
    },
  });
  const existingEvent = await prisma.orderEvent.findFirst({
    where: { shopId, repairOrderId: order.id, requestId: "seed-demo" },
  });
  if (!existingEvent) {
    await prisma.orderEvent.create({
      data: {
        shopId,
        repairOrderId: order.id,
        eventType: "INTAKE_RECEIVED",
        toStatus: RepairOrderStatus.RECEIVED,
        actorType: ActorType.USER,
        actorUserId: ownerId,
        publicPayload: { message: "Đã tiếp nhận thiết bị." },
        requestId: "seed-demo",
      },
    });
  }
  await prisma.shopMembership.upsert({
    where: { shopId_userId: { shopId: isolationShop.id, userId: ownerId } },
    update: { role: MembershipRole.OWNER, status: MembershipStatus.ACTIVE },
    create: {
      shopId: isolationShop.id,
      userId: ownerId,
      role: MembershipRole.OWNER,
      status: MembershipStatus.ACTIVE,
      joinedAt: new Date("2026-01-01T00:00:00.000Z"),
    },
  });
  void isolationBranch;
}

seed()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exitCode = 1;
  });
