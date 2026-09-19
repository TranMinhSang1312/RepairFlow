import { createHash, randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";

import { S3ObjectStorageService } from "../src/infra/object-storage/s3-object-storage.service.js";

describe("S3-compatible object storage", () => {
  const storage = new S3ObjectStorageService();
  const createdKeys: string[] = [];

  afterEach(async () => {
    await Promise.all(createdKeys.splice(0).map((objectKey) => storage.delete(objectKey)));
  });

  it("uploads through a signed URL, verifies metadata and remains private", async () => {
    const objectKey = `integration/${randomUUID()}.jpg`;
    const body = Buffer.from("repairflow-private-upload-test");
    const checksumSha256 = createHash("sha256").update(body).digest("hex");
    createdKeys.push(objectKey);
    const uploadUrl = await storage.presignPut({
      objectKey,
      mimeType: "image/jpeg",
      byteSize: body.byteLength,
      checksumSha256,
      expiresAt: new Date(Date.now() + 60_000),
    });

    const uploaded = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": "image/jpeg" },
      body,
    });
    expect(uploaded.status).toBe(200);
    await expect(storage.head(objectKey)).resolves.toEqual({
      byteSize: body.byteLength,
      mimeType: "image/jpeg",
      checksumSha256,
    });

    const publicRead = await fetch(
      `http://localhost:9000/repairflow-private/${encodeURIComponent(objectKey)}`,
    );
    expect([401, 403]).toContain(publicRead.status);
  });
});
