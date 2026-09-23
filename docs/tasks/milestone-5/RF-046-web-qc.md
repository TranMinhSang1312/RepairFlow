# RF-046 — Web quality control and template settings

## Objective

Add a complete `QC` workspace flow and owner-only QC-template settings so staff can execute a versioned checklist, preserve append-only run history, and move a repaired device toward pickup only after the server records a passing result.

## Scope

- Add a URL-backed `QC` tab to the repair-order workspace.
- Show the selected template name/version, immutable item snapshot, monotonic per-order `runNo`, ordered QC-run history, result, notes, evidence metadata, actor-safe display, and timestamp from `RepairOrderDetail`.
- Let an owner or the actively assigned technician fill every required checklist result and submit a QC run while the order is in `QUALITY_CHECK`.
- Offer `NOT_APPLICABLE` only when the template item permits it.
- Require failure notes in the UI when any answer is `FAIL`, while treating the server-derived overall result as authoritative.
- Support optional QC evidence upload through the private-media flow and submit only verified media asset IDs.
- Show that a failed run returned the order to `REPAIRING`; after a latest passing run, show the guarded `READY_FOR_PICKUP` action with outcome `REPAIRED` to owner, receptionist, or actively assigned technician according to RBAC.
- Add owner-only QC-template settings for listing immutable versions, creating a new version, and deactivating an active template through the RF-044 API.
- Preserve existing workspace tabs and operations.

## Outside scope

- QC template/run API implementation, database or OpenAPI changes, editing/deleting historical templates or runs, or overriding a failed QC result.
- Automatic diagnosis, AI checklist suggestions, real-time collaboration, payment, handover, warranty follow-up, notification delivery, or public-portal changes.
- Letting receptionists submit technical QC or letting an unassigned technician inspect/submit another technician's order.

## UI flow

### QC workspace

1. Staff opens `/orders/{repairOrderId}?shopId={shopId}&tab=qc`; the URL restores the tab and shop after refresh or browser navigation.
2. The tab renders immutable QC history ordered by monotonic server `runNo` and marks the greatest `runNo` as latest. If no run exists, the empty state explains the transition and template prerequisites.
3. In `QUALITY_CHECK`, an owner or actively assigned technician selects an active template when required and answers each checklist item using `PASS`, `FAIL`, or allowed `NOT_APPLICABLE`.
4. If any answer is `FAIL`, the form requires failure notes. Staff may attach optional QC evidence using the existing private upload flow.
5. A review step shows the exact template version, answers, notes, and evidence before submission.
6. The server response determines `PASS` or `FAIL`, assigns the next monotonic `runNo`, and advances the repair-order `lockVersion` for every accepted submission, including a passing run that remains in `QUALITY_CHECK`. The client replaces its preview and prior lock version with the returned run/order detail.
7. A failed latest run displays the return to `REPAIRING`. Only the greatest `runNo` may enable the guarded ready-for-pickup confirmation with `REPAIRED` outcome; an older pass never overrides a later fail.

### Owner template settings

1. Owner opens `/settings/qc?shopId={shopId}` from the staff shell.
2. The page lists active and inactive immutable template versions and their ordered items.
3. Owner creates a new version by entering a name and ordered items with required and allow-NA flags.
4. Before create/deactivate, a confirmation explains that existing run history will retain its original template snapshot/version.
5. Successful changes reload the authoritative template list; no historical version is edited in place.

## Validation, loading, error, stale, conflict, and idempotency behavior

- Require exactly one answer for every contracted template item; do not allow `NOT_APPLICABLE` when `allowNa` is false.
- Require non-blank failure notes when any result is `FAIL`; enforce OpenAPI note, label, item-count, and template-name limits.
- Validate evidence MIME type and size before presign, but rely on the API for upload completion, tenant ownership, purpose, and binding.
- Template item order is explicit and stable. Empty, duplicate, or otherwise invalid items show field-level errors without losing edits.
- Show loading skeletons, no-template/no-run states, upload progress, review/submitting states, safe API errors, and retry controls.
- Disable duplicate template, QC-run, upload-binding, and transition submissions. Keep one QC-run idempotency key while retrying the exact same checklist, evidence, and `expectedLockVersion`; rotate it after any payload change. Apply the same frozen-contract rule to other retry-sensitive commands.
- On `CONCURRENT_UPDATE`, retain checklist/template draft values, reload authoritative data, explain the state/version change, and require review before retry.
- Poll the workspace every 30 seconds only while visible. Poll failure preserves the last successful order and run history with a stale warning.
- Order QC history by server `runNo`, never by array arrival, client time, or display timestamp. Ignore a late response that would replace a newer loaded `runNo`/`lockVersion` with an older snapshot.
- Server-derived QC result, monotonic `runNo`, latest-pass status, template activity/version, repair-order state, completion outcome, and advanced `lockVersion` are authoritative.

