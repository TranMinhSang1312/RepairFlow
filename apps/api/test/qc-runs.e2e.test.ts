import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  CompletionOutcome,
  DeviceType,
  MediaPurpose,
  MembershipRole,
  MembershipStatus,
  QcItemResult,
  QcRunResult,
  RepairOrderStatus,
} from "@prisma/client";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AppModule } from "../src/app.module.js";
import { configureApplication } from "../src/application.js";
import { TokenService } from "../src/common/auth/token.service.js";
import {
  OBJECT_STORAGE,
  type ObjectStoragePort,
  type PresignPutInput,
  type StoredObjectMetadata,
} from "../src/infra/object-storage/object-storage.port.js";
import { PrismaService } from "../src/infra/database/prisma.service.js";

class FakeObjectStorage implements ObjectStoragePort {
  readonly objects = new Map<string, StoredObjectMetadata>();

  presignPut(input: PresignPutInput): Promise<string> {
    return Promise.resolve(
      `https://storage.test/upload/${encodeURIComponent(input.objectKey)}?signature=test`,
    );
  }

  head(objectKey: string): Promise<StoredObjectMetadata | null> {
    return Promise.resolve(this.objects.get(objectKey) ?? null);
  }

  delete(objectKey: string): Promise<void> {
    this.objects.delete(objectKey);
    return Promise.resolve();
  }
}

interface Fixture {
  shopAId: string;
  shopBId: string;
  branchAId: string;
  branchBId: string;
  customerAId: string;
  customerBId: string;
  deviceAId: string;
  deviceBId: string;
  ownerAId: string;
  ownerBId: string;
  technicianAId: string;
  ownerAToken: string;
  ownerBToken: string;
  receptionistToken: string;
  technicianToken: string;
  otherTechnicianToken: string;
  inactiveToken: string;
  userIds: string[];
}

interface TemplateFixture {
  id: string;
  items: Array<{ id: string; sortOrder: number; isRequired: boolean; allowNa: boolean }>;
}

interface QcResultPayload {
  qcTemplateItemId: string;
  result: QcItemResult;
  note: string | null;
  evidenceMediaAssetIds: string[];
}

