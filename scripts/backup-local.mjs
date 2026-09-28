import { relative } from "node:path";

import { createBackupBundle, parseNamedArguments } from "./backup-restore-lib.mjs";

const arguments_ = parseNamedArguments(process.argv.slice(2), ["output-dir"]);
const timestamp = new Date()
  .toISOString()
  .replace(/[-:TZ.]/gu, "")
  .slice(0, 14);
const outputDirectory = arguments_["output-dir"] ?? `.local/backups/${timestamp}`;

try {
  const result = await createBackupBundle(outputDirectory);
  console.log(
    JSON.stringify({
      result: "PASS",
      bundle: relative(process.cwd(), result.directory),
      postgresBytes: result.manifest.artifacts.postgres.bytes,
      objectCount: result.manifest.artifacts.objects.objectCount,
    }),
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : "Backup failed.");
  process.exitCode = 1;
}