## Tenant and role rules

- Every staff request uses the bearer session and validated active `X-Shop-Id` membership.
- Owner may manage template versions and may submit QC for any order in the active shop.
- Receptionist may read QC history and, after a latest passing run, request `READY_FOR_PICKUP`; receptionist cannot create templates or submit QC runs.
- Technician may read/submit QC and request ready-for-pickup only for an actively assigned order.
- Only owner sees the QC-template settings navigation and mutation controls. Direct-route access by other roles must still be rejected by the API and shown as a safe forbidden state.
- UI state and visibility never replace server checks for tenant, assignment, role, template version, evidence, run result, or transition guard.

## API/UI involved

- `GET /api/v1/repair-orders/{repairOrderId}` with QC history/read model.
- `GET /api/v1/qc-templates`.
- `POST /api/v1/qc-templates`.
- `POST /api/v1/qc-templates/{qcTemplateId}/deactivate`.
- `POST /api/v1/repair-orders/{repairOrderId}/qc-runs`.
- Existing repair-order media-presign/upload route for purpose `QC`.
- `POST /api/v1/repair-orders/{repairOrderId}/transition`.
- `/orders/{repairOrderId}?tab=qc`.
- `/settings/qc?shopId={shopId}`.

If RF-040 freezes a different exact field or route, this RF consumes that OpenAPI contract and updates no contract itself.

## Expected files and file ownership

RF-046 owns only these frontend files while it is active:

- `apps/web/src/components/repair-orders/qc-panel.tsx` (new)
- `apps/web/src/components/repair-orders/qc-panel.test.tsx` (new)
- `apps/web/src/components/settings/qc-template-settings.tsx` (new)
- `apps/web/src/components/settings/qc-template-settings.test.tsx` (new)
- `apps/web/src/app/(staff)/settings/qc/page.tsx` (new)
- `apps/web/src/components/layout/staff-shell.tsx`
- `apps/web/src/components/layout/staff-shell.test.tsx`
- `apps/web/src/components/repair-orders/repair-order-workspace.tsx`
- `apps/web/src/components/repair-orders/repair-order-workspace.test.tsx`
- `apps/web/src/lib/api/intake-api.ts`
- `apps/web/src/lib/api/intake-api.test.ts`
- `apps/web/src/lib/api/types.ts`
- `apps/web/src/lib/repair-orders/workspace-tabs.ts`
- `apps/web/src/lib/repair-orders/workspace-tabs.test.ts`
- `apps/web/src/app/globals.css`

Do not edit backend modules, Prisma, migrations, OpenAPI, error codes, public portal, Work-tab implementation beyond shared integration, handover, payment, warranty, notification, or AI files. RF-046 begins only after RF-043 is merged because both own shared workspace/API/type/style files.

## Dependencies

- RF-040 contract and persistence alignment merged.
- RF-043 web Work/Parts workspace merged.
- RF-044 versioned QC-template API merged.
- RF-045 QC-run and guarded workflow API merged.

## Acceptance criteria

- `?tab=qc` is reloadable and preserves `shopId`; `/settings/qc` is reachable only in the owner staff experience.
- The QC tab renders exact template versions and append-only runs without edit/delete controls.
- Run history is ordered by monotonic `runNo`; only the greatest run is labeled/treated as latest, and every successful QC submission replaces the client lock with the server-advanced `lockVersion`.
- Owner and actively assigned technician can submit a complete valid run; receptionist has read-only history and cannot submit technical QC.
- `NOT_APPLICABLE` appears only for allowed items, and failure notes are required before a failing submission.
- Optional QC evidence reports upload progress and only uploaded, server-verifiable asset IDs are submitted.
- The displayed overall result and resulting order state come from the server. Failed QC returns visibly to repair; only a latest pass permits the ready action with `REPAIRED`.
- Owner can create a new immutable template version and deactivate an active version without changing any prior run or template history.
- Loading, empty, upload, validation, permission, network, stale-poll, and conflict states preserve usable context and entered data.
- Forms, radios, dialogs, errors, and results are keyboard/screen-reader usable; the QC and settings flows fit 360 px without horizontal page overflow or hidden primary actions.
- Existing auth, board, intake, overview, assignment, diagnosis, quote, Work, and timeline behavior remains green.

## Required tests

