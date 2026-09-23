# RF-043 — Web work and parts workspace

## Objective

Add the `Work` tab to the repair-order workspace so permitted staff can execute only the customer-approved scope, preserve append-only work history, manage required-part availability, and move the order through the repair and waiting-parts states from desktop or mobile.

## Scope

- Add a URL-backed `Work` tab to the staff repair-order workspace.
- Show the authoritative approved-scope snapshot read-only, including the accepted quote version and selected items.
- Show ordered, immutable work-log, correction, part-requirement, availability, and parts-used history from `RepairOrderDetail`.
- Let an owner or the actively assigned technician append a work log and link it to an approved quote item where applicable.
- Let an owner or the actively assigned technician correct a prior work log by creating a new `CORRECTION` record with `supersedesId`; never edit the original.
- Let an owner or the actively assigned technician create/update part requirements only through `NEEDED -> ORDERED|AVAILABLE` and `ORDERED -> AVAILABLE`, and append immutable parts-used snapshots or superseding corrections. `CANCELLED` has no staff control in this UI; it is a read-only reconciliation result when replacement approved scope removes the item.
- Follow RF-040's exact state/type matrix: `REPAIR`, `TEST`, and parts-used create/correction only in `REPAIRING`; `CUSTOMER_CONTACT` and `INTERNAL_NOTE` in `APPROVED`, `WAITING_PARTS`, `REPAIRING`, `QUALITY_CHECK`, or `READY_FOR_PICKUP`; requirement create/update only in `APPROVED`, `WAITING_PARTS`, or `REPAIRING`.
- Surface guarded actions for `APPROVED -> REPAIRING`, `APPROVED -> WAITING_PARTS`, `WAITING_PARTS -> REPAIRING`, and `REPAIRING -> QUALITY_CHECK` only when the current server state permits them.
- Provide a clear route to the existing Quote tab when scope or price changes and a new customer approval is required.
- When preparing a full-replacement re-quote, preserve the server-contract lineage reference for carried items and leave new items unlinked; never infer identity from matching text or price.
- Preserve existing overview, assignment, diagnosis, quote, and timeline behavior.

## Outside scope

- Work-log or part API implementation, contract changes, inventory counts, purchasing, suppliers, or stock reservation.
- Editing or deleting work logs, corrections, part snapshots, quote approvals, or other binding history.
- Starting work outside the approved snapshot or silently treating a draft/new quote item as approved.
- QC checklist execution, payment, handover, warranty, public portal changes, notification providers, or AI.

## UI flow

1. Staff opens `/orders/{repairOrderId}?shopId={shopId}&tab=work`; refresh and browser navigation restore the same tab and shop.
2. The tab loads the current repair-order detail and renders the server-provided approved scope before any work mutation controls.
3. In `APPROVED`, an owner or the actively assigned technician may create/update an approved part requirement, append an operational contact/note, start repair, or request `WAITING_PARTS` where the guards allow it. Technical `REPAIR`/`TEST` logs and parts-used controls stay hidden.
4. In `WAITING_PARTS`, permitted staff may move a requirement from `NEEDED` to `ORDERED`/`AVAILABLE` or from `ORDERED` to `AVAILABLE` and append an operational contact/note. Resume repair is enabled only from the latest server state after all required parts satisfy the backend guard. No UI action can choose `CANCELLED`.
5. In `REPAIRING`, permitted staff append a work log, optionally link it to an approved item, add a work-log correction, and record parts-used snapshots or a superseding correction without changing the original.
6. When scope or price changes, the UI sends staff to `?tab=quote`; it does not create or execute unapproved work locally.
7. When required approved work has evidence, a permitted actor may request `QUALITY_CHECK` through the transition API.
8. Every successful mutation reloads the authoritative detail. Existing history stays visible and read-only.

## Validation, loading, error, stale, conflict, and idempotency behavior

