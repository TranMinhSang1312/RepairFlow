import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  AiCapability,
  DeviceType,
  MediaPurpose,
  MembershipRole,
  MembershipStatus,
} from "@prisma/client";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { AppModule } from "../src/app.module.js";
import { configureApplication } from "../src/application.js";
import { TokenService } from "../src/common/auth/token.service.js";
import { PrismaService } from "../src/infra/database/prisma.service.js";
import {
  OBJECT_STORAGE,
  type ObjectStoragePort,
} from "../src/infra/object-storage/object-storage.port.js";
import {
  AI_GLOBAL_ENABLED,
  AI_INTAKE_AUDIO_ENABLED,
  AI_MAX_AUDIO_BYTES,
  AI_TRANSCRIPTION_PROVIDER,
} from "../src/modules/ai/ai.tokens.js";
import { MEDIA_UPLOAD_OPTIONS } from "../src/modules/media/media.service.js";

interface Actor {
  userId: string;
  token: string;
}

describe("RF-063 intake draft enqueue", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let shopAId: string;
  let shopBId: string;
  let owner: Actor;
  let receptionist: Actor;
  let technician: Actor;
  let ownerB: Actor;
  let userIds: string[];
  const stored = new Map<string, { byteSize: number; mimeType: string; checksumSha256: null }>();
  const head = vi.fn(async (objectKey: string) => stored.get(objectKey) ?? null);
  const storage: ObjectStoragePort = {
    presignPut: async () => "https://storage.test/upload",
    head,
    delete: async () => undefined,
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AI_GLOBAL_ENABLED)
      .useValue(true)
      .overrideProvider(AI_INTAKE_AUDIO_ENABLED)
      .useValue(true)
      .overrideProvider(AI_TRANSCRIPTION_PROVIDER)
      .useValue("fake")
      .overrideProvider(AI_MAX_AUDIO_BYTES)
      .useValue(10_000_000)
      .overrideProvider(OBJECT_STORAGE)
      .useValue(storage)
      .overrideProvider(MEDIA_UPLOAD_OPTIONS)
      .useValue({
        intakeAudioEnabled: true,
        transcriptionProvider: "fake",
        maxAudioBytes: 10_000_000,
      })
      .compile();
    app = moduleRef.createNestApplication({ bufferLogs: true });
    configureApplication(app);
    await app.init();
    prisma = app.get(PrismaService);
    const tokens = app.get(TokenService);
    const suffix = randomUUID().slice(0, 8);
    const [shopA, shopB] = await Promise.all([
      prisma.shop.create({ data: { name: `RF063 A ${suffix}`, slug: `rf063-a-${suffix}` } }),
      prisma.shop.create({ data: { name: `RF063 B ${suffix}`, slug: `rf063-b-${suffix}` } }),
    ]);
    shopAId = shopA.id;
    shopBId = shopB.id;
    const roles = [
      [shopAId, MembershipRole.OWNER],
      [shopAId, MembershipRole.RECEPTIONIST],
      [shopAId, MembershipRole.TECHNICIAN],
      [shopBId, MembershipRole.OWNER],
    ] as const;
    const users = await Promise.all(
      roles.map((_, index) =>
        prisma.user.create({
          data: {
            email: `rf063-${index}-${suffix}@example.test`,
            passwordHash: "test-only",
            displayName: `RF063 ${index}`,
          },
        }),
      ),
    );
    userIds = users.map((user) => user.id);
    await prisma.shopMembership.createMany({
      data: roles.map(([shopId, role], index) => ({
        shopId,
        userId: users[index]!.id,
        role,
        status: MembershipStatus.ACTIVE,
      })),
    });
    const actor = (index: number): Actor => ({
      userId: users[index]!.id,
      token: tokens.createAccessToken(users[index]!.id).token,
    });
    owner = actor(0);
    receptionist = actor(1);
    technician = actor(2);
    ownerB = actor(3);
    await prisma.aiCapabilitySetting.create({
      data: {
        shopId: shopAId,
        capability: AiCapability.INTAKE_DRAFT,
        enabled: true,
        monthlyBudgetMicrousd: 100_000n,
        maxRunCostMicrousd: 10_000n,
        updatedByUserId: owner.userId,
      },
    });
  });

  afterAll(async () => {
    const shops = [shopAId, shopBId];
    await prisma.outboxEvent.deleteMany({ where: { shopId: { in: shops } } });
    await prisma.idempotencyRecord.deleteMany({ where: { shopId: { in: shops } } });
    await prisma.aiRun.deleteMany({ where: { shopId: { in: shops } } });
    await prisma.aiUsagePeriod.deleteMany({ where: { shopId: { in: shops } } });
    await prisma.aiCapabilitySetting.deleteMany({ where: { shopId: { in: shops } } });
    await prisma.mediaAsset.deleteMany({ where: { shopId: { in: shops } } });
    await prisma.shopMembership.deleteMany({ where: { shopId: { in: shops } } });
    await prisma.shop.deleteMany({ where: { id: { in: shops } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app.close();
  });

  function enqueue(
    actor: Actor,
    source: Record<string, unknown>,
    key = randomUUID(),
    shopId = shopAId,
  ) {
    return request(app.getHttpServer())
      .post("/api/v1/ai/intake-drafts")
      .set("Authorization", `Bearer ${actor.token}`)
      .set("X-Shop-Id", shopId)
      .set("Idempotency-Key", key)
      .send({ source, deviceType: DeviceType.PHONE, language: "vi" });
  }

  async function audio(options: { shopId?: string; expiresAt?: Date; stored?: boolean } = {}) {
    const objectKey = `tests/rf063/${randomUUID()}.wav`;
    const media = await prisma.mediaAsset.create({
      data: {
        shopId: options.shopId ?? shopAId,
        purpose: MediaPurpose.AI_INTAKE_AUDIO,
        objectKey,
        originalName: "intake.wav",
        mimeType: "audio/wav",
        byteSize: 128,
        uploadedByUserId: options.shopId === shopBId ? ownerB.userId : owner.userId,
        expiresAt: options.expiresAt ?? new Date(Date.now() + 60_000),
      },
    });
    if (options.stored !== false) {
      stored.set(objectKey, {
        byteSize: media.byteSize,
        mimeType: media.mimeType,
        checksumSha256: null,
      });
    }
    return media;
  }

  it.each(["owner", "receptionist"])("queues a redacted text draft for %s", async (role) => {
    const response = await enqueue(role === "owner" ? owner : receptionist, {
      type: "TEXT",
      text: "Khách 0901234567, email customer@example.com báo máy tự tắt nguồn.",
    }).expect(202);
    expect(response.body.data).toMatchObject({
      capability: "INTAKE_DRAFT",
      promptVersion: "intake-draft-v1",
      status: "QUEUED",
    });
    const run = await prisma.aiRun.findUniqueOrThrow({ where: { id: response.body.data.id } });
    expect(JSON.stringify(run.inputReference)).not.toContain("0901234567");
    expect(JSON.stringify(run.inputReference)).not.toContain("customer@example.com");
    expect(run.inputReference).toMatchObject({
      sourceType: "TEXT",
      deviceType: "PHONE",
      language: "vi",
    });
    const event = await prisma.outboxEvent.findFirstOrThrow({ where: { aggregateId: run.id } });
    expect(event.payload).toEqual({
      schemaVersion: 1,
      aiRunId: run.id,
      shopId: shopAId,
      capability: "INTAKE_DRAFT",
    });
  });

  it("rejects credentials and unbound technician use before creating a run", async () => {
    const before = await prisma.aiRun.count({ where: { shopId: shopAId } });
    const prohibited = await enqueue(owner, {
      type: "TEXT",
      text: "Máy không mở được, mật khẩu: 123456",
    }).expect(422);
    expect(prohibited.body.error.code).toBe("AI_INPUT_PROHIBITED");
    await enqueue(technician, { type: "TEXT", text: "Máy không lên nguồn" }).expect(404);
    expect(await prisma.aiRun.count({ where: { shopId: shopAId } })).toBe(before);
  });

  it("replays the same key and rejects a changed payload", async () => {
    const key = randomUUID();
    const first = await enqueue(owner, { type: "TEXT", text: "Máy tự tắt nguồn" }, key).expect(202);
    const replay = await enqueue(owner, { type: "TEXT", text: "Máy tự tắt nguồn" }, key).expect(
      202,
    );
    expect(replay.body.data.id).toBe(first.body.data.id);
    const mismatch = await enqueue(owner, { type: "TEXT", text: "Máy không nhận sạc" }, key).expect(
      409,
    );
    expect(mismatch.body.error.code).toBe("IDEMPOTENCY_KEY_REUSED");
  });

  it("checks audio consent, tenant, expiry and stored object before enqueue", async () => {
    const valid = await audio();
    await enqueue(owner, { type: "AUDIO", mediaAssetId: valid.id }).expect(422);
    await enqueue(owner, {
      type: "AUDIO",
      mediaAssetId: valid.id,
      consentAcknowledged: true,
    }).expect(202);
    const expired = await audio({ expiresAt: new Date(Date.now() - 1000) });
    expect(
      (
        await enqueue(owner, {
          type: "AUDIO",
          mediaAssetId: expired.id,
          consentAcknowledged: true,
        }).expect(409)
      ).body.error.code,
    ).toBe("MEDIA_UPLOAD_INCOMPLETE");
    const crossTenant = await audio({ shopId: shopBId });
    await enqueue(owner, {
      type: "AUDIO",
      mediaAssetId: crossTenant.id,
      consentAcknowledged: true,
    }).expect(404);
    const missing = await audio({ stored: false });
    expect(
      (
        await enqueue(owner, {
          type: "AUDIO",
          mediaAssetId: missing.id,
          consentAcknowledged: true,
        }).expect(409)
      ).body.error.code,
    ).toBe("MEDIA_UPLOAD_INCOMPLETE");
  });

  it("presigns only the dedicated private WAV audio purpose", async () => {
    const response = await request(app.getHttpServer())
      .post("/api/v1/media/presign")
      .set("Authorization", `Bearer ${owner.token}`)
      .set("X-Shop-Id", shopAId)
      .send({
        purpose: "AI_INTAKE_AUDIO",
        originalName: "intake.wav",
        mimeType: "audio/wav",
        byteSize: 1024,
      })
      .expect(201);
    const media = await prisma.mediaAsset.findUniqueOrThrow({
      where: { id: response.body.data.mediaAssetId },
    });
    expect(media).toMatchObject({ purpose: MediaPurpose.AI_INTAKE_AUDIO, mimeType: "audio/wav" });

    await request(app.getHttpServer())
      .post("/api/v1/media/presign")
      .set("Authorization", `Bearer ${owner.token}`)
      .set("X-Shop-Id", shopAId)
      .send({
        purpose: "AI_INTAKE_AUDIO",
        originalName: "intake.mp3",
        mimeType: "audio/mpeg",
        byteSize: 1024,
      })
      .expect(422);
  });

  it("reports the separately gated audio availability without exposing budgets", async () => {
    const response = await request(app.getHttpServer())
      .get("/api/v1/ai/capabilities")
      .set("Authorization", `Bearer ${receptionist.token}`)
      .set("X-Shop-Id", shopAId)
      .expect(200);
    expect(response.body.data).toContainEqual({
      capability: "INTAKE_DRAFT",
      effectiveEnabled: true,
      audioEffectiveEnabled: true,
    });
    expect(JSON.stringify(response.body)).not.toContain("monthlyBudgetMicrousd");
  });
});
