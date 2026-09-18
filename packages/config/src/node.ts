import { config as loadDotenv } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

export function loadWorkspaceEnvironment(cwd = process.cwd()): void {
  const candidates = [resolve(cwd, ".env"), resolve(cwd, "..", "..", ".env")];

  for (const path of candidates) {
    if (existsSync(path)) {
      loadDotenv({ path, override: false, quiet: true });
      return;
    }
  }
}
