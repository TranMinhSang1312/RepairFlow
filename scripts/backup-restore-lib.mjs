import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { finished } from "node:stream/promises";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DATABASE_IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/u;
const BUCKET_IDENTIFIER = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u;
const SERVICE_IDENTIFIER = /^[A-Za-z0-9_-]+$/u;

export const DRILL_DATABASE_PREFIX = "repairflow_restore_drill_";
export const DRILL_BUCKET_PREFIX = "repairflow-restore-drill-";

export function assertDatabaseIdentifier(value, label = "database") {
  if (!DATABASE_IDENTIFIER.test(value)) {
    throw new Error(`${label} must be a lowercase PostgreSQL identifier.`);
  }
  return value;
}

export function assertBucketIdentifier(value, label = "bucket") {
  if (!BUCKET_IDENTIFIER.test(value) || value.includes("..")) {
    throw new Error(`${label} must be a DNS-compatible bucket name.`);
  }
  return value;
}

export function assertDrillTargets(database, bucket, primaryDatabase, primaryBucket) {
  assertDatabaseIdentifier(database, "drill database");
  assertBucketIdentifier(bucket, "drill bucket");
  if (!database.startsWith(DRILL_DATABASE_PREFIX) || database === primaryDatabase) {
    throw new Error("Restore drills may only use an isolated drill database.");
  }
  if (!bucket.startsWith(DRILL_BUCKET_PREFIX) || bucket === primaryBucket) {
    throw new Error("Restore drills may only use an isolated drill bucket.");
  }
}

export function stableFingerprint(entries) {
  const normalized = [...entries].map(String).sort().join("\n");
  return createHash("sha256").update(normalized).digest("hex");
}

export function parseNamedArguments(argv, allowedNames) {
  const allowed = new Set(allowedNames);
  const result = {};
  const tokens = argv[0] === "--" ? argv.slice(1) : argv;
  for (let index = 0; index < tokens.length; index += 2) {
    const name = tokens[index];
    const value = tokens[index + 1];
    if (!name?.startsWith("--") || !allowed.has(name.slice(2)) || !value) {
      throw new Error(`Unsupported or incomplete argument: ${name ?? "<missing>"}.`);
    }
    result[name.slice(2)] = value;
  }
  return result;
}

export function operationalConfig(environment = process.env) {
  const postgresService = environment.REPAIRFLOW_POSTGRES_SERVICE ?? "postgres";
  const minioService = environment.REPAIRFLOW_MINIO_SERVICE ?? "minio";
  if (!SERVICE_IDENTIFIER.test(postgresService) || !SERVICE_IDENTIFIER.test(minioService)) {
    throw new Error("Compose service names contain unsupported characters.");
  }
  return {
    postgresService,
    minioService,
    postgresUser: assertDatabaseIdentifier(
      environment.REPAIRFLOW_POSTGRES_USER ?? "repairflow",
      "PostgreSQL user",
    ),
    primaryDatabase: assertDatabaseIdentifier(
      environment.REPAIRFLOW_PRIMARY_DATABASE ?? "repairflow",
      "primary database",
    ),
    primaryBucket: assertBucketIdentifier(
      environment.REPAIRFLOW_PRIMARY_BUCKET ?? "repairflow-private",
      "primary bucket",
    ),
  };
}

async function runDocker(arguments_, options = {}) {
  const { input, inputFile, outputFile } = options;
  return await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn("docker", ["compose", ...arguments_], {
      cwd: repositoryRoot,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout = [];
    let outputFinished = Promise.resolve();

    if (outputFile) {
      const destination = createWriteStream(outputFile, { flags: "wx" });
      child.stdout.pipe(destination);
      outputFinished = finished(destination);
    } else {
      child.stdout.on("data", (chunk) => stdout.push(chunk));
    }
    child.stderr.resume();

    if (inputFile) createReadStream(inputFile).pipe(child.stdin);
    else child.stdin.end(input);

    child.once("error", rejectPromise);
    child.once("close", (code) => {
      void outputFinished
        .then(() => {
          if (code !== 0) {
            rejectPromise(new Error(`Docker Compose operation failed with exit code ${code}.`));
            return;
          }
          resolvePromise(Buffer.concat(stdout).toString("utf8"));
        })
        .catch(rejectPromise);
    });
  });
}

