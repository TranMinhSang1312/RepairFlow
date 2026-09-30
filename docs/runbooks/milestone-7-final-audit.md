# Milestone 7 final audit

Audit date: 2026-09-30
Scope: RF-060 through RF-064, text/transcript AI assistance behind feature flags

## Result

Milestone 7 passes its exit criteria for the implemented text, transcript, image, summary, and
checklist scope. Production audio transcription remains explicitly disabled because the repository
does not yet contain an audited production speech provider or an approved audio-retention policy.
The deterministic fake transcription boundary remains available for tests only.

All AI output remains a draft. No capability writes a diagnosis, quote, repair-order transition,
QC result, payment, handover, or warranty record. Provider failure and feature disablement leave the
manual repair flow available.

## Verification evidence

| Area | Command or evidence | Result |
| --- | --- | --- |
| Infrastructure | `docker compose up -d` and `docker compose ps` | PostgreSQL and MinIO healthy; bucket initializer completed |
| Migration deployment | `pnpm exec prisma migrate deploy` | PASS; 8 migrations found, none pending |
| Migration status | `pnpm exec prisma migrate status` | PASS; database schema up to date |
| Seed | `pnpm db:seed` | PASS; repeatable seed completed |
| Format | `pnpm format:check` | PASS |
| Lint | `pnpm lint` | PASS |
| Typecheck | `pnpm typecheck` | PASS |
| Unit/integration/operations | `pnpm test` | PASS; 540 tests across operations, config, security, API, web, and worker |
| Browser E2E | `pnpm --filter @repairflow/web test:e2e` | PASS; 8 tests across desktop Chromium and 360 px mobile |
| Build | `pnpm build` | PASS for contracts, config, security, API, worker, and web |
| Backup | `pnpm ops:backup` | PASS; PostgreSQL dump and 13 private objects included |
| Restore drill | `pnpm ops:restore-drill -- --bundle .local/backups/20260930004641` | PASS in temporary isolated targets; checksums, 37-table/484-row fingerprint, and 13-object inventory verified; targets removed |
| Diff hygiene | `git diff --check` | PASS |
| Secret scan | High-confidence API-token/private-key patterns over RF-064 files | PASS; zero matches |
| Generated files | Git status review | `.env`, build output, coverage, and Playwright artifacts remain ignored and untracked |

The local backup bundle and restore evidence are ignored operational artifacts and are not committed.

## Capability evidence and egress inventory

### `CUSTOMER_SUMMARY`

- Sends only server-selected, current diagnosis findings and effective customer-safe work logs after
  redaction, plus tone and maximum length.
- Never sends customer identity, internal notes, part cost, arbitrary client text, or full history.
- Worker and API tests cover grounding, role/tenant/assignment boundaries, invalid output, review,
  provider failure, and manual fallback.

### `DEVICE_OCR`

- Sends one authorized, bounded in-memory image plus the requested field allowlist.
- Never sends object keys, signed URLs, media IDs in provider text, EXIF metadata, customer identity,
  or storage credentials.
- Tests cover tenant/role/assignment, object revalidation, MIME/size/checksum, invalid IMEI/output,
  provider failure, byte disposal, and explicit local-form apply.

### `INTAKE_DRAFT`

- Text/transcript mode sends normalized and redacted staff input, device type, and language.
- Audio mode is disabled in production. Fake-test mode loads short-lived private audio in memory,
  transcribes, disposes bytes, deletes provisional storage, redacts the transcript, then calls the
  provider-neutral gateway.
- Raw audio, intermediate transcript, provider body, credentials, phone, and email are absent from
  the outbox and stored run.

### `CHECKLIST_SUGGESTION`

- Client sends only repair-order ID, active QC-template ID, and phase.
- Server sends redacted device type/reported symptom and a server-owned item allowlist containing
  item UUID, label, required flag, and not-applicable flag.
- Worker preserves only those allowlisted UUIDs while redacting text again. Unknown, duplicate, or
  out-of-template IDs fail the whole run with `AI_OUTPUT_INVALID`.
- Apply records review telemetry and highlights local form items. Browser E2E proves no PASS/FAIL is
  sent until the owner manually completes the authoritative QC form.
- The current QC schema has no device compatibility taxonomy; active templates are treated as
  global/all-device templates. Adding compatibility requires a separate contract and migration.

## Privacy and security findings

- AI outbox events contain only schema version, AI run ID, shop ID, and capability.
- Staff run responses omit private input, provider/model details, token/cost internals, and provider
  response bodies.
- Analytics aggregate by UTC day and capability. Responses contain counts, review outcomes,
  latency, token totals, cost, and optional edit/time averages only. Tenant, role, filter, cursor,
  empty-state, and cross-tenant tests pass.
- Analytics never return a run/order/user/customer ID, prompt, input snapshot, output, provider
  body, destination, raw exception, public token, or secret.
- Checklist fixtures containing phone, email, and password canaries are redacted before persistence
  and provider execution. UUID allowlist preservation has a regression test.
- No DeepSeek smoke request was made. Real-provider tests are manual-only to avoid automatic secret
  use, external billing, and provider data transfer. CI evidence uses the deterministic fake gateway.

## Reliability and fallback

- Budget reservation and concurrent exhaustion are serialized per shop/capability/month.
- Worker replay is idempotent; a recovered `RUNNING` run becomes
  `AI_PROVIDER_OUTCOME_UNKNOWN` instead of repeating a potentially completed provider request.
- Circuit open/recovery, timeout, provider rejection, invalid output, feature disablement, and budget
  exhaustion are covered by worker/API tests.
- Full browser E2E confirms the normal intake/assignment flow and handover/warranty flow still work.
  The RF-064 browser flow confirms owner settings, safe analytics, checklist draft review, manual QC,
  role denial, and 360 px responsiveness.

## Defaults, disable, and rollback

- Seed creates every shop capability with `enabled=false`, monthly budget `0`, and per-run budget
  `0`. Global `AI_ENABLED=false` remains the example/default configuration.
- Emergency disable: set `AI_ENABLED=false` and restart API/worker. Shop-specific disable uses the
  owner settings screen with optimistic concurrency.
- Disabling AI does not change existing repair data or block manual intake, diagnosis, quote, work,
  QC, payment, handover, or warranty operations.
- Rollback may stop the worker and disable flags first. Existing terminal `ai_runs` remain audit
  evidence; pending AI outbox items can remain queued while the manual workflow continues.

## Deferred production dependency

Production speech-to-text is unsupported and disabled. Declaring it supported requires a separate
RF that selects a provider, documents data residency and retention, implements deletion guarantees,
adds provider-specific security tests, and completes an external-provider audit. This dependency
does not block Milestone 7's text/transcript scope.
