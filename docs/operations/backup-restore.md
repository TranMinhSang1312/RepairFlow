# Backup and restore runbook

## Ownership and targets

The release owner is responsible for a successful backup before deployment and for a restore drill at least once per release cycle. The incident commander authorizes production recovery. Database and object-store credentials remain in the deployment secret manager and are never placed in a bundle, manifest, ticket, or log.

Pilot objectives are RPO 24 hours and RTO 4 hours. Take at least one daily backup, retain 7 daily and 4 weekly recovery points, encrypt them at rest and in transit, and keep a copy outside the primary failure domain. Revisit these targets when transaction volume or contractual obligations change.

The recovery set contains:

- PostgreSQL schema and data, including Prisma migrations, audit history, idempotency, outbox, and notification delivery;
- the private media bucket, with production versioning or provider snapshots enabled;
- the Git revision and deployment manifest kept in source/deployment control;
- a separately managed inventory of required secret names. Secret values are never included.

## Local backup bundle

Start healthy local dependencies and stop local API/worker writes, or use another quiescent source:

```text
docker compose up -d
pnpm ops:backup -- --output-dir .local/backups/<unique-name>
```

The ignored output directory contains `postgres.dump`, `objects.tar`, and `manifest.json`. The manifest contains artifact SHA-256, byte length, table/object counts, and one-way inventory fingerprints. It does not contain row values, object keys, destinations, payloads, tokens, or credentials. Copy all three files together; a manifest without its exact artifacts is unusable.

Do not commit `.local/`, email a bundle, or leave it on a shared workstation. Delete local artifacts after the evidence has been recorded and the approved retained copy exists.

## Local restore drill

```text
pnpm ops:restore-drill -- \
  --bundle .local/backups/<unique-name> \
  --evidence .local/backups/<unique-name>/restore-drill-evidence.json
```

The script verifies checksums before creating any target. It generates an isolated database with prefix `repairflow_restore_drill_` and an isolated bucket with prefix `repairflow-restore-drill-`. It refuses the primary names, compares restored aggregate fingerprints, and removes both targets. Check that the evidence says `PASS` and independently verify that no drill target remains.

The local tool intentionally has no option to overwrite the primary database or bucket. A production recovery uses provider controls and the process below.

## Production recovery

1. Declare the incident, record the requested recovery point, owner, start time, RPO impact, and affected region.
2. Freeze application and worker writes. Preserve the failed environment for investigation.
3. Provision an isolated PostgreSQL database and private bucket in the recovery environment. Apply least-privilege access and network restrictions.
4. Select a database snapshot/PITR point and matching object-store version/snapshot. Verify provider checksum/signature and retention metadata.
5. Restore PostgreSQL, then restore media objects. Do not reuse production target names until validation finishes.
6. Run migration status without applying an unreviewed migration. Confirm expected migration history, table counts, constraints, outbox states, and notification deliveries.
7. Verify a sampled intake image through authorized signed access, a staff login, board/detail read, public allowlisted read, and one worker poll with provider delivery disabled.
8. Confirm health/readiness and metrics contain no sensitive values. Re-enable provider delivery only after pending/outbox impact is understood.
9. Obtain incident-commander approval, switch traffic, monitor errors and queue depth, and keep the old environment read-only until rollback expiry.
10. Record actual RPO/RTO, verification results, exceptions, cleanup, and follow-up actions. Rotate credentials only when compromise is suspected; restored data never supplies secrets.

## Failure handling

- A checksum mismatch invalidates the bundle. Do not attempt a partial restore.
- If source inventory changes during local backup, quiesce writes and create a new bundle.
- If drill cleanup fails, keep traffic away from the target and delete it manually with a second operator reviewing the exact generated name.
- If database and object recovery points cannot be aligned, restore both into isolation and reconcile missing media metadata before any traffic switch.
- Never retry notifications blindly after restore. Inspect outbox/delivery status and rely on stable provider idempotency keys.

## Release evidence checklist

- Git revision and migration status.
- Backup timestamp, retention class, encryption/location owner, and artifact checksum verification.
- Restore verification timestamp, aggregate database/object results, cleanup confirmation, and elapsed time.
- Full automated check results and relevant smoke-test results.
- Known limitations, provider feature flags, and any recovery action still open.
