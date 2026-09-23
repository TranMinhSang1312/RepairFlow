# RF-044 — Versioned QC template API

## Objective

Give each shop an immutable, versioned QC checklist catalogue so owners can publish new versions and eligible staff can select an active template without rewriting historical QC evidence.

## Scope

- List active QC templates for operational use and list historical versions for owner settings.
- Let an owner publish version 1 of a named template or the next version of an existing name.
- Atomically activate the new version and deactivate the prior active version of the same template name.
- Let an owner deactivate an active version without deleting it.
- Return ordered template items with `isRequired`, `allowNa`, and version metadata.
- Preserve the deterministic default/demo QC template in seed data.

## Outside scope

- QC-run submission, state transitions, media evidence, frontend settings, or repair-order detail QC history.
- Updating/deleting a published template or its items in place.
- Device-specific automatic template selection or AI checklist suggestions.

## Flow and transaction

### Read

1. Validate bearer identity, active shop membership, and `X-Shop-Id`.
2. Apply the contract filter for active-only or historical versions.
3. Return templates and ordered items from the selected shop only.

### Publish next version

1. Normalize and validate template name and the complete ordered item list. Persist the canonical normalized family key separately from the display name.
2. Lock the `(shopId, normalizedName)` version-allocation boundary used by the database uniqueness constraint.
3. Allocate `versionNo = max + 1` on the server.
4. Deactivate the previous active version of that name, create the new template/items, append audit data, and commit atomically.
5. Return the immutable published version.

### Deactivate

- Lock and resolve the tenant-owned version, change only lifecycle state, append audit data, and keep the version/items readable for history.

## Business and security rules

- Only `OWNER` can publish or deactivate QC template versions.
- Active owners, receptionists, and technicians may read active templates; only owners may request full inactive history.
- Cross-tenant IDs behave as not found.
- A template has a non-blank bounded name and at least one ordered item.
- Template-family identity uses the persisted normalized key, so case, surrounding whitespace, and equivalent normalized spellings cannot create parallel active families. The original validated display name remains presentational.
- Each item has a non-blank label, `isRequired`, and `allowNa`; its position is unique within the template and backed by the RF-040 database constraint.
- Published name/version/item content is immutable. A correction creates a new version.
- At most one version per `(shop, template name)` is active; concurrent publication cannot allocate duplicate versions or leave two active rows.
- Inactive historical versions remain resolvable by existing QC runs but cannot start a new run.
- Deactivating a template never rewrites or invalidates historical QC runs.

## API/UI involved

- `GET /api/v1/qc-templates`
- `POST /api/v1/qc-templates`
- `POST /api/v1/qc-templates/{qcTemplateId}/deactivate`
- No UI in this RF.

Exact query flags, DTO fields, response schemas, and errors follow RF-040's frozen OpenAPI contract.

## Expected files and ownership

- `apps/api/src/modules/quality-control/templates/**`
- Quality-control module composition files
- Permission/capability mapping and focused authorization tests
- `prisma/seed.ts` only if the RF-040 fixture needs runtime alignment
- `apps/api/test/qc-templates.e2e.test.ts`

Do not edit QC-run runtime, repair state transitions, frontend files, OpenAPI, or Prisma schema in this RF.

## Dependencies

- RF-040 contract and persistence alignment merged.
- May be implemented in parallel with RF-042 only when module integration files have one explicit owner.

## Acceptance criteria

- Owner can publish and deactivate a valid template version.
- Receptionist and technician can read active templates but cannot manage them.
- Publishing the same template name creates a unique sequential version and preserves older content.
- Case/whitespace variants resolve to the same normalized template family, allocate one sequential version stream, and leave exactly one active version.
- Duplicate item positions are rejected by validation and the database constraint.
- Historical versions referenced by QC runs remain readable and unchanged.
- Invalid items, wrong role, inactive membership, foreign IDs, and version races fail with stable behavior.
- The default seed template is deterministic and rerunning seed does not create duplicate versions.

## Required tests

- Owner publish first version, publish next version, deactivate, and list history.
- Receptionist/technician read and management denial.
- Shop-A/shop-B isolation for list, publish, and deactivate.
- Blank/duplicate/oversized items, duplicate positions, deterministic ordering, `allowNa`, and required flags.
- Display-name normalization/case/whitespace variants, normalized-family version allocation, and the normalized one-active-version constraint.
- Concurrent next-version creation and one-active-version database constraint.
- Referenced inactive template remains unchanged and readable.
- Transaction rollback between deactivation and new-version creation.
- Seed replay and BigInt/UUID-safe response mapping where applicable.

## Definition of Done

- Template versions and items have no ordinary update/delete path.
- Controller is thin, repository queries are tenant-scoped, and version allocation is concurrency-safe.
- Format, lint, typecheck, relevant integration tests, full tests, and build pass.

## AI implementation prompt

```text
Bạn đang làm RF-044 — Versioned QC template API trong C:\RepairFlow. Đọc
AGENTS.md, docs/tasks/milestone-5/README.md,
docs/tasks/milestone-5/RF-040-service-contract-persistence.md,
docs/tasks/milestone-5/RF-044-qc-template-api.md, docs/domain-rules.md,
docs/rbac.md, docs/openapi.yaml, prisma/schema.prisma,
docs/error-codes.md và docs/testing-strategy.md.

Trước khi code, tóm tắt list/publish/deactivate contract, role matrix,
immutability, persisted normalized family key, version allocation, item-position
uniqueness, active-version constraint, transaction và file ownership. Sau đó
triển khai QC-template API và deterministic seed alignment đúng contract đã đóng
băng.

Không triển khai QC run, state transition, evidence upload, UI hoặc AI. Không
sửa template/item đã publish tại chỗ. Test role/tenant, validation, ordering,
concurrent version allocation, one-active constraint, referenced history,
rollback và seed replay. Chạy format, lint, typecheck, test, build và migration
checks phù hợp. Không commit hoặc push.
```
