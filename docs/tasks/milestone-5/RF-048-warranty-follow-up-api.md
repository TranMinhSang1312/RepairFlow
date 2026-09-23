# RF-048 — Linked warranty follow-up API and public warranty projection

## Objective

Create a fresh, fully auditable warranty repair order from an eligible completed order while keeping the source order immutable and exposing only a customer-safe warranty summary through a scoped tracking token.

## Scope

- Implement idempotent warranty-follow-up intake from a completed source order.
- Reuse the normal tenant checks, code allocator, customer/device snapshots, intake evidence verification, accessories, consent, and receipt mapping.
- Permit the source order's referenced customer/device to be archived, provided the completed source and those identities belong to the active shop. Build the new order's customer/device snapshots by copying the immutable source-order snapshots rather than trusting browser data or requiring active profiles.
- Set `serviceType=WARRANTY`, bind `sourceOrderId`, and start the new order at `RECEIVED`.
- Expose safe source/follow-up summaries in staff repair-order detail.
- Extend public `TRACK_ORDER` reads with the warranty summary and safe follow-up progress frozen by RF-040.
- Append the traceable `warranty_case.opened` event only to the new warranty order. Do not insert an event or update any row owned by the completed source order.

## Outside scope

- Reopening a completed order, copying old quote approval into the new order, automatic warranty eligibility decisions, UI, AI, real notifications, refunds, or inventory.
- Creating a warranty when the source handover did not produce a warranty snapshot.
- Allowing a public token to create a warranty order.

## Transaction flow

1. Validate bearer identity, tenant, source ID, idempotency key, and request DTO.
2. Verify provisional intake media upload completion, type, size, ownership, and expiry.
3. Begin one transaction and lock the source order plus the shop order-number allocator.
4. Re-read the source, warranty snapshot, source-bound customer/device tenant ownership, actor role, and server time. Archival does not invalidate a source-bound warranty return.
5. Require `OWNER` or `RECEPTIONIST`, source `COMPLETED`, an eligible warranty period, and explicit `eligibilityConfirmed: true`.
6. Generate the next shop-scoped code on the server.
7. Create the new `RECEIVED` warranty order by copying the source order's immutable customer/device snapshots and adding the fresh visit's reported problem, intake condition, accessories, consent, media bindings, branch, priority, and source relation.
8. Append one `warranty_case.opened` event to the new order with customer-safe and private payloads as frozen by RF-040. Do not append an event to the source.
9. Persist the idempotent response and commit. The same key/payload returns the original new order; a different payload conflicts.

## Business and security rules

- Only owner or receptionist may confirm warranty eligibility and create the follow-up.
- Source order and warranty must belong to the active shop. Foreign IDs behave as not found.
- Eligibility uses server time against the immutable warranty start/end timestamps. Staff confirmation is required but cannot override an expired/not-started period in this MVP.
- The follow-up uses the source customer/device identities and copies the source order's immutable snapshots. Archived source profiles are allowed; the command does not reactivate or rewrite them. Reported problem, intake condition, accessories, consent, evidence, branch, priority, timestamps, and order code are fresh for the return visit.
- Required intake photo count and all media rules apply exactly as they do to a standard intake.
- The server owns order code, status, `serviceType`, `sourceOrderId`, timestamps, and snapshots.
- The source remains `COMPLETED`, and every source-owned row/history record remains byte-for-byte unchanged. The relationship exists solely because the new order stores `sourceOrderId`; source/follow-up reads query that child relation. No source event is added.
- No quote, approval, assignment, diagnosis, work log, payment, or QC history is copied to the new order.
- A source may have multiple legitimate follow-ups over time; idempotency prevents accidental duplicate creation, not valid future cases.
- Public `TRACK_ORDER` output is an allowlist. It never exposes payment, costs, recipient/signature data, staff identity, customer contact, internal notes, object keys, database IDs, or another customer's order.
- `TRACK_ORDER` cannot decide a quote, and a revoked/expired/wrong-scope token cannot read the warranty projection.

## API/UI involved

- `POST /api/v1/repair-orders/{sourceOrderId}/warranty-orders`
- Existing intake media upload boundary reused according to RF-040
- Expanded `GET /api/v1/repair-orders/{repairOrderId}` source/follow-up mapping
- Expanded `GET /public/v1/orders/{token}` warranty summary for `TRACK_ORDER`
- No UI in this RF.

## Expected files and ownership

