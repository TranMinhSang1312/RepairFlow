import { Injectable } from "@nestjs/common";
import { randomBytes, scrypt, scryptSync, timingSafeEqual } from "node:crypto";

const KEY_LENGTH = 64;
const COST = 16_384;
const BLOCK_SIZE = 8;
const PARALLELIZATION = 1;

interface ScryptParameters {
  cost: number;
  blockSize: number;
  parallelization: number;
}

function deriveKey(
  password: string,
  salt: Buffer,
  keyLength: number,
  parameters: ScryptParameters,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      keyLength,
      { N: parameters.cost, r: parameters.blockSize, p: parameters.parallelization },
      (error, derivedKey) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(derivedKey as Buffer);
      },
    );
  });
}

function encodeHash(password: string, salt: Buffer): string {
  const derivedKey = scryptSync(password, salt, KEY_LENGTH, {
    N: COST,
    r: BLOCK_SIZE,
    p: PARALLELIZATION,
  });

  return [
    "scrypt",
    COST,
    BLOCK_SIZE,
    PARALLELIZATION,
    salt.toString("base64url"),
    derivedKey.toString("base64url"),
  ].join("$");
}

const DUMMY_PASSWORD_HASH = encodeHash(
  "repairflow-invalid-password",
  Buffer.from("repairflow-dummy-salt"),
);

@Injectable()
export class PasswordHasherService {
  async hash(password: string): Promise<string> {
    const salt = randomBytes(16);
    const derivedKey = await deriveKey(password, salt, KEY_LENGTH, {
      cost: COST,
      blockSize: BLOCK_SIZE,
      parallelization: PARALLELIZATION,
    });

    return [
      "scrypt",
      COST,
      BLOCK_SIZE,
      PARALLELIZATION,
      salt.toString("base64url"),
      derivedKey.toString("base64url"),
    ].join("$");
  }

  async verify(password: string, encodedHash: string): Promise<boolean> {
    const [algorithm, cost, blockSize, parallelization, saltValue, hashValue] =
      encodedHash.split("$");

    if (
      algorithm !== "scrypt" ||
      !cost ||
      !blockSize ||
      !parallelization ||
      !saltValue ||
      !hashValue
    ) {
      return false;
    }

    try {
      const salt = Buffer.from(saltValue, "base64url");
      const expected = Buffer.from(hashValue, "base64url");
      const parameters = {
        cost: Number(cost),
        blockSize: Number(blockSize),
        parallelization: Number(parallelization),
      };
      if (
        parameters.cost !== COST ||
        parameters.blockSize !== BLOCK_SIZE ||
        parameters.parallelization !== PARALLELIZATION ||
        expected.length !== KEY_LENGTH
      ) {
        return false;
      }

      const derived = await deriveKey(password, salt, expected.length, parameters);

      return derived.length === expected.length && timingSafeEqual(derived, expected);
    } catch {
      return false;
    }
  }

  async verifyAgainstDummy(password: string): Promise<void> {
    await this.verify(password, DUMMY_PASSWORD_HASH);
  }
}