- Use OpenAPI limits for work-log content, part name/SKU, quantity, cost, sale price, and identifiers.
- Require non-blank content, positive decimal quantities, and whole non-negative VND values. Never calculate or persist money from formatted display strings.
- Populate quote-item choices only from the server-provided approved snapshot. Rejecting a foreign, superseded, or unapproved item remains the API's responsibility.
- Render `REPAIR`, `TEST`, and parts-used create/correction controls only in `REPAIRING`. Render `CUSTOMER_CONTACT`/`INTERNAL_NOTE` in `APPROVED`, `WAITING_PARTS`, `REPAIRING`, `QUALITY_CHECK`, and `READY_FOR_PICKUP`. A work-log correction follows the server-provided root semantic type through the whole superseding chain, so correcting a `REPAIR`/`TEST` root remains `REPAIRING`-only while correcting a contact/note root follows the operational-note state set.
- Render requirement create/update controls only in `APPROVED`, `WAITING_PARTS`, and `REPAIRING`, and offer only `NEEDED -> ORDERED`, `NEEDED -> AVAILABLE`, or `ORDERED -> AVAILABLE`. Display a server-returned `CANCELLED` requirement and its replacement-scope reason read-only.
- Display the stable scope-lineage identity/status supplied by the server for carried replacement items and their prior evidence. If lineage is missing, foreign, duplicated, cyclic, or otherwise invalid, show a blocking contract error, do not claim prior evidence/coverage, and do not infer lineage from description, SKU, quantity, or price.
- Show an initial skeleton, explicit empty states for approved scope/history/parts, field-level validation, per-action progress, and retryable error text based on stable API error codes.
- Disable duplicate submits. For an operation covered by `Idempotency-Key`, retain one key while retrying the exact same payload and generate a new key after any payload change.
- For a non-idempotent append whose result is unknown after a network failure, reload history before allowing another submit; do not blindly create a duplicate.
- On `CONCURRENT_UPDATE`, preserve typed values, reload the order, explain what changed, and require the user to review the new state before retrying a transition.
- Poll every 30 seconds only while the document is visible. A polling failure keeps the last successful detail on screen and shows a stale-data warning.
- Server state, approved scope, part availability, work coverage, status, `lockVersion`, and monetary values are authoritative. The client does not infer that a guard passed from local form state.

## Tenant and role rules

- Staff requests use the bearer session and validated active `X-Shop-Id` context.
- Owner may view and perform all Work-tab actions for an order in the active shop.
- Receptionist may read approved scope, work history, part history, and permitted internal price fields but receives no work-log, part, or repair-transition mutation controls.
- Technician can load and mutate only an actively assigned order. An unassigned technician must not receive data or infer that the order exists.
- UI role/state visibility is guidance only; the API remains authoritative for membership, assignment, tenant ownership, current state, approved scope, and transition guards.

## API/UI involved

- `GET /api/v1/repair-orders/{repairOrderId}` with RF-040/RF-042 detail mapping.
- `POST /api/v1/repair-orders/{repairOrderId}/work-logs`.
- `POST /api/v1/repair-orders/{repairOrderId}/part-requirements`.
- `PATCH /api/v1/part-requirements/{partRequirementId}`.
- `POST /api/v1/repair-orders/{repairOrderId}/parts-used`.
- `POST /api/v1/repair-orders/{repairOrderId}/transition`.
- Existing quote create/update/send endpoints for the re-quote route.
- `/orders/{repairOrderId}?tab=work`.

If RF-040 freezes a different exact route or field name, this RF must consume that frozen OpenAPI contract without reshaping it.

## Expected files and file ownership

RF-043 owns only these frontend files while it is active:

- `apps/web/src/components/repair-orders/work-panel.tsx` (new)
- `apps/web/src/components/repair-orders/work-panel.test.tsx` (new)
- `apps/web/src/components/repair-orders/repair-order-workspace.tsx`
- `apps/web/src/components/repair-orders/repair-order-workspace.test.tsx`
- `apps/web/src/components/repair-orders/quote-panel.tsx` (only replacement-item lineage handling)
- `apps/web/src/components/repair-orders/quote-panel.test.tsx` (only replacement-item lineage tests)
- `apps/web/src/lib/api/intake-api.ts`
- `apps/web/src/lib/api/intake-api.test.ts`
- `apps/web/src/lib/api/types.ts`
- `apps/web/src/lib/repair-orders/workspace-tabs.ts` (new)
- `apps/web/src/lib/repair-orders/workspace-tabs.test.ts` (new)
- `apps/web/src/app/globals.css`