- `apps/api/src/modules/warranties/**` or a clearly named `warranty-follow-ups/**` submodule
- Shared intake orchestration/code-allocation reuse points under `repair-orders/**`
- Media verifier integration for warranty intake evidence
- Repair-order staff detail types/repository mapping
- Public-portal DTO/types/repository/service mapping
- `apps/api/test/warranty-follow-ups.e2e.test.ts`

Do not duplicate the normal intake transaction or silently change its public contract. Extract a shared internal service only when both callers preserve existing behavior.

## Dependencies

- RF-040 contract/persistence, RF-041 state-machine foundation, and RF-047 payment/handover API merged.
- RF-047 creates the immutable warranty snapshot and usable `TRACK_ORDER` token.

## Acceptance criteria

- Owner/receptionist can create a valid warranty follow-up from an eligible completed source.
- The new order has a unique server code, `serviceType=WARRANTY`, correct source relation, copied immutable source snapshots, fresh visit evidence, and `RECEIVED` status.
- The new order copies the immutable source customer/device snapshots while recording fresh visit data and evidence; archived source profiles do not block an otherwise eligible return.
- The source order remains completed and all source-owned fields and history remain unchanged; only the new child row carries the relationship/event.
- Invalid period, missing confirmation, absent warranty, wrong role/state, cross-tenant ID, or invalid media fails without partial records.
- Same-key retry returns the original order; mismatched or concurrent retries cannot create duplicates.
- Staff detail maps both directions safely, and public tracking exposes only the frozen warranty allowlist.

## Required tests

- Eligible owner and receptionist success.
- Technician denial, inactive membership, and shop-A/shop-B not-found behavior.
- Warranty not started, expired, absent, source not completed, and confirmation false/missing.
- Active and archived source customer/device cases; exact snapshot copy from the immutable source snapshots; rejection of foreign-tenant identity mismatch; unchanged source snapshots/status/outcome/handover/payment/warranty/events.
- Required photos, media purpose/type/size/upload/expiry/ownership, accessory and consent validation.
- Code allocation concurrency, same-key replay, key/payload mismatch, and full rollback at each transaction boundary.
- Multiple legitimate follow-ups with different idempotency keys.
- Staff source/follow-up mapping and public valid/expired/revoked/wrong-scope token cases.
- Public allowlist proving absence of costs, payment, recipient/signature, contacts, staff IDs, private notes, object keys, and internal UUIDs.

## Definition of Done

- Warranty intake reuses established code/media/snapshot invariants instead of implementing a weaker parallel path.
- The original completed order cannot be reopened or rewritten.
- Public mapping is explicitly allowlisted and covered by negative leakage assertions.
- Format, lint, typecheck, integration tests, full tests, build, and migration status pass.

## AI implementation prompt

```text
Bạn đang làm RF-048 — Linked warranty follow-up API and public warranty
projection trong C:\RepairFlow. Đọc AGENTS.md,
docs/tasks/milestone-5/README.md,
docs/tasks/milestone-5/RF-040-service-contract-persistence.md,
docs/tasks/milestone-5/RF-047-payment-handover-api.md,
docs/tasks/milestone-5/RF-048-warranty-follow-up-api.md,
docs/tasks/milestone-2/RF-014-intake-media.md,
docs/tasks/milestone-2/RF-015-repair-order-intake.md,
docs/product-spec.md, docs/domain-rules.md, docs/rbac.md,
docs/openapi.yaml, prisma/schema.prisma, docs/error-codes.md và
docs/testing-strategy.md.

Trước khi code, tóm tắt warranty eligibility, role/tenant rules, intake reuse,
source immutability, code/media/idempotency transaction, staff mappings và public
TRACK_ORDER allowlist. Sau đó triển khai warranty-order creation, linked detail
mapping và public warranty summary đúng contract RF-040.

Cho phép customer/device của source đã archived nếu source và identity vẫn cùng
shop. Snapshot của order mới phải copy đúng immutable customer/device snapshot
của source; chỉ problem, condition, accessories, consent, media, branch,
priority, code và timestamps là dữ liệu visit mới. Chỉ ghi
warranty_case.opened event trên order mới; không update hoặc append event/history
nào lên source order.

Không reopen source order, không copy approval/work/payment history, không cho AI
quyết định eligibility và không triển khai UI/real notification/inventory. Test
period/confirmation/role/tenant, intake evidence, source immutability, code
concurrency, retry/mismatch, rollback, linked mappings, token scopes và public
data leakage. Chạy format, lint, typecheck, test, build và migration status.
Không commit hoặc push.
```