async function sha256File(path) {
  const hash = createHash("sha256");
  const stream = createReadStream(path);
  stream.on("data", (chunk) => hash.update(chunk));
  await finished(stream);
  return hash.digest("hex");
}

async function databaseFingerprint(config, database) {
  const script = String.raw`SELECT format('SELECT %L, count(*)::bigint FROM %I.%I', schemaname || '.' || relname, schemaname, relname)
FROM pg_stat_user_tables
WHERE schemaname = 'public'
ORDER BY relname
\gexec
`;
  const output = await runDocker(
    [
      "exec",
      "-T",
      config.postgresService,
      "psql",
      "-X",
      "-q",
      "-A",
      "-t",
      "-F",
      "\t",
      "--set",
      "ON_ERROR_STOP=1",
      "--username",
      config.postgresUser,
      "--dbname",
      database,
    ],
    { input: script },
  );
  const entries = output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  let totalRows = 0n;
  for (const entry of entries) {
    const count = entry.split("\t").at(-1);
    if (!count || !/^\d+$/u.test(count))
      throw new Error("PostgreSQL returned an invalid row count.");
    totalRows += BigInt(count);
  }
  return {
    fingerprint: stableFingerprint(entries),
    tableCount: entries.length,
    totalRows: totalRows.toString(),
  };
}

const minioAliasScript = String.raw`MC=/opt/bitnami/minio-client/bin/mc
"$MC" alias set repairflow-local http://127.0.0.1:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null
`;

async function bucketFingerprint(config, bucket) {
  assertBucketIdentifier(bucket);
  const output = await runDocker([
    "exec",
    "-T",
    "-e",
    `RF_BUCKET=${bucket}`,
    config.minioService,
    "/bin/bash",
    "-ceu",
    `${minioAliasScript}"$MC" ls --recursive --json "repairflow-local/$RF_BUCKET"`,
  ]);
  const entries = [];
  let totalBytes = 0n;
  for (const line of output.split(/\r?\n/u).filter(Boolean)) {
    const item = JSON.parse(line);
    if (item.status !== "success" || item.type !== "file") continue;
    const size = BigInt(item.size);
    entries.push(`${item.key}\t${size}`);
    totalBytes += size;
  }
  return {
    fingerprint: stableFingerprint(entries),
    objectCount: entries.length,
    totalBytes: totalBytes.toString(),
  };
}

async function backupDatabase(config, outputFile) {
  const before = await databaseFingerprint(config, config.primaryDatabase);
  const partial = `${outputFile}.partial`;
  await rm(partial, { force: true });
  try {
    await runDocker(
      [
        "exec",
        "-T",
        config.postgresService,
        "pg_dump",
        "--username",
        config.postgresUser,
        "--dbname",
        config.primaryDatabase,
        "--format=custom",
        "--no-owner",
        "--no-privileges",
        "--serializable-deferrable",
      ],
      { outputFile: partial },
    );
    const after = await databaseFingerprint(config, config.primaryDatabase);
    if (before.fingerprint !== after.fingerprint) {
      throw new Error(
        "Database row counts changed during backup; retry during a quiescent window.",
      );
    }
    await rename(partial, outputFile);
    const file = await stat(outputFile);
    return { ...after, bytes: file.size, sha256: await sha256File(outputFile) };
  } catch (error) {
    await rm(partial, { force: true });
    throw error;
  }
}