Do not edit API modules, Prisma, migrations, OpenAPI, error codes, public-portal files, QC files, handover files, or warranty files. The shared workspace/API/type/style files are frontend choke points; RF-046 must start from RF-043 after it is merged rather than modifying them in parallel.

## Dependencies

- RF-040 contract and persistence alignment merged.
- RF-041 repair-execution state-machine and re-quote foundation merged.
- RF-042 approved-scope work logs and parts API merged.
- Existing RF-038 quote workspace remains available for the re-quote route.

## Acceptance criteria

- `?tab=work` is a durable deep link that preserves the active `shopId` through reload, navigation, and tab changes.
- Approved scope and all work/part histories come from the server and are visibly read-only.
- Owner and actively assigned technician can perform only the actions allowed by role, state, assignment, and approved scope; receptionist has a useful read-only view.
- A correction appends a new record identifying the superseded log and never mutates the prior entry.
- Work-log and part controls follow the exact RF-040 state/type matrix, including root-semantic correction rules.
- Requirement controls expose only `NEEDED -> ORDERED|AVAILABLE` and `ORDERED -> AVAILABLE`; `CANCELLED` is a read-only replacement-quote reconciliation result.
- Required-part availability and parts-used snapshots refresh from authoritative responses; the UI makes no inventory promise.
- Carried replacement scope keeps its server-validated stable lineage and may display prior evidence; invalid lineage is visibly blocked and never reconstructed from editable commercial fields.
- Start repair, wait for parts, resume repair, and request QC use the transition API with the current `lockVersion` and correct idempotency behavior.
- Out-of-scope or price-changing work directs staff to a new quote and cannot be recorded as approved work through the UI.
- Loading, empty, validation, permission, network, stale-poll, and optimistic-conflict states remain understandable without losing entered values.
- The tab is keyboard operable and usable at 360 px without horizontal page overflow, clipped history, or hidden primary actions.
- Existing overview, diagnosis, quote, board, intake, authentication, and timeline tests remain green.

## Required tests

- URL tab parsing/serialization, invalid-tab fallback, `shopId` preservation, reload, and browser navigation.
- Owner, receptionist, assigned-technician, and unassigned-technician action visibility.
- Approved-scope allowlist rendering and absence of draft/unapproved items.
- Work-log validation, successful append, correction via `supersedesId`, immutable history, unknown-result reload, and duplicate-submit prevention.
- Exact state/type matrix for `REPAIR`, `TEST`, `CUSTOMER_CONTACT`, `INTERNAL_NOTE`, root-semantic correction chains, requirement actions, and parts-used create/correction.
- Part requirement create and only `NEEDED -> ORDERED|AVAILABLE`/`ORDERED -> AVAILABLE`; absence of a staff `CANCELLED` action; read-only display after replacement-scope cancellation.
- Parts-used snapshot/correction, VND/quantity validation, cumulative approved-quantity handling, and server-authoritative refresh.
- Stable lineage carry-forward, new unlinked scope, missing/foreign/duplicate/cyclic lineage errors, and proof that text/price matching never carries evidence.
- Start/wait/resume/QC transition payloads, stable idempotency key for identical retry, new key after edits, and current `lockVersion` use.
- Re-quote navigation to the Quote tab and preservation of the active shop.
- Initial loading, each empty state, field/API errors, retry, permission denial, conflict with preserved inputs, and polling failure with retained stale data.
- Accessible labels, live status/error announcements, keyboard focus after success/conflict, and a 360 px render with no horizontal document overflow.

## Definition of Done

