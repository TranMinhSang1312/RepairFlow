import { describe, expect, it } from "vitest";

import { PasswordHasherService } from "./password-hasher.service.js";

describe("PasswordHasherService", () => {
  const hasher = new PasswordHasherService();

  it("hashes and verifies a password without storing the plaintext", async () => {
    const password = "correct horse battery staple";
    const hash = await hasher.hash(password);

    expect(hash).toMatch(/^scrypt\$/);
    expect(hash).not.toContain(password);
    await expect(hasher.verify(password, hash)).resolves.toBe(true);
    await expect(hasher.verify("wrong password", hash)).resolves.toBe(false);
  });

  it("rejects malformed or unsupported hash parameters", async () => {
    await expect(hasher.verify("password", "not-a-hash")).resolves.toBe(false);
    await expect(hasher.verify("password", "scrypt$999999999$8$1$c2FsdA$aGFzaA")).resolves.toBe(
      false,
    );
  });
});