- URL-backed QC tab, invalid-tab fallback, shop preservation, refresh, and browser navigation.
- Owner, receptionist, assigned-technician, and unassigned-technician render/action matrix.
- Template list states, immutable version rendering, item ordering, create/deactivate confirmations, validation, permission denial, and preservation after errors.
- Required checklist completeness, pass/fail/allowed-NA behavior, failure-note rule, optional evidence upload progress/failure/retry, and exact submission payload.
- Monotonic `runNo` allocation/display, out-of-order response protection, later-fail precedence over an older pass, and immutable history.
- Server-result reconciliation when local preview differs, failed-run return to repair, passing-run ready action, every-submission `lockVersion` advance, use of the returned lock for the next action, and completion outcome payload.
- Duplicate-submit prevention, current `expectedLockVersion`, identical-payload QC/transition replay, payload-mismatch handling, and key rotation after edits.
- Initial loading, no-template/no-run empty states, API error, network retry, conflict reload with preserved values, and stale polling that retains current data.
- Dialog focus trap/return, labelled controls, field-error association, live announcements, logical keyboard order, and 360 px no-overflow rendering.

## Definition of Done

- No backend, database, migration, OpenAPI, public portal, payment, handover, warranty, notification, or AI change.
- QC result, latest-pass guard, template version/activity, order state, outcome, and money remain server-authoritative.
- Historical templates and runs have no edit/delete affordance.
- Format, lint, typecheck, focused web tests, full existing tests, and production build pass.

## AI implementation prompt

```text
Bạn đang làm RF-046 — Web quality control and template settings trong
C:\RepairFlow.

Đọc theo thứ tự: AGENTS.md, docs/tasks/milestone-5/README.md,
docs/tasks/milestone-5/RF-040-service-contract-persistence.md,
docs/tasks/milestone-5/RF-043-web-work-parts.md,
docs/tasks/milestone-5/RF-044-qc-template-api.md,
docs/tasks/milestone-5/RF-045-qc-run-workflow-api.md,
docs/tasks/milestone-5/RF-046-web-qc.md, docs/product-spec.md,
docs/domain-rules.md, docs/rbac.md, docs/screen-specs.md,
docs/openapi.yaml, docs/error-codes.md, docs/testing-strategy.md và code web
workspace/staff shell hiện tại.

Trước khi code, tóm tắt QC detail contract, template version contract, QC run
flow, server-derived PASS/FAIL, failure transition, latest-pass guard, role và
assignment matrix, evidence upload, URL-backed routes, validation, conflict,
polling stale behavior, monotonic runNo, every-submission lockVersion advance và
chính xác các file RF này sở hữu.

Sau đó triển khai tab QC tại
/orders/{repairOrderId}?shopId={shopId}&tab=qc và trang owner settings tại
/settings/qc?shopId={shopId}. Tab QC phải hiển thị template/version và run
history bất biến; form checklist đủ kết quả; NOT_APPLICABLE chỉ khi allowNa;
failure notes khi có FAIL; optional QC evidence; review trước submit; kết quả và
state lấy từ server; history sắp theo server runNo tăng dần; max runNo là latest;
failed latest run quay lại REPAIRING; chỉ latest PASS mới cho phép
READY_FOR_PICKUP với outcome REPAIRED. Mọi QC submission thành công, kể cả PASS
giữ QUALITY_CHECK, đều phải nhận lockVersion mới từ server và dùng version đó
cho action tiếp theo. Owner settings phải list version, tạo version mới và
deactivate qua contract, không sửa lịch sử.

Owner hoặc active assigned technician mới submit QC. Receptionist chỉ đọc QC
nhưng có thể mark ready sau PASS theo RBAC. Chỉ owner quản lý template. API vẫn
là authority cho tenant, role, assignment, template, media, result, state,
outcome và lockVersion. Giữ form khi lỗi retryable/conflict; dùng idempotency key
đúng contract và ngăn double submit. Không để response cũ ghi đè runNo hoặc
lockVersion mới hơn. Poll 30 giây khi document visible; nếu poll lỗi giữ dữ liệu
cũ và báo stale.

Không sửa backend, Prisma, migration, OpenAPI, error codes, public portal,
payment, handover, warranty, notification hoặc AI. Chỉ sửa đúng file ownership.
Test URL routes, role matrix, template create/deactivate, checklist, NA/failure
notes, upload, authoritative result, monotonic runNo/latest precedence,
every-submission lockVersion advance, out-of-order response, failed/pass
transitions, double submit, loading/empty/error/conflict giữ input, stale polling,
keyboard/dialog accessibility và viewport 360px. Chạy format, lint, typecheck,
test và build.
Không commit hoặc push.
```