- No backend, database, OpenAPI, public-contract, QC, handover, warranty, notification, or AI changes.
- All Work-tab data and decisions use the frozen RF-040 through RF-042 contracts; no handwritten shadow contract diverges from OpenAPI.
- No client-provided shop, status, approved scope, totals, coverage, availability, or ownership value is treated as authority.
- Format, lint, typecheck, focused web tests, the full existing test suite, and production build pass.

## AI implementation prompt

```text
Bạn đang làm RF-043 — Web work and parts workspace trong C:\RepairFlow.

Đọc theo thứ tự: AGENTS.md, docs/tasks/milestone-5/README.md,
docs/tasks/milestone-5/RF-040-service-contract-persistence.md,
docs/tasks/milestone-5/RF-041-repair-execution-state-machine.md,
docs/tasks/milestone-5/RF-042-work-logs-parts-api.md,
docs/tasks/milestone-5/RF-043-web-work-parts.md, docs/product-spec.md,
docs/domain-rules.md, docs/rbac.md, docs/screen-specs.md,
docs/openapi.yaml, docs/error-codes.md, docs/testing-strategy.md và code web
workspace hiện tại.

Trước khi code, hãy tóm tắt approved-scope read model, Work-tab flow, các API
work log/part requirement/availability/parts used/transition, role và assignment
rules, URL-backed tab, re-quote flow, validation, idempotency, conflict, polling
stale behavior, exact state/type matrix, root semantic correction và stable
scope lineage cùng chính xác các file RF này sở hữu.

Sau đó triển khai đầy đủ tab Work tại
/orders/{repairOrderId}?shopId={shopId}&tab=work: hiển thị approved scope chỉ
đọc; lịch sử work log/correction/part bất biến; form thêm work log và correction;
part requirement lifecycle, parts-used snapshot/correction; các action start
repair, waiting parts, resume repair, request QC; cùng đường dẫn sang tab Quote
khi scope hoặc giá thay đổi. Chỉ cho staff chọn NEEDED -> ORDERED|AVAILABLE hoặc
ORDERED -> AVAILABLE; CANCELLED chỉ hiển thị read-only khi replacement quote đã
reconcile scope. Luôn tải lại dữ liệu authoritative sau mutation.

Owner và active assigned technician mới có mutation controls. Receptionist chỉ
đọc; technician không được phân công không được xem hoặc suy ra phiếu. UI chỉ
ẩn/hiện theo UX, API vẫn là authority. Không sửa record lịch sử, không cho client
quyết định approved scope, status, coverage, availability, lockVersion hoặc tiền.
Tuân thủ đúng matrix RF-040: REPAIR/TEST/PartUsed chỉ ở REPAIRING;
CUSTOMER_CONTACT/INTERNAL_NOTE ở APPROVED, WAITING_PARTS, REPAIRING,
QUALITY_CHECK, READY_FOR_PICKUP; requirement create/update chỉ ở APPROVED,
WAITING_PARTS, REPAIRING; correction theo root semantic type của cả chain. Với
full-replacement re-quote, gửi explicit prior-item reference cho carried item,
để item mới unlinked, hiển thị stable lineage từ server và block invalid lineage;
không suy luận lineage/evidence bằng description, SKU, quantity hoặc price.
Giữ input khi lỗi retryable/conflict; reload trước khi retry một append không rõ
kết quả; dùng cùng idempotency key chỉ cho cùng payload. Poll 30 giây khi tab
trình duyệt visible, giữ dữ liệu cũ và báo stale khi poll lỗi.

Không sửa backend, Prisma, migration, OpenAPI, error codes, public portal, QC,
handover, warranty, notification hoặc AI. Chỉ sửa đúng file ownership trong RF.
Test role/assignment, URL tabs, approved allowlist, exact state/type matrix,
root-semantic corrections, part transitions không có CANCELLED control,
stable/invalid lineage, parts, transitions, re-quote, validation, double submit,
idempotency, loading/empty/error, conflict giữ input, polling stale, keyboard
accessibility và viewport 360px.
Chạy format, lint, typecheck, test và build. Không commit hoặc push.
```