describe("append-only QC run and readiness API", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let fixture: Fixture;
  let nextOrderNo = 1;
  const storage = new FakeObjectStorage();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(OBJECT_STORAGE)
      .useValue(storage)
      .compile();
    app = moduleRef.createNestApplication({ bufferLogs: true });
    configureApplication(app);
    await app.init();
    prisma = app.get(PrismaService);
    const tokenService = app.get(TokenService);
    const suffix = randomUUID().slice(0, 8);

    const [shopA, shopB] = await Promise.all([
      prisma.shop.create({ data: { name: `QC run A ${suffix}`, slug: `qc-run-a-${suffix}` } }),
      prisma.shop.create({ data: { name: `QC run B ${suffix}`, slug: `qc-run-b-${suffix}` } }),
    ]);
    const [branchA, branchB, customerA, customerB] = await Promise.all([
      prisma.branch.create({ data: { shopId: shopA.id, name: "Main A" } }),
      prisma.branch.create({ data: { shopId: shopB.id, name: "Main B" } }),
      prisma.customer.create({
        data: {
          shopId: shopA.id,
          name: "QC customer A",
          phoneRaw: "0900000101",
          phoneNormalized: "+84900000101",
        },
      }),
      prisma.customer.create({
        data: {
          shopId: shopB.id,
          name: "QC customer B",
          phoneRaw: "0900000102",
          phoneNormalized: "+84900000102",
        },
      }),
    ]);
    const [deviceA, deviceB] = await Promise.all([
      prisma.device.create({
        data: {
          shopId: shopA.id,
          customerId: customerA.id,
          type: DeviceType.LAPTOP,
          brand: "Test",
          model: "A",
        },
      }),
      prisma.device.create({
        data: {
          shopId: shopB.id,
          customerId: customerB.id,
          type: DeviceType.PHONE,
          brand: "Test",
          model: "B",
        },
      }),
    ]);

    const userSpecs = [
      ["Owner A", MembershipRole.OWNER, MembershipStatus.ACTIVE, shopA.id],
      ["Receptionist A", MembershipRole.RECEPTIONIST, MembershipStatus.ACTIVE, shopA.id],
      ["Technician A", MembershipRole.TECHNICIAN, MembershipStatus.ACTIVE, shopA.id],
      ["Other technician", MembershipRole.TECHNICIAN, MembershipStatus.ACTIVE, shopA.id],
      ["Inactive technician", MembershipRole.TECHNICIAN, MembershipStatus.INACTIVE, shopA.id],
      ["Owner B", MembershipRole.OWNER, MembershipStatus.ACTIVE, shopB.id],
    ] as const;
    const users = await Promise.all(
      userSpecs.map(([displayName], index) =>
        prisma.user.create({
          data: {
            email: `rf045-${index}-${suffix}@example.com`,
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

    fixture = {
      shopAId: shopA.id,
      shopBId: shopB.id,
      branchAId: branchA.id,
      branchBId: branchB.id,
      customerAId: customerA.id,
      customerBId: customerB.id,
      deviceAId: deviceA.id,
      deviceBId: deviceB.id,
      ownerAId: users[0]!.id,
      ownerBId: users[5]!.id,
      technicianAId: users[2]!.id,
      ownerAToken: tokenService.createAccessToken(users[0]!.id).token,
      receptionistToken: tokenService.createAccessToken(users[1]!.id).token,
      technicianToken: tokenService.createAccessToken(users[2]!.id).token,
      otherTechnicianToken: tokenService.createAccessToken(users[3]!.id).token,
      inactiveToken: tokenService.createAccessToken(users[4]!.id).token,
      ownerBToken: tokenService.createAccessToken(users[5]!.id).token,
      userIds: users.map((user) => user.id),
    };
  });

  afterAll(async () => {
    const shopIds = [fixture.shopAId, fixture.shopBId];
    await prisma.qcResultEvidence.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.qcResult.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.qcRun.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.idempotencyRecord.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.auditLog.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.orderEvent.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.mediaAsset.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.assignment.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.repairOrder.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.qcTemplateItem.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.qcTemplate.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.device.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.customer.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.shopMembership.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.branch.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.shop.deleteMany({ where: { id: { in: shopIds } } });
    await prisma.user.deleteMany({ where: { id: { in: fixture.userIds } } });
    await app.close();
  });

  async function createOrder(options?: {
    shop?: "A" | "B";
    status?: RepairOrderStatus;
    assigned?: boolean;
    lockVersion?: number;
  }): Promise<string> {
    const shopA = options?.shop !== "B";
    const shopId = shopA ? fixture.shopAId : fixture.shopBId;
    const orderNo = nextOrderNo++;
    const order = await prisma.repairOrder.create({
      data: {
        shopId,
        branchId: shopA ? fixture.branchAId : fixture.branchBId,
        customerId: shopA ? fixture.customerAId : fixture.customerBId,
        deviceId: shopA ? fixture.deviceAId : fixture.deviceBId,
        orderNo,
        code: `QC-RUN-${shopA ? "A" : "B"}-${orderNo}`,
        status: options?.status ?? RepairOrderStatus.QUALITY_CHECK,
        lockVersion: options?.lockVersion ?? 0,
        reportedProblem: "QC integration test",
        intakeCondition: "Test condition",
        consentAcknowledgedAt: new Date(),
        customerSnapshot: { name: "QC customer", phone: "0900000000" },
        deviceSnapshot: { type: DeviceType.LAPTOP, brand: "Test", model: "QC" },
        createdByUserId: shopA ? fixture.ownerAId : fixture.ownerBId,
      },
    });
    if (shopA && options?.assigned) {
      await prisma.assignment.create({
        data: {
          shopId,
          repairOrderId: order.id,
          technicianUserId: fixture.technicianAId,
          assignedByUserId: fixture.ownerAId,
        },
      });
    }
    return order.id;
  }

  async function createTemplate(options?: {
    shop?: "A" | "B";
    active?: boolean;
    name?: string;
  }): Promise<TemplateFixture> {
    const shopId = options?.shop === "B" ? fixture.shopBId : fixture.shopAId;
    const name = options?.name ?? `QC template ${randomUUID()}`;
    return prisma.qcTemplate.create({
      data: {
        shopId,
        name,
        normalizedName: name.toLowerCase(),
        versionNo: 1,
        isActive: options?.active ?? true,
        items: {
          create: [
            { label: "Required startup", isRequired: true, allowNa: false, sortOrder: 1 },
            { label: "Required optional path", isRequired: true, allowNa: true, sortOrder: 2 },
            { label: "Optional connectivity", isRequired: false, allowNa: true, sortOrder: 3 },
          ],
        },
      },
      include: { items: { orderBy: { sortOrder: "asc" } } },
    });
  }

  function validResults(template: TemplateFixture): QcResultPayload[] {
    return template.items.map((item) => ({
      qcTemplateItemId: item.id,
      result: item.sortOrder === 3 ? QcItemResult.NOT_APPLICABLE : QcItemResult.PASS,
      note: null,
      evidenceMediaAssetIds: [],
    }));
  }

  function submit(
    orderId: string,
    body: object,
    options?: { token?: string; shopId?: string; key?: string },
  ) {
    return request(app.getHttpServer())
      .post(`/api/v1/repair-orders/${orderId}/qc-runs`)
      .set("Authorization", `Bearer ${options?.token ?? fixture.ownerAToken}`)
      .set("X-Shop-Id", options?.shopId ?? fixture.shopAId)
      .set("Idempotency-Key", options?.key ?? `qc-run-${randomUUID()}`)
      .send(body);
  }

  function transition(orderId: string, body: object, token = fixture.ownerAToken) {
    return request(app.getHttpServer())
      .post(`/api/v1/repair-orders/${orderId}/transition`)
      .set("Authorization", `Bearer ${token}`)
      .set("X-Shop-Id", fixture.shopAId)
      .set("Idempotency-Key", `qc-ready-${randomUUID()}`)
      .send(body);
  }

  async function presignEvidence(
    orderId: string,
    purpose: MediaPurpose = MediaPurpose.QC,
    token = fixture.ownerAToken,
  ): Promise<string> {
    const response = await request(app.getHttpServer())
      .post(`/api/v1/repair-orders/${orderId}/media/presign`)
      .set("Authorization", `Bearer ${token}`)
      .set("X-Shop-Id", fixture.shopAId)
      .send({
        purpose,
        originalName: "qc-evidence.jpg",
        mimeType: "image/jpeg",
        byteSize: 1024,
      })
      .expect(201);
    return response.body.data.mediaAssetId as string;
  }

  async function completeUpload(mediaAssetId: string): Promise<void> {
    const asset = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: mediaAssetId } });
    storage.objects.set(asset.objectKey, {
      byteSize: asset.byteSize,
      mimeType: asset.mimeType,
      checksumSha256: asset.checksumSha256,
    });
  }

  it("derives PASS, advances lock version, maps history, and enables a separate ready transition", async () => {
    const orderId = await createOrder({ assigned: true });
    const template = await createTemplate();
    const response = await submit(orderId, {
      qcTemplateId: template.id,
      expectedLockVersion: 0,
      notes: "All checks completed",
      results: validResults(template),
    })
      .set("X-Request-Id", "req-rf045-pass")
      .expect(201);

    expect(response.body.data).toMatchObject({
      orderStatus: RepairOrderStatus.QUALITY_CHECK,
      orderLockVersion: 1,
      run: {
        repairOrderId: orderId,
        qcTemplateId: template.id,
        templateVersionNo: 1,
        runNo: 1,
        result: QcRunResult.PASS,
        checkedByUserId: fixture.ownerAId,
      },
    });
    expect(
      response.body.data.run.results.map(
        (result: { labelSnapshot: string }) => result.labelSnapshot,
      ),
    ).toEqual(["Required startup", "Required optional path", "Optional connectivity"]);

    const detail = await request(app.getHttpServer())
      .get(`/api/v1/repair-orders/${orderId}`)
      .set("Authorization", `Bearer ${fixture.receptionistToken}`)
      .set("X-Shop-Id", fixture.shopAId)
      .expect(200);
    expect(detail.body.data.qcRuns).toEqual([response.body.data.run]);

    const ready = await transition(orderId, {
      targetStatus: RepairOrderStatus.READY_FOR_PICKUP,
      completionOutcome: CompletionOutcome.REPAIRED,
      expectedLockVersion: 1,
    }).expect(200);
    expect(ready.body.data).toMatchObject({
      status: RepairOrderStatus.READY_FOR_PICKUP,
      completionOutcome: CompletionOutcome.REPAIRED,
      lockVersion: 2,
    });
  });

  it("derives FAIL for an assigned technician and returns to repair atomically", async () => {
    const orderId = await createOrder({ assigned: true });
    const template = await createTemplate();
    const results = validResults(template);
    results[0]!.result = QcItemResult.FAIL;
    results[0]!.note = "Internal connector observation";
    const response = await submit(
      orderId,
      {
        qcTemplateId: template.id,
        expectedLockVersion: 0,
        notes: "Connector still fails under load",
        results,
      },
      { token: fixture.technicianToken },
    ).expect(201);

    expect(response.body.data).toMatchObject({
      orderStatus: RepairOrderStatus.REPAIRING,
      orderLockVersion: 1,
      run: { runNo: 1, result: QcRunResult.FAIL },
    });
    const order = await prisma.repairOrder.findUniqueOrThrow({ where: { id: orderId } });
    expect(order).toMatchObject({ status: RepairOrderStatus.REPAIRING, lockVersion: 1 });
    const events = await prisma.orderEvent.findMany({ where: { repairOrderId: orderId } });
    expect(events.map((event) => event.eventType)).toEqual(
      expect.arrayContaining(["ORDER_STATUS_CHANGED", "QC_COMPLETED"]),
    );
    expect(JSON.stringify(events.map((event) => event.publicPayload))).not.toContain(
      "Connector still fails",
    );
    expect(JSON.stringify(events.map((event) => event.publicPayload))).not.toContain(
      "Internal connector",
    );
  });

  it("enforces owner, technician assignment, receptionist, and inactive membership rules", async () => {
    const assignedOrder = await createOrder({ assigned: true });
    const template = await createTemplate();
    await submit(
      assignedOrder,
      { qcTemplateId: template.id, expectedLockVersion: 0, results: validResults(template) },
      { token: fixture.technicianToken },
    ).expect(201);

    const unassignedOrder = await createOrder();
    await submit(
      unassignedOrder,
      { qcTemplateId: template.id, expectedLockVersion: 0, results: validResults(template) },
      { token: fixture.otherTechnicianToken },
    ).expect(404);
    await submit(
      unassignedOrder,
      { qcTemplateId: template.id, expectedLockVersion: 0, results: validResults(template) },
      { token: fixture.receptionistToken },
    ).expect(403);
    await submit(
      unassignedOrder,
      { qcTemplateId: template.id, expectedLockVersion: 0, results: validResults(template) },
      { token: fixture.inactiveToken },
    ).expect(403);
  });

  it("rejects incomplete, duplicate, foreign, N/A, and note-invalid result sets", async () => {
    const orderId = await createOrder();
    const template = await createTemplate();
    const valid = validResults(template);
    await submit(orderId, {
      qcTemplateId: template.id,
      expectedLockVersion: 0,
      results: valid.slice(0, 2),
    })
      .expect(422)
      .expect(({ body }) => expect(body.error.code).toBe("QC_RESULTS_INCOMPLETE"));
    await submit(orderId, {
      qcTemplateId: template.id,
      expectedLockVersion: 0,
      results: [valid[0], valid[0], valid[2]],
    })
      .expect(422)
      .expect(({ body }) => expect(body.error.code).toBe("QC_RESULTS_INCOMPLETE"));

    const foreignTemplate = await createTemplate({ shop: "B" });
    await submit(orderId, {
      qcTemplateId: template.id,
      expectedLockVersion: 0,
      results: [
        { ...valid[0], qcTemplateItemId: foreignTemplate.items[0]!.id },
        valid[1],
        valid[2],
      ],
    }).expect(404);

    await submit(orderId, {
      qcTemplateId: template.id,
      expectedLockVersion: 0,
      results: [{ ...valid[0], result: QcItemResult.NOT_APPLICABLE }, valid[1], valid[2]],
    })
      .expect(422)
      .expect(({ body }) => expect(body.error.code).toBe("QC_RESULTS_INCOMPLETE"));

    await submit(orderId, {
      qcTemplateId: template.id,
      expectedLockVersion: 0,
      notes: "   ",
      results: [{ ...valid[0], result: QcItemResult.FAIL }, valid[1], valid[2]],
    })
      .expect(422)
      .expect(({ body }) => expect(body.error.code).toBe("QC_FAILURE_NOTE_REQUIRED"));

    await submit(orderId, {
      qcTemplateId: template.id,
      expectedLockVersion: 0,
      notes: "Required N/A cannot pass",
      results: [valid[0], { ...valid[1], result: QcItemResult.NOT_APPLICABLE }, valid[2]],
    })
      .expect(201)
      .expect(({ body }) => expect(body.data.run.result).toBe(QcRunResult.FAIL));
  });

  it("enforces order state, optimistic lock, active template, and tenant isolation", async () => {
    const template = await createTemplate();
    const wrongState = await createOrder({ status: RepairOrderStatus.REPAIRING });
    await submit(wrongState, {
      qcTemplateId: template.id,
      expectedLockVersion: 0,
      results: validResults(template),
    })
      .expect(409)
      .expect(({ body }) => expect(body.error.code).toBe("REPAIR_ORDER_GUARD_FAILED"));

    const stale = await createOrder({ lockVersion: 2 });
    await submit(stale, {
      qcTemplateId: template.id,
      expectedLockVersion: 1,
      results: validResults(template),
    })
      .expect(409)
      .expect(({ body }) => expect(body.error.code).toBe("CONCURRENT_UPDATE"));

    const inactive = await createTemplate({ active: false });
    const inactiveOrder = await createOrder();
    await submit(inactiveOrder, {
      qcTemplateId: inactive.id,
      expectedLockVersion: 0,
      results: validResults(inactive),
    })
      .expect(409)
      .expect(({ body }) => expect(body.error.code).toBe("QC_TEMPLATE_INACTIVE"));

    const foreignOrder = await createOrder({ shop: "B" });
    await submit(foreignOrder, {
      qcTemplateId: template.id,
      expectedLockVersion: 0,
      results: validResults(template),
    }).expect(404);
    const foreignTemplate = await createTemplate({ shop: "B" });
    const ownOrder = await createOrder();
    await submit(ownOrder, {
      qcTemplateId: foreignTemplate.id,
      expectedLockVersion: 0,
      results: validResults(foreignTemplate),
    }).expect(404);
  });

  it("serializes competing submissions and allocates deterministic run numbers", async () => {
    const orderId = await createOrder();
    const template = await createTemplate();
    const body = {
      qcTemplateId: template.id,
      expectedLockVersion: 0,
      results: validResults(template),
    };
    const [left, right] = await Promise.all([
      submit(orderId, body, { key: `race-left-${randomUUID()}` }),
      submit(orderId, body, { key: `race-right-${randomUUID()}` }),
    ]);
    expect([left.status, right.status].sort()).toEqual([201, 409]);
    expect(await prisma.qcRun.count({ where: { repairOrderId: orderId } })).toBe(1);
    expect(await prisma.repairOrder.findUniqueOrThrow({ where: { id: orderId } })).toMatchObject({
      lockVersion: 1,
    });

    const second = await submit(orderId, {
      ...body,
      expectedLockVersion: 1,
    }).expect(201);
    expect(second.body.data.run.runNo).toBe(2);
    const history = await prisma.qcRun.findMany({
      where: { repairOrderId: orderId },
      orderBy: { runNo: "desc" },
    });
    expect(history.map((run) => run.runNo)).toEqual([2, 1]);
  });

  it("replays the same idempotency key and rejects payload mismatch", async () => {
    const orderId = await createOrder();
    const template = await createTemplate();
    const key = `qc-replay-${randomUUID()}`;
    const body = {
      qcTemplateId: template.id,
      expectedLockVersion: 0,
      results: validResults(template),
    };
    const first = await submit(orderId, body, { key }).expect(201);
    const replay = await submit(orderId, body, { key }).expect(201);
    expect(replay.body).toEqual(first.body);
    await submit(orderId, { ...body, notes: "changed" }, { key })
      .expect(409)
      .expect(({ body: responseBody }) =>
        expect(responseBody.error.code).toBe("IDEMPOTENCY_KEY_REUSED"),
      );
    expect(await prisma.qcRun.count({ where: { repairOrderId: orderId } })).toBe(1);
  });

  it("uses the greatest runNo for readiness and renders inactive historical templates", async () => {
    const orderId = await createOrder({ assigned: true });
    const template = await createTemplate();
    const pass = await submit(orderId, {
      qcTemplateId: template.id,
      expectedLockVersion: 0,
      results: validResults(template),
    }).expect(201);
    const failedResults = validResults(template);
    failedResults[0]!.result = QcItemResult.FAIL;
    const fail = await submit(orderId, {
      qcTemplateId: template.id,
      expectedLockVersion: 1,
      notes: "Later failure",
      results: failedResults,
    }).expect(201);
    expect([pass.body.data.run.runNo, fail.body.data.run.runNo]).toEqual([1, 2]);
    await prisma.repairOrder.update({
      where: { id: orderId },
      data: { status: RepairOrderStatus.QUALITY_CHECK },
    });
    await transition(orderId, {
      targetStatus: RepairOrderStatus.READY_FOR_PICKUP,
      completionOutcome: CompletionOutcome.REPAIRED,
      expectedLockVersion: 2,
    })
      .expect(409)
      .expect(({ body }) => expect(body.error.code).toBe("REPAIR_ORDER_GUARD_FAILED"));

    await prisma.qcTemplate.update({ where: { id: template.id }, data: { isActive: false } });
    const detail = await request(app.getHttpServer())
      .get(`/api/v1/repair-orders/${orderId}`)
      .set("Authorization", `Bearer ${fixture.ownerAToken}`)
      .set("X-Shop-Id", fixture.shopAId)
      .expect(200);
    expect(detail.body.data.qcRuns.map((run: { runNo: number }) => run.runNo)).toEqual([2, 1]);
    expect(detail.body.data.qcRuns[1]).toMatchObject({
      qcTemplateId: template.id,
      templateName: expect.any(String),
      result: QcRunResult.PASS,
    });
  });

  it("presigns, verifies, binds, and isolates QC evidence", async () => {
    const orderId = await createOrder({ assigned: true });
    const otherOrderId = await createOrder();
    const template = await createTemplate();
    const qcMediaId = await presignEvidence(orderId, MediaPurpose.QC, fixture.technicianToken);
    const qcAsset = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: qcMediaId } });
    expect(qcAsset).toMatchObject({
      shopId: fixture.shopAId,
      repairOrderId: orderId,
      purpose: MediaPurpose.QC,
      uploadedAt: null,
    });
    await completeUpload(qcMediaId);

    const otherOrderMediaId = await presignEvidence(otherOrderId);
    await completeUpload(otherOrderMediaId);
    const wrongPurposeId = await presignEvidence(orderId, MediaPurpose.REPAIR);
    await completeUpload(wrongPurposeId);
    const incompleteId = await presignEvidence(orderId);

    const attach = (mediaAssetId: string) => {
      const results = validResults(template);
      results[0]!.evidenceMediaAssetIds = [mediaAssetId];
      return results;
    };
    await submit(orderId, {
      qcTemplateId: template.id,
      expectedLockVersion: 0,
      results: attach(otherOrderMediaId),
    }).expect(404);
    await submit(orderId, {
      qcTemplateId: template.id,
      expectedLockVersion: 0,
      results: attach(wrongPurposeId),
    }).expect(404);
    await submit(orderId, {
      qcTemplateId: template.id,
      expectedLockVersion: 0,
      results: attach(incompleteId),
    })
      .expect(409)
      .expect(({ body }) => expect(body.error.code).toBe("MEDIA_UPLOAD_INCOMPLETE"));

    const duplicate = validResults(template);
    duplicate[0]!.evidenceMediaAssetIds = [qcMediaId];
    duplicate[1]!.evidenceMediaAssetIds = [qcMediaId];
    await submit(orderId, {
      qcTemplateId: template.id,
      expectedLockVersion: 0,
      results: duplicate,
    }).expect(422);

    const success = await submit(orderId, {
      qcTemplateId: template.id,
      expectedLockVersion: 0,
      results: attach(qcMediaId),
    }).expect(201);
    expect(success.body.data.run.results[0].evidenceMediaAssetIds).toEqual([qcMediaId]);
    expect(await prisma.mediaAsset.findUniqueOrThrow({ where: { id: qcMediaId } })).toMatchObject({
      uploadedAt: expect.any(Date),
      expiresAt: null,
    });

    const foreignOrder = await createOrder({ shop: "B" });
    const foreignMedia = await prisma.mediaAsset.create({
      data: {
        shopId: fixture.shopBId,
        repairOrderId: foreignOrder,
        purpose: MediaPurpose.QC,
        objectKey: `shops/${fixture.shopBId}/foreign-${randomUUID()}.jpg`,
        originalName: "foreign.jpg",
        mimeType: "image/jpeg",
        byteSize: 10,
        uploadedByUserId: fixture.ownerBId,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    await submit(otherOrderId, {
      qcTemplateId: template.id,
      expectedLockVersion: 0,
      results: attach(foreignMedia.id),
    }).expect(404);
  });

  it("rolls back failed-QC run, evidence, event, state, lock, and idempotency together", async () => {
    const orderId = await createOrder({ assigned: true });
    const template = await createTemplate();
    const mediaId = await presignEvidence(orderId);
    await completeUpload(mediaId);
    const results = validResults(template);
    results[0]!.result = QcItemResult.FAIL;
    results[0]!.evidenceMediaAssetIds = [mediaId];
    const key = `qc-rollback-${randomUUID()}`;
    const idempotencyCountBefore = await prisma.idempotencyRecord.count({
      where: { shopId: fixture.shopAId, scope: "quality-control.runs.submit" },
    });
    const functionName = `rf045_fail_event_${randomUUID().replaceAll("-", "").slice(0, 8)}`;
    const triggerName = `${functionName}_trigger`;
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION "${functionName}"() RETURNS trigger AS $$
      BEGIN
        IF NEW."repairOrderId" = '${orderId}'::uuid AND NEW."eventType" = 'QC_COMPLETED' THEN
          RAISE EXCEPTION 'forced RF-045 event failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER "${triggerName}"
      BEFORE INSERT ON "order_events"
      FOR EACH ROW EXECUTE FUNCTION "${functionName}"();
    `);

    try {
      await submit(
        orderId,
        {
          qcTemplateId: template.id,
          expectedLockVersion: 0,
          notes: "Must roll back",
          results,
        },
        { key },
      ).expect(500);
      expect(await prisma.qcRun.count({ where: { repairOrderId: orderId } })).toBe(0);
      expect(await prisma.qcResult.count({ where: { run: { repairOrderId: orderId } } })).toBe(0);
      expect(await prisma.qcResultEvidence.count({ where: { mediaAssetId: mediaId } })).toBe(0);
      expect(await prisma.repairOrder.findUniqueOrThrow({ where: { id: orderId } })).toMatchObject({
        status: RepairOrderStatus.QUALITY_CHECK,
        lockVersion: 0,
      });
      expect(await prisma.mediaAsset.findUniqueOrThrow({ where: { id: mediaId } })).toMatchObject({
        uploadedAt: null,
        expiresAt: expect.any(Date),
      });
      expect(
        await prisma.orderEvent.count({
          where: {
            repairOrderId: orderId,
            eventType: { in: ["QC_COMPLETED", "ORDER_STATUS_CHANGED"] },
          },
        }),
      ).toBe(0);
      expect(
        await prisma.idempotencyRecord.count({
          where: { shopId: fixture.shopAId, scope: "quality-control.runs.submit" },
        }),
      ).toBe(idempotencyCountBefore);
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${triggerName}" ON "order_events";`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${functionName}"();`);
    }
  });
});
