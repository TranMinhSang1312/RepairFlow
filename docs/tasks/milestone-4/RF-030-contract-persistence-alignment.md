# RF-030 — Contract and persistence alignment

## Objective

Freeze the HTTP and database contracts required by assignment, diagnosis, quote, and public decision work so later RFs can implement independently without guessing.

## Scope

- Update `docs/openapi.yaml` with active-technician discovery, concrete assignment/diagnosis responses, workspace read models, draft-quote update semantics, and dedicated public-safe schemas.
- Update `docs/error-codes.md` only where the existing catalogue cannot express a required failure.
- Add a Prisma migration for one active assignment per repair order and any composite/index constraints proven necessary by the finalized contract.
- Update shared contract types if this repository treats them as generated or manually synchronized artifacts.
- Record examples for integer VND, quote item quantity, token error states, optimistic concurrency, approval groups, partial discounts, channel destinations, default expiry, and replay-safe token derivation.

## Outside scope

- Controllers, services, repositories, pages, components, or business behavior.
- Staff management beyond listing active assignable technicians.
- Real notification delivery, work logs, QC, handover, warranty, and AI.

## Contract decisions

- `GET /api/v1/technicians` is tenant-scoped and returns active `TECHNICIAN` memberships with only `userId` and `displayName`.
- `POST /api/v1/repair-orders/{repairOrderId}/assignments` returns the new active assignment and uses not-found behavior for foreign-tenant users/orders.
- Repair-order detail gains `activeAssignment`, `diagnoses`, and `quoteVersions`; customer-safe data remains in a separate public schema.
- `PATCH /api/v1/quotes/{quoteVersionId}` replaces editable fields/items only while the quote is `DRAFT`; the response contains server totals.
- Staff quote payloads may contain IDs needed by staff flows. Public payloads contain only decision-safe item IDs and customer-visible fields.
- Required quote items are always accepted together. Optional items with no `approvalGroup` are independently selectable; optional items sharing a non-null group are selected all-or-none.
- For partial acceptance, `approvedTotal = max(0, sum(accepted line totals) - quote discount)`. The full quote-level discount applies once to the accepted scope; the server returns the authoritative value.
- If a draft has no explicit expiry, sending uses the shop's `defaultQuoteExpiryHours`. `EMAIL`, `SMS`, and `ZALO` resolve their destination from the intake customer snapshot and fail safely when the required destination is absent; `COPY_LINK` creates no delivery.
- Quote-send idempotency returns the same usable URL without persisting the raw token. Derive the token with a keyed cryptographic PRF from stable token metadata, including the random token-record ID; persist only its hash. The resulting token must have at least 256 bits of effective strength.
- Stale order writes use `expectedLockVersion` and a stable conflict error.
- Invalid/revoked public links use generic not-found behavior; expired or superseded quote links use the existing public-unavailable response without exposing internal identity.

## Transaction and persistence rules

- Add a PostgreSQL partial unique index on `(shopId, repairOrderId)` where `unassignedAt IS NULL`.
- Keep historical assignments; reassignment closes the old row and inserts a new row.
- Do not rewrite the initial migration. Add a forward migration.
- Ensure indexes serve tenant-scoped detail/list queries introduced by the contract.

## API/UI involved

- Staff APIs: technician discovery, assignment, transition, diagnosis, quote create/read/update/send.
- Public APIs: order read and quote decision.
- Staff workspace and public portal consume the frozen shapes but are not implemented here.

## Expected files

- `docs/openapi.yaml`
- `docs/error-codes.md` if needed
- `prisma/schema.prisma`
- `prisma/migrations/<timestamp>_milestone_4_constraints/migration.sql`
- `packages/contracts/src/index.ts` if synchronized contract types live there
- Contract/schema validation tests only

## Dependencies

- RF-010 through RF-019 merged.
- No RF in this milestone may change the same contract files until RF-030 is reviewed.

## Acceptance criteria

- Every endpoint required by RF-031 through RF-038 has a complete request, response, security, and error contract.
- Public schemas cannot expose private notes, internal cost, customer contact details, audit data, staff identity, or storage object keys.
- Prisma and SQL express one-active-assignment correctly.
- OpenAPI validates and Prisma formats/validates.
- No runtime behavior changes.

## Required tests

- OpenAPI parser/validator.
- Prisma validate and migration deploy against a clean database.
- Migration status after deployment.
- A database-level test proving a second active assignment is rejected while historical reassignment rows remain allowed.

## Definition of Done

- Contract gaps listed in the milestone README are resolved explicitly.
- Migration is forward-only and repeatable on a clean database.
- Format, lint, typecheck, relevant tests, and build pass.
- Diff contains only contract, schema, migration, and validation artifacts.

## AI implementation prompt

```text
Bạn đang làm RF-030 — Contract and persistence alignment trong C:\RepairFlow.
Đọc AGENTS.md, docs/tasks/milestone-4/README.md,
docs/tasks/milestone-4/RF-030-contract-persistence-alignment.md,
docs/domain-rules.md, docs/rbac.md, docs/screen-specs.md,
docs/openapi.yaml, prisma/schema.prisma, docs/error-codes.md và
docs/testing-strategy.md.

Trước khi sửa file, liệt kê từng contract gap và quyết định contract cuối cùng.
Sau đó cập nhật OpenAPI, error catalogue nếu cần, Prisma schema và forward
migration để các RF-031 đến RF-038 không phải đoán response shape. Thêm database
constraint bảo đảm mỗi repair order chỉ có tối đa một active assignment.

Không triển khai controller, service, repository hoặc UI. Không sửa initial
migration. Chạy OpenAPI validation, Prisma format/validate, migration deploy/status,
format, lint, typecheck, test và build. Không commit hoặc push. Cuối cùng báo file
thay đổi, quyết định contract, migration và kết quả kiểm tra.
```
