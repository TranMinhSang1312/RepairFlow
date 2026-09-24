import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  DeviceType,
  MembershipRole,
  MembershipStatus,
  QcRunResult,
  RepairOrderStatus,
} from "@prisma/client";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AppModule } from "../src/app.module.js";
import { configureApplication } from "../src/application.js";
import { TokenService } from "../src/common/auth/token.service.js";
import { PrismaService } from "../src/infra/database/prisma.service.js";

interface Fixture {
  shopAId: string;
  shopBId: string;
  ownerAId: string;
  ownerBId: string;
  orderAId: string;
  ownerAToken: string;
  ownerBToken: string;
  receptionistToken: string;
  technicianToken: string;
  inactiveToken: string;
  userIds: string[];
}

const validItems = [
  { label: "Final visual inspection", isRequired: true, allowNa: false, sortOrder: 3 },
  { label: "Power-on test", isRequired: true, allowNa: false, sortOrder: 1 },
  { label: "Optional connectivity test", isRequired: false, allowNa: true, sortOrder: 2 },
];

describe("versioned QC template API", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let fixture: Fixture;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ bufferLogs: true });
    configureApplication(app);
    await app.init();
    prisma = app.get(PrismaService);
    const tokenService = app.get(TokenService);
    const suffix = randomUUID().slice(0, 8);

    const [shopA, shopB] = await Promise.all([
      prisma.shop.create({ data: { name: `QC A ${suffix}`, slug: `qc-a-${suffix}` } }),
      prisma.shop.create({ data: { name: `QC B ${suffix}`, slug: `qc-b-${suffix}` } }),
    ]);
    const [branchA, customerA] = await Promise.all([
      prisma.branch.create({ data: { shopId: shopA.id, name: "Main A" } }),
      prisma.customer.create({
        data: {
          shopId: shopA.id,
          name: "QC Customer",
          phoneRaw: "0900000099",
          phoneNormalized: "+84900000099",
        },
      }),
    ]);
    const deviceA = await prisma.device.create({
      data: {
        shopId: shopA.id,
        customerId: customerA.id,
        type: DeviceType.LAPTOP,
        brand: "Test",
        model: "QC",
      },
    });

    const userSpecs = [
      ["Owner A", MembershipRole.OWNER, MembershipStatus.ACTIVE, shopA.id],
      ["Receptionist A", MembershipRole.RECEPTIONIST, MembershipStatus.ACTIVE, shopA.id],
      ["Technician A", MembershipRole.TECHNICIAN, MembershipStatus.ACTIVE, shopA.id],
      ["Inactive A", MembershipRole.TECHNICIAN, MembershipStatus.INACTIVE, shopA.id],
      ["Owner B", MembershipRole.OWNER, MembershipStatus.ACTIVE, shopB.id],
    ] as const;
    const users = await Promise.all(
      userSpecs.map(([displayName], index) =>
        prisma.user.create({
          data: {
            email: `rf044-${index}-${suffix}@example.com`,
            passwordHash: "test-only",
            displayName,
          },
        }),
      ),
    );
    await prisma.shopMembership.createMany({
      data: userSpecs.map(([, role, status, shopId], index) => ({
        shopId,
        userId: users[index]!.id,
        role,
        status,
      })),
    });
    const order = await prisma.repairOrder.create({
      data: {
        shopId: shopA.id,
        branchId: branchA.id,
        customerId: customerA.id,
        deviceId: deviceA.id,
        orderNo: 1,
        code: `QC-${suffix}`,
        status: RepairOrderStatus.QUALITY_CHECK,
        reportedProblem: "QC fixture",
        intakeCondition: "Test condition",
        consentAcknowledgedAt: new Date(),
        customerSnapshot: { name: "QC Customer", phone: "0900000099" },
        deviceSnapshot: { type: DeviceType.LAPTOP, brand: "Test", model: "QC" },
        createdByUserId: users[0]!.id,
      },
    });

    fixture = {
      shopAId: shopA.id,
      shopBId: shopB.id,
      ownerAId: users[0]!.id,
      ownerBId: users[4]!.id,
      orderAId: order.id,
      ownerAToken: tokenService.createAccessToken(users[0]!.id).token,
      receptionistToken: tokenService.createAccessToken(users[1]!.id).token,
      technicianToken: tokenService.createAccessToken(users[2]!.id).token,
      inactiveToken: tokenService.createAccessToken(users[3]!.id).token,
      ownerBToken: tokenService.createAccessToken(users[4]!.id).token,
      userIds: users.map((user) => user.id),
    };
  });

  afterAll(async () => {
    const shopIds = [fixture.shopAId, fixture.shopBId];
    await prisma.qcResult.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.qcRun.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.idempotencyRecord.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.auditLog.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.qcTemplateItem.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.qcTemplate.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.orderEvent.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.repairOrder.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.device.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.customer.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.shopMembership.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.branch.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.shop.deleteMany({ where: { id: { in: shopIds } } });
    await prisma.user.deleteMany({ where: { id: { in: fixture.userIds } } });
    await app.close();
  });

  function api(token = fixture.ownerAToken, shopId = fixture.shopAId) {
    return {
      list: (includeInactive?: boolean) => {
        const call = request(app.getHttpServer())
          .get("/api/v1/qc-templates")
          .set("Authorization", `Bearer ${token}`)
          .set("X-Shop-Id", shopId);
        return includeInactive === undefined
          ? call
          : call.query({ includeInactive: String(includeInactive) });
      },
      publish: (body: object, key = `qc-publish-${randomUUID()}`) =>
        request(app.getHttpServer())
          .post("/api/v1/qc-templates")
          .set("Authorization", `Bearer ${token}`)
          .set("X-Shop-Id", shopId)
          .set("Idempotency-Key", key)
          .send(body),
      deactivate: (id: string, key = `qc-deactivate-${randomUUID()}`) =>
        request(app.getHttpServer())
          .post(`/api/v1/qc-templates/${id}/deactivate`)
          .set("Authorization", `Bearer ${token}`)
          .set("X-Shop-Id", shopId)
          .set("Idempotency-Key", key),
    };
  }

  it("publishes immutable versions, orders items, lists history, and deactivates", async () => {
    const family = `Laptop Safety ${randomUUID().slice(0, 8)}`;
    const first = await api()
      .publish({ name: family, items: validItems })
      .set("X-Request-Id", "req-rf044-publish")
      .expect(201);
    expect(first.body.data).toMatchObject({ name: family, versionNo: 1, isActive: true });
    expect(first.body.data.items.map((item: { sortOrder: number }) => item.sortOrder)).toEqual([
      1, 2, 3,
    ]);
    expect(first.body.data.items[1]).toMatchObject({ isRequired: false, allowNa: true });

    const secondItems = [
      { label: "Updated power test", isRequired: true, allowNa: false, sortOrder: 1 },
    ];
    const second = await api()
      .publish({ name: `  ${family.toUpperCase()}  `, items: secondItems })
      .expect(201);
    expect(second.body.data).toMatchObject({ versionNo: 2, isActive: true });

    const active = await api().list().expect(200);
    const activeFamily = active.body.data.filter((template: { id: string }) =>
      [first.body.data.id, second.body.data.id].includes(template.id),
    );
    expect(activeFamily).toEqual([second.body.data]);

    const history = await api().list(true).expect(200);
    expect(
      history.body.data
        .filter((template: { id: string }) =>
          [first.body.data.id, second.body.data.id].includes(template.id),
        )
        .map((template: { versionNo: number; isActive: boolean }) => ({
          versionNo: template.versionNo,
          isActive: template.isActive,
        })),
    ).toEqual([
      { versionNo: 2, isActive: true },
      { versionNo: 1, isActive: false },
    ]);

    const deactivated = await api().deactivate(second.body.data.id).expect(200);
    expect(deactivated.body.data.isActive).toBe(false);
    await api()
      .deactivate(second.body.data.id)
      .expect(409)
      .expect(({ body }) => {
        expect(body.error.code).toBe("QC_TEMPLATE_INACTIVE");
      });
    const audits = await prisma.auditLog.findMany({
      where: { shopId: fixture.shopAId, entityType: "QC_TEMPLATE", entityId: second.body.data.id },
      orderBy: { createdAt: "asc" },
    });
    expect(audits.map((entry) => entry.action)).toEqual([
      "QC_TEMPLATE_PUBLISHED",
      "QC_TEMPLATE_DEACTIVATED",
    ]);
    expect(audits[0]?.requestId).toBeTruthy();
  });

  it("lets every active staff role read active templates and limits history and management", async () => {
    const name = `Role template ${randomUUID().slice(0, 8)}`;
    await api().publish({ name, items: validItems }).expect(201);
    await api(fixture.receptionistToken).list().expect(200);
    await api(fixture.technicianToken).list().expect(200);
    await api(fixture.receptionistToken).list(true).expect(403);
    await api(fixture.technicianToken).list(true).expect(403);
    await api(fixture.receptionistToken)
      .publish({ name: `${name} denied`, items: validItems })
      .expect(403);
    await api(fixture.technicianToken)
      .publish({ name: `${name} denied tech`, items: validItems })
      .expect(403);
    const active = await prisma.qcTemplate.findFirstOrThrow({
      where: { shopId: fixture.shopAId, name },
    });
    await api(fixture.receptionistToken).deactivate(active.id).expect(403);
    await api(fixture.technicianToken).deactivate(active.id).expect(403);
    await api(fixture.inactiveToken).list().expect(403);
  });

  it("keeps list, publish, and deactivate tenant scoped", async () => {
    const foreign = await api(fixture.ownerBToken, fixture.shopBId)
      .publish({ name: `Foreign ${randomUUID().slice(0, 8)}`, items: validItems })
      .expect(201);
    const ownList = await api().list(true).expect(200);
    expect(ownList.body.data.map((entry: { id: string }) => entry.id)).not.toContain(
      foreign.body.data.id,
    );
    await api().deactivate(foreign.body.data.id).expect(404);
    await api(fixture.ownerAToken, fixture.shopBId).list().expect(404);
    await api(fixture.ownerAToken, fixture.shopBId)
      .publish({ name: "Cross-tenant publish", items: validItems })
      .expect(404);
    expect(
      await prisma.qcTemplate.findUnique({ where: { id: foreign.body.data.id } }),
    ).toMatchObject({ isActive: true });
  });

  it("rejects invalid names, items, positions, and query flags", async () => {
    const cases: object[] = [
      { name: "   ", items: validItems },
      { name: "x".repeat(201), items: validItems },
      { name: "No items", items: [] },
      {
        name: "Blank item",
        items: [{ label: "   ", isRequired: true, allowNa: false, sortOrder: 1 }],
      },
      {
        name: "Oversized item",
        items: [{ label: "x".repeat(501), isRequired: true, allowNa: false, sortOrder: 1 }],
      },
      {
        name: "Duplicate positions",
        items: [
          { label: "A", isRequired: true, allowNa: false, sortOrder: 1 },
          { label: "B", isRequired: true, allowNa: true, sortOrder: 1 },
        ],
      },
      {
        name: "Position zero",
        items: [{ label: "A", isRequired: true, allowNa: false, sortOrder: 0 }],
      },
      {
        name: "Position overflow",
        items: [{ label: "A", isRequired: true, allowNa: false, sortOrder: 2_147_483_648 }],
      },
    ];
    for (const body of cases) {
      await api().publish(body).expect(422);
    }
    const duplicate = await api().publish(cases[5]!).expect(422);
    expect(duplicate.body.error.details).toContainEqual(
      expect.objectContaining({ field: "items.sortOrder", code: "DUPLICATE_POSITION" }),
    );
    await request(app.getHttpServer())
      .get("/api/v1/qc-templates?includeInactive=maybe")
      .set("Authorization", `Bearer ${fixture.ownerAToken}`)
      .set("X-Shop-Id", fixture.shopAId)
      .expect(422);
    await request(app.getHttpServer())
      .post("/api/v1/qc-templates")
      .set("Authorization", `Bearer ${fixture.ownerAToken}`)
      .set("X-Shop-Id", fixture.shopAId)
      .send({ name: "Missing idempotency key", items: validItems })
      .expect(422)
      .expect(({ body }) => expect(body.error.code).toBe("VALIDATION_FAILED"));

    const databaseFamily = `database-position-${randomUUID().slice(0, 8)}`;
    await expect(
      prisma.qcTemplate.create({
        data: {
          shopId: fixture.shopAId,
          name: databaseFamily,
          normalizedName: databaseFamily,
          versionNo: 1,
          items: {
            create: [
              { label: "A", isRequired: true, allowNa: false, sortOrder: 1 },
              { label: "B", isRequired: true, allowNa: false, sortOrder: 1 },
            ],
          },
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("normalizes NFKC, whitespace, and case into one sequential family", async () => {
    const suffix = randomUUID().slice(0, 8);
    const first = await api()
      .publish({ name: `  Ｌaptop\tCheck ${suffix}  `, items: validItems })
      .expect(201);
    const second = await api()
      .publish({ name: `laptop   check ${suffix}`, items: validItems })
      .expect(201);
    expect([first.body.data.versionNo, second.body.data.versionNo]).toEqual([1, 2]);
    const persisted = await prisma.qcTemplate.findMany({
      where: { id: { in: [first.body.data.id, second.body.data.id] } },
      orderBy: { versionNo: "asc" },
    });
    expect(new Set(persisted.map((entry) => entry.normalizedName)).size).toBe(1);
    expect(persisted.map((entry) => entry.isActive)).toEqual([false, true]);
  });

  it("allocates concurrent versions safely and keeps one active version", async () => {
    const name = `Concurrent ${randomUUID().slice(0, 8)}`;
    await api().publish({ name, items: validItems }).expect(201);
    const [left, right] = await Promise.all([
      api().publish({ name: name.toUpperCase(), items: validItems }),
      api().publish({ name: ` ${name} `, items: validItems }),
    ]);
    expect([left.status, right.status]).toEqual([201, 201]);
    const versions = await prisma.qcTemplate.findMany({
      where: { shopId: fixture.shopAId, normalizedName: name.toLowerCase() },
      orderBy: { versionNo: "asc" },
    });
    expect(versions.map((entry) => entry.versionNo)).toEqual([1, 2, 3]);
    expect(versions.filter((entry) => entry.isActive)).toHaveLength(1);
    await expect(
      prisma.qcTemplate.create({
        data: {
          shopId: fixture.shopAId,
          name,
          normalizedName: name.toLowerCase(),
          versionNo: 4,
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("replays idempotent commands and rejects payload mismatch", async () => {
    const name = `Idempotent ${randomUUID().slice(0, 8)}`;
    const key = `qc-idempotency-${randomUUID()}`;
    const first = await api().publish({ name, items: validItems }, key).expect(201);
    const replay = await api().publish({ name, items: validItems }, key).expect(201);
    expect(replay.body).toEqual(first.body);
    await api()
      .publish({ name, items: [{ ...validItems[0], label: "Changed" }] }, key)
      .expect(409)
      .expect(({ body }) => expect(body.error.code).toBe("IDEMPOTENCY_KEY_REUSED"));

    const deactivateKey = `qc-deactivate-replay-${randomUUID()}`;
    const deactivated = await api().deactivate(first.body.data.id, deactivateKey).expect(200);
    const deactivateReplay = await api().deactivate(first.body.data.id, deactivateKey).expect(200);
    expect(deactivateReplay.body).toEqual(deactivated.body);
  });

  it("keeps referenced inactive history unchanged and readable", async () => {
    const name = `Referenced ${randomUUID().slice(0, 8)}`;
    const first = await api().publish({ name, items: validItems }).expect(201);
    await prisma.qcRun.create({
      data: {
        shopId: fixture.shopAId,
        repairOrderId: fixture.orderAId,
        qcTemplateId: first.body.data.id,
        runNo: 1,
        result: QcRunResult.PASS,
        checkedByUserId: fixture.ownerAId,
      },
    });
    await api()
      .publish({
        name,
        items: [{ label: "Replacement item", isRequired: true, allowNa: false, sortOrder: 1 }],
      })
      .expect(201);
    const history = await api().list(true).expect(200);
    const historical = history.body.data.find(
      (entry: { id: string }) => entry.id === first.body.data.id,
    );
    expect(historical).toEqual({ ...first.body.data, isActive: false });
    await expect(
      prisma.qcRun.findFirst({
        where: { shopId: fixture.shopAId, qcTemplateId: first.body.data.id },
      }),
    ).resolves.toMatchObject({ qcTemplateId: first.body.data.id });
  });

  it("rolls back prior deactivation when new-version persistence fails", async () => {
    const name = `Rollback ${randomUUID().slice(0, 8)}`;
    const first = await api().publish({ name, items: validItems }).expect(201);
    const auditCountBefore = await prisma.auditLog.count({
      where: { shopId: fixture.shopAId, entityType: "QC_TEMPLATE" },
    });
    const functionName = `rf044_fail_template_${randomUUID().replaceAll("-", "").slice(0, 8)}`;
    const triggerName = `${functionName}_trigger`;
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION "${functionName}"() RETURNS trigger AS $$
      BEGIN
        IF NEW."normalizedName" = '${name.toLowerCase()}' AND NEW."versionNo" > 1 THEN
          RAISE EXCEPTION 'forced RF-044 template failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER "${triggerName}"
      BEFORE INSERT ON "qc_templates"
      FOR EACH ROW EXECUTE FUNCTION "${functionName}"();
    `);

    try {
      await api().publish({ name, items: validItems }).expect(500);
      const rows = await prisma.qcTemplate.findMany({
        where: { shopId: fixture.shopAId, normalizedName: name.toLowerCase() },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ id: first.body.data.id, versionNo: 1, isActive: true });
      expect(
        await prisma.auditLog.count({
          where: { shopId: fixture.shopAId, entityType: "QC_TEMPLATE" },
        }),
      ).toBe(auditCountBefore);
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${triggerName}" ON "qc_templates";`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${functionName}"();`);
    }
  });
});