async function backupBucket(config, outputFile) {
  const before = await bucketFingerprint(config, config.primaryBucket);
  const partial = `${outputFile}.partial`;
  await rm(partial, { force: true });
  const script = `${minioAliasScript}TMP_DIR=$(mktemp -d /tmp/repairflow-object-backup.XXXXXX)
trap 'rm -rf "$TMP_DIR"' EXIT
"$MC" mirror --overwrite "repairflow-local/$RF_BUCKET" "$TMP_DIR" >/dev/null
tar -C "$TMP_DIR" -cf - .
`;
  try {
    await runDocker(
      [
        "exec",
        "-T",
        "-e",
        `RF_BUCKET=${config.primaryBucket}`,
        config.minioService,
        "/bin/bash",
        "-ceu",
        script,
      ],
      { outputFile: partial },
    );
    const after = await bucketFingerprint(config, config.primaryBucket);
    if (before.fingerprint !== after.fingerprint) {
      throw new Error("Object inventory changed during backup; retry during a quiescent window.");
    }
    await rename(partial, outputFile);
    const file = await stat(outputFile);
    return { ...after, bytes: file.size, sha256: await sha256File(outputFile) };
  } catch (error) {
    await rm(partial, { force: true });
    throw error;
  }
}

export async function createBackupBundle(outputDirectory, config = operationalConfig()) {
  const absoluteDirectory = resolve(repositoryRoot, outputDirectory);
  await mkdir(absoluteDirectory, { recursive: true });
  const manifestPath = resolve(absoluteDirectory, "manifest.json");
  try {
    await stat(manifestPath);
    throw new Error("Backup destination already contains a manifest; choose a new directory.");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const databaseFile = resolve(absoluteDirectory, "postgres.dump");
  const objectsFile = resolve(absoluteDirectory, "objects.tar");
  const database = await backupDatabase(config, databaseFile);
  const objects = await backupBucket(config, objectsFile);
  const revision = await runDocker(["version", "--format", "{{.Client.Version}}"]);
  const manifest = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    source: { database: config.primaryDatabase, bucket: config.primaryBucket },
    toolchain: { dockerClientVersion: revision.trim() },
    artifacts: {
      postgres: { file: "postgres.dump", ...database },
      objects: { file: "objects.tar", ...objects },
    },
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
  return { directory: absoluteDirectory, manifest };
}

async function verifyArtifact(path, expected) {
  const file = await stat(path);
  if (file.size !== expected.bytes || (await sha256File(path)) !== expected.sha256) {
    throw new Error("Backup artifact checksum verification failed.");
  }
}

function timestampSuffix(now = new Date()) {
  return now
    .toISOString()
    .replace(/[-:TZ.]/gu, "")
    .slice(0, 14)
    .toLowerCase();
}

async function createDrillDatabase(config, database) {
  await runDocker([
    "exec",
    "-T",
    config.postgresService,
    "createdb",
    "--username",
    config.postgresUser,
    database,
  ]);
}

async function restoreDatabase(config, database, dumpFile) {
  await runDocker(
    [
      "exec",
      "-T",
      config.postgresService,
      "pg_restore",
      "--username",
      config.postgresUser,
      "--dbname",
      database,
      "--exit-on-error",
      "--no-owner",
      "--no-privileges",
    ],
    { inputFile: dumpFile },
  );
}

async function dropDrillDatabase(config, database) {
  await runDocker([
    "exec",
    "-T",
    config.postgresService,
    "dropdb",
    "--username",
    config.postgresUser,
    "--if-exists",
    "--force",
    database,
  ]);
}

async function createDrillBucket(config, bucket) {
  const script = `${minioAliasScript}"$MC" mb "repairflow-local/$RF_BUCKET" >/dev/null`;
  await runDocker([
    "exec",
    "-T",
    "-e",
    `RF_BUCKET=${bucket}`,
    config.minioService,
    "/bin/bash",
    "-ceu",
    script,
  ]);
}

async function makeDrillBucketPrivate(config, bucket) {
  await runDocker([
    "exec",
    "-T",
    "-e",
    `RF_BUCKET=${bucket}`,
    config.minioService,
    "/bin/bash",
    "-ceu",
    `${minioAliasScript}"$MC" anonymous set none "repairflow-local/$RF_BUCKET" >/dev/null`,
  ]);
}

async function restoreBucket(config, bucket, objectsFile) {
  const script = `${minioAliasScript}TMP_DIR=$(mktemp -d /tmp/repairflow-object-restore.XXXXXX)
trap 'rm -rf "$TMP_DIR"' EXIT
tar -C "$TMP_DIR" -xf -
"$MC" mirror --overwrite "$TMP_DIR" "repairflow-local/$RF_BUCKET" >/dev/null
`;
  await runDocker(
    ["exec", "-T", "-e", `RF_BUCKET=${bucket}`, config.minioService, "/bin/bash", "-ceu", script],
    { inputFile: objectsFile },
  );
}

async function removeDrillBucket(config, bucket) {
  await runDocker([
    "exec",
    "-T",
    "-e",
    `RF_BUCKET=${bucket}`,
    config.minioService,
    "/bin/bash",
    "-ceu",
    `${minioAliasScript}"$MC" rb --force "repairflow-local/$RF_BUCKET" >/dev/null`,
  ]);
}

export async function runRestoreDrill(bundleDirectory, evidencePath, config = operationalConfig()) {
  const absoluteBundle = resolve(repositoryRoot, bundleDirectory);
  const manifest = JSON.parse(await readFile(resolve(absoluteBundle, "manifest.json"), "utf8"));
  if (manifest.schemaVersion !== 1) throw new Error("Unsupported backup manifest version.");
  const databaseFile = resolve(absoluteBundle, manifest.artifacts.postgres.file);
  const objectsFile = resolve(absoluteBundle, manifest.artifacts.objects.file);
  await verifyArtifact(databaseFile, manifest.artifacts.postgres);
  await verifyArtifact(objectsFile, manifest.artifacts.objects);

  const suffix = `${timestampSuffix()}_${process.pid}`;
  const drillDatabase = `${DRILL_DATABASE_PREFIX}${suffix}`;
  const drillBucket = `${DRILL_BUCKET_PREFIX}${suffix.replaceAll("_", "-")}`;
  assertDrillTargets(drillDatabase, drillBucket, config.primaryDatabase, config.primaryBucket);

  let databaseCreated = false;
  let bucketCreated = false;
  let databaseResult;
  let objectResult;
  let drillFailure;
  const cleanupFailures = [];
  const startedAt = new Date();
  try {
    await createDrillDatabase(config, drillDatabase);
    databaseCreated = true;
    await restoreDatabase(config, drillDatabase, databaseFile);
    databaseResult = await databaseFingerprint(config, drillDatabase);
    if (databaseResult.fingerprint !== manifest.artifacts.postgres.fingerprint) {
      throw new Error("Restored database fingerprint does not match the backup manifest.");
    }

    await createDrillBucket(config, drillBucket);
    bucketCreated = true;
    await makeDrillBucketPrivate(config, drillBucket);
    await restoreBucket(config, drillBucket, objectsFile);
    objectResult = await bucketFingerprint(config, drillBucket);
    if (objectResult.fingerprint !== manifest.artifacts.objects.fingerprint) {
      throw new Error("Restored object inventory does not match the backup manifest.");
    }
  } catch (error) {
    drillFailure = error;
  } finally {
    if (bucketCreated) {
      try {
        await removeDrillBucket(config, drillBucket);
      } catch {
        cleanupFailures.push("bucket");
      }
    }
    if (databaseCreated) {
      try {
        await dropDrillDatabase(config, drillDatabase);
      } catch {
        cleanupFailures.push("database");
      }
    }
  }
  if (cleanupFailures.length > 0) {
    throw new Error(`Restore drill cleanup failed for: ${cleanupFailures.join(", ")}.`);
  }
  if (drillFailure) throw drillFailure;

  const evidence = {
    schemaVersion: 1,
    verifiedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
    result: "PASS",
    isolation: "temporary targets removed",
    postgres: {
      checksumVerified: true,
      fingerprintVerified: true,
      tableCount: databaseResult.tableCount,
      totalRows: databaseResult.totalRows,
    },
    objects: {
      checksumVerified: true,
      inventoryVerified: true,
      objectCount: objectResult.objectCount,
      totalBytes: objectResult.totalBytes,
    },
  };
  const absoluteEvidence = resolve(repositoryRoot, evidencePath);
  await mkdir(dirname(absoluteEvidence), { recursive: true });
  await writeFile(absoluteEvidence, `${JSON.stringify(evidence, null, 2)}\n`);
  return { evidencePath: absoluteEvidence, evidence };
}
