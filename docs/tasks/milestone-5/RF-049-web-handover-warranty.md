# RF-049 — Web handover, warranty, and public completion journey

## Objective

Complete the RepairFlow MVP journey: owner or receptionist can record payments and physical handover, preserve a warranty snapshot, create a linked warranty return without changing the source order, and give the customer a safe mobile tracking view through a `TRACK_ORDER` token.

## Scope

- Add a URL-backed `Handover` tab to the staff repair-order workspace.
- Show completion outcome, authoritative approved amount, append-only payment history, total paid, amount due, payment disposition, handover, warranty, and linked warranty-order summaries from `RepairOrderDetail`.
- Let owner/receptionist add an idempotent payment only in `READY_FOR_PICKUP`, or in `COMPLETED` when the immutable handover disposition is `PARTIALLY_PAID`/`PAY_LATER` and authoritative `amountDue > 0`, with whole-VND amount, method, and optional reference.
- Let owner/receptionist upload optional `SIGNATURE` or contracted handover evidence and complete the binding handover confirmation.
- Render conditional payment-disposition fields and repaired-outcome warranty end/terms according to RF-040/RF-047; the server sets warranty start to the handover timestamp.
- After success, render handover and warranty read-only, keep every payment receipt immutable, retain append-payment capability only for an eligible completed `PARTIALLY_PAID`/`PAY_LATER` case with authoritative `amountDue > 0`, and expose the one-time/replay-safe tracking-link copy action returned by the API while it remains unexpired.
- Add the warranty-follow-up intake flow for an eligible completed source order: fresh branch, reported issue, intake condition, consent, evidence, priority, and explicit staff eligibility confirmation, while reusing only server-approved source customer/device data.
- Deep-link to the newly created warranty order and show safe source/follow-up relationships without mutating the completed source order.
- Extend the existing public route for `TRACK_ORDER` so customers can view public-safe repair progress, pickup readiness, completion, and warranty summary without a staff session.
- Add the critical browser E2E journey required by the testing strategy at desktop and 360 px.

## Outside scope

- Backend/payment/handover/warranty API implementation, contract or schema changes, payment gateway, invoice/accounting/tax behavior, refunds, inventory, appointment scheduling, customer accounts, chat, real notification provider, or AI.
- Editing/deleting payment, handover, warranty, source-order, follow-up, timeline, or other binding history.
- Client-side warranty eligibility decisions, payment reconciliation authority, status changes outside guarded endpoints, or exposing internal handover/payment data publicly.

## UI flow

### Payment and handover

1. Staff opens `/orders/{repairOrderId}?shopId={shopId}&tab=handover`; refresh and browser navigation restore the tab and shop.
2. The tab displays the read-only completion outcome, authoritative amount summary, prior payments, and remaining amount from the server.
3. Owner/receptionist may record a payment only while the order is `READY_FOR_PICKUP`, or after completion when disposition is `PARTIALLY_PAID`/`PAY_LATER` and server `amountDue > 0`. A valid non-repaired order with no accepted approval displays zero approved/paid/due totals and no payment form. The submitted payload gets one idempotency key that remains stable only while that exact payload is retried.
4. In `READY_FOR_PICKUP`, owner/receptionist enters recipient, payment disposition and conditional note/final payment, optional signature evidence, and repaired-outcome warranty fields.
5. A keyboard-accessible confirmation dialog explains that physical custody will end, the order will become terminal, decision links will be revoked, and binding records cannot be edited.
6. Successful completion reloads the authoritative order, replaces the handover/warranty controls with immutable history, and presents the returned tracking link for copying without persisting or logging its raw token. If a `PARTIALLY_PAID` or `PAY_LATER` balance remains, the standalone payment form stays available while `amountDue > 0`; it appends a receipt and never edits the handover snapshot.
7. A same-key handover replay before token expiry may return the same derivable tracking link. If that fixed token is already expired, the UI reloads the completed order, shows handover success with an expired-link message, disables copy, and does not rotate the key, repeat handover, or imply that the replay extends/renews access.

### Warranty follow-up intake

1. On an eligible completed order, owner/receptionist chooses `Tạo phiếu bảo hành`.
2. The form shows source order and warranty summary read-only, then collects the fresh visit's branch, reported problem, intake condition, consent, evidence, priority, and explicit eligibility confirmation required by contract.
   It renders the immutable source customer/device snapshot even if a linked live profile is archived; it never searches for or substitutes another profile. Follow-up capability and archived-profile handling come from the RF-048 server response, not a client inference.
3. Submission uses one idempotency key for the unchanged payload and disables duplicate actions.
4. Success shows the new server-generated code and a link to `/orders/{newRepairOrderId}?shopId={shopId}`. The source order remains completed and unchanged.

### Public tracking

1. The public page reads the token only from the route parameter and sends it through the existing protected same-origin proxy; it never renders, stores, logs, or includes the token in analytics.
2. A valid `TRACK_ORDER` token shows only shop-approved contact, order code, device label, public status/timeline, pickup readiness, completion time where contracted, and warranty summary.
3. It provides no quote-decision controls and cannot call the decision endpoint.
4. Invalid/revoked, expired, rate-limited, unavailable, and network states use safe user-facing copy based on the frozen error contract without exposing internal IDs or resource existence.

## Validation, loading, error, stale, conflict, and idempotency behavior

- Payment amount is a positive whole-VND value within OpenAPI bounds; method/reference limits follow contract. Displayed total paid and amount due always come from the latest server response.
- Render the payment form only in `READY_FOR_PICKUP`, or in `COMPLETED` with immutable disposition `PARTIALLY_PAID`/`PAY_LATER` and `amountDue > 0`. Hide it for every other state/disposition, when due is zero, and for a non-repaired/no-approval zero-total handover.
- Recipient is required. Payment disposition controls required/forbidden note and final-payment fields exactly as contracted.
- Warranty end and terms are shown/required only for a repaired outcome. The UI explains that warranty starts at handover, validates that the requested end is later, and displays the server-returned start timestamp after completion.
- Validate signature/evidence MIME and size before upload; the API verifies ownership, purpose, completion, and binding.
- Follow-up intake enforces required reported problem, condition, consent, configured media minimum, and eligibility acknowledgement without trusting source IDs or snapshots supplied by the browser.
- Initial loading uses a skeleton. Separate empty states explain why payment, handover, warranty, follow-up, or public data is unavailable and what valid next action exists.
- Keep form/upload values after retryable API errors. On `CONCURRENT_UPDATE`, reload authoritative detail, explain the change, retain safe typed values, and require a new review before the binding action.
- Prevent double submits. Reuse an idempotency key for an identical payment, handover, or warranty-order retry; generate a new key after any payload change. A successful replay renders the original result rather than a duplicate.
- Treat tracking expiry as fixed server state. An expired same-key handover replay must preserve the completed UI, suppress the unusable copy action, and never generate a fresh key or retry the binding mutation to obtain a new token.
- Poll staff workspace every 30 seconds only while visible. If background refresh fails, keep the last successful detail and mark it stale. Do not poll a terminal public record unnecessarily.
- All state, outcome, totals, amount due, payment disposition validity, handover completion, warranty eligibility/snapshot, order code, source relation, and public allowlist come from the server.

## Tenant, role, and public-token rules

- Staff calls require bearer authentication plus validated active `X-Shop-Id` membership; switching shop preserves only routes the user may access.
- Owner and receptionist may record payment, complete handover, and create a warranty follow-up in the active shop.
- Their payment control still follows the exact order/disposition/due matrix above; role permission alone never enables it.
- Technician receives a useful read-only view when actively assigned but no payment, recipient, signature, handover, warranty, tracking-link, or follow-up mutation control.
- Cross-tenant or otherwise hidden staff resources render not-found behavior without revealing existence.
- Public access uses only a valid `TRACK_ORDER` token bound to one order. It grants no staff tenant context and no quote-decision capability.
- Public UI must never reveal customer phone/email, approved/internal cost, payment amount/method/reference, amount due, payment disposition/note, recipient/signature, staff identity, internal note, audit/private payload, media object key, source/follow-up internal ID, or another order.

## API/UI involved

- `GET /api/v1/repair-orders/{repairOrderId}` with payments, handover, warranty, and linked-order detail mapping.
- `POST /api/v1/repair-orders/{repairOrderId}/payments`.
- Existing repair-order media-presign/upload route for `SIGNATURE` and any contracted handover evidence purpose.
- `POST /api/v1/repair-orders/{repairOrderId}/handovers`.
- `POST /api/v1/repair-orders/{sourceOrderId}/warranty-orders`.
- `GET /public/v1/orders/{token}` for `TRACK_ORDER`.
- Existing same-origin public proxy and `/p/{token}` route.
- `/orders/{repairOrderId}?tab=handover`.

If RF-040 freezes a different exact route or field, this RF consumes the frozen OpenAPI contract without changing it.

## Expected files and file ownership

RF-049 owns only these frontend and browser-test files while it is active:

- `apps/web/src/components/repair-orders/handover-panel.tsx` (new)
- `apps/web/src/components/repair-orders/handover-panel.test.tsx` (new)
- `apps/web/src/components/repair-orders/warranty-follow-up-flow.tsx` (new)
- `apps/web/src/components/repair-orders/warranty-follow-up-flow.test.tsx` (new)
- `apps/web/src/components/repair-orders/repair-order-workspace.tsx`
- `apps/web/src/components/repair-orders/repair-order-workspace.test.tsx`
- `apps/web/src/components/public/public-quote-portal.tsx`
- `apps/web/src/components/public/public-quote-portal.test.tsx`
- `apps/web/src/lib/api/intake-api.ts`
- `apps/web/src/lib/api/intake-api.test.ts`
- `apps/web/src/lib/api/public-api.ts`
- `apps/web/src/lib/api/public-api.test.ts`
- `apps/web/src/lib/api/types.ts`
- `apps/web/src/lib/repair-orders/workspace-tabs.ts`
- `apps/web/src/lib/repair-orders/workspace-tabs.test.ts`
- `apps/web/src/app/globals.css`
- `apps/web/e2e/milestone-5-critical-flow.spec.ts` (new)
- `apps/web/playwright.config.ts` (new if no browser harness exists)
- `apps/web/package.json` (only the browser-test script/dependency when required)
- `pnpm-lock.yaml` (only when the browser-test dependency changes it)

Keep the existing public component filename unless a separately reviewed refactor authorizes renaming it. Do not edit backend, Prisma, migration, OpenAPI, error-code, worker, real-provider, or AI files. RF-049 starts only after RF-043 and RF-046 merge because they share workspace/API/type/style files.

## Dependencies

- RF-040 contract and persistence alignment merged.
- RF-043 web Work/Parts workspace merged.
- RF-046 web QC and template settings merged.
- RF-047 payment, handover, warranty snapshot, and tracking-token API merged.
- RF-048 warranty follow-up and public tracking API merged.

## Acceptance criteria

- `?tab=handover` is a durable deep link preserving `shopId`; handover/warranty and each individual payment receipt are immutable after creation, while only an eligible completed `PARTIALLY_PAID`/`PAY_LATER` balance with `amountDue > 0` may receive another append-only payment.
- Staff sees authoritative approved amount, paid total, and amount due. Owner/receptionist can add an idempotent payment; technician cannot.
- Payment controls appear only in `READY_FOR_PICKUP` or the eligible completed partial/pay-later case. A non-repaired handover without accepted scope renders authoritative zero totals and no payment action.
- Owner/receptionist can complete handover only through a binding confirmation with valid recipient, disposition, evidence, and conditional warranty data.
- Duplicate/replayed handover requests show the original completion result and never create a second payment, handover, warranty, event, tracking token, or terminal transition.
- The returned tracking link can be copied after success, while its token never enters visible copy, local/session storage, logs, analytics, error text, or referrer leakage.
- Same-key replay does not extend token expiry. After the fixed token expires, completed handover remains visible but copy is disabled and the UI never repeats handover or rotates its idempotency key to mint access.
- Eligible completed orders offer a fresh warranty intake. Success creates one linked `WARRANTY` order with a server-generated code and leaves the source order/history unchanged.
- Source customer/device snapshots remain visible when linked live profiles are archived; the UI neither substitutes a new profile nor decides archived-profile eligibility locally.
- A valid `TRACK_ORDER` page shows public-safe status, pickup/completion, timeline, and warranty summary with no decision controls or sensitive/internal data.
- Invalid/revoked, expired, rate-limited, and network public states are safe and usable; public access never falls back to a staff session or tenant selector.
- Loading, empty, upload, validation, permission, network, stale-poll, conflict, and retry states preserve appropriate input and explain the next step.
- Staff and public flows are keyboard accessible and usable at 360 px without horizontal page overflow, clipped dialogs, or hidden primary actions.
- A browser E2E test proves the critical intake-to-warranty journey at desktop and the customer/staff critical path at 360 px.

## Required tests

### Component and API-client tests

- URL-backed Handover tab, invalid-tab fallback, `shopId` preservation, refresh, and navigation.
- Owner/receptionist/assigned-technician role matrix and terminal read-only state.
- Authoritative payment list/paid/due rendering; positive integer VND validation; method/reference payload; exact `READY_FOR_PICKUP` and completed partial/pay-later/due control matrix; zero-total non-repaired/no-approval state; success, retry, mismatch, double-click, and preserved values after failure.
- Recipient/disposition conditional validation, server-started repaired warranty end/terms, signature upload progress/failure/retry, review dialog focus trap/return, and exact handover payload.
- Server reconciliation, conflict reload with preserved input, identical-payload idempotency reuse, changed-payload key rotation, pre-expiry tracking replay, expired-token replay without renewed handover/key rotation, and immutable success rendering.
- Warranty-follow-up eligibility, required intake evidence/consent, archived live-profile/source-snapshot behavior, no profile substitution, duplicate prevention, success deep link, and source-order data remaining read-only.
- Public `TRACK_ORDER` rendering, absence of decision controls, readiness/completion/warranty states, invalid/revoked/expired/rate-limit/network states, and retry behavior.
- Explicit sensitive-field denylist assertions and proof that the raw token is absent from DOM text, local/session storage, console calls, analytics hooks, proxy query strings, and outbound referrer behavior.
- Staff stale polling retains last data; public terminal view does not create unnecessary polling.
- Accessible labels, field-error association, live status updates, keyboard order, dialog focus, copy-link feedback, and 360 px no-overflow rendering.

### Critical browser E2E

- Owner registration/shop creation, receptionist intake with evidence, technician assignment/diagnosis, quote send, and customer acceptance through the public mobile page.
- Assigned technician starts repair, records approved work and parts, encounters waiting parts, resumes, submits one failing QC run, repairs, and submits a passing run.
- Receptionist records payment and completes handover with warranty; the order becomes terminal and the tracking page shows only public-safe completion/warranty data.
- Receptionist creates one warranty follow-up; the new order links to the source while the completed source's binding data remains unchanged.
- Run the complete staff journey at desktop and the critical staff/public forms at 360 px. Assert no horizontal document overflow and no hidden binding action.

## Definition of Done

- No backend, database, migration, OpenAPI, error-code, worker/provider, accounting, or AI change.
- All binding money, state, outcome, handover, warranty, source relation, and public-safe projections are returned by the server and never reconstructed as authority in the client.
- Tokens and sensitive handover/payment data are absent from storage, logs, analytics, public copy, and snapshots.
- Existing auth, intake, board, assignment, diagnosis, quote, Work, QC, and public quote-decision flows remain green.
- Format, lint, typecheck, component/API-client tests, critical browser E2E, full test suite, and production build pass.

## AI implementation prompt

```text
Bạn đang làm RF-049 — Web handover, warranty, and public completion journey
trong C:\RepairFlow.

Đọc theo thứ tự: AGENTS.md, docs/tasks/milestone-5/README.md,
docs/tasks/milestone-5/RF-040-service-contract-persistence.md,
docs/tasks/milestone-5/RF-043-web-work-parts.md,
docs/tasks/milestone-5/RF-046-web-qc.md,
docs/tasks/milestone-5/RF-047-payment-handover-api.md,
docs/tasks/milestone-5/RF-048-warranty-follow-up-api.md,
docs/tasks/milestone-5/RF-049-web-handover-warranty.md,
docs/product-spec.md, docs/domain-rules.md, docs/rbac.md,
docs/screen-specs.md, docs/openapi.yaml, docs/error-codes.md,
docs/testing-strategy.md và code staff workspace/public portal hiện tại.

Trước khi code, tóm tắt payment/handover/warranty/follow-up contracts,
authoritative totals và amount due, conditional disposition/warranty rules,
handover transaction result, TRACK_ORDER allowlist, token safety, role/tenant
matrix, URL-backed routes, idempotency, conflict/stale behavior, accessibility,
critical E2E và chính xác các file RF này sở hữu.

Sau đó triển khai tab Handover tại
/orders/{repairOrderId}?shopId={shopId}&tab=handover: payment history và amount
due từ server; form payment; recipient/disposition/conditional note hoặc final
payment; optional signature upload; warranty fields cho repaired outcome; dialog
xác nhận kết thúc physical custody; terminal handover/warranty read-only và copy
tracking link an toàn khi còn hạn. Chỉ hiện payment form ở READY_FOR_PICKUP hoặc
COMPLETED có disposition PARTIALLY_PAID/PAY_LATER và amountDue > 0. Non-repaired
không có accepted approval phải hiển thị approvedTotal/paidTotal/amountDue bằng
0 và không có payment action. Triển khai warranty follow-up intake với fresh condition/problem,
consent, evidence, branch, priority và eligibility confirmation; thành công dẫn
tới phiếu WARRANTY mới, source order không đổi.

Mở rộng /p/{token} cho TRACK_ORDER để chỉ hiển thị public-safe status, timeline,
pickup/completion và warranty summary. Không có quote-decision controls cho scope
này. Token chỉ đọc từ route param, đi qua same-origin proxy hiện có, không render,
persist, log, analytics hoặc leak qua referrer. Public response/UI không được lộ
payment, due, disposition/note, recipient, signature, cost, staff identity,
customer contact, private payload, object key hay internal IDs.

Chỉ owner/receptionist có payment, handover và warranty-follow-up controls.
Technician chỉ đọc khi được phân công. Server là authority cho tenant, role,
state, outcome, totals, amount due, disposition, media, warranty eligibility,
order code, source relation và public allowlist. Dùng cùng idempotency key chỉ
cho cùng payload; đổi key sau khi sửa payload; ngăn double submit. Khi conflict,
reload authoritative detail, giữ safe inputs và bắt review lại. Poll staff 30
giây khi visible, giữ dữ liệu cũ và báo stale nếu lỗi.

Same-key handover replay chỉ trả cùng tracking boundary khi token còn hạn. Nếu
token cố định đã hết hạn, reload completed order, báo link hết hạn, disable copy,
không đổi key hoặc lặp handover để tạo token mới. Warranty form phải hiển thị
source customer/device snapshot dù live profile đã archived, không search/thay
profile khác; capability và archived-profile rule lấy từ response RF-048.

Không sửa backend, Prisma, migration, OpenAPI, error codes, worker/provider,
accounting hoặc AI. Chỉ sửa đúng file ownership. Viết component/API-client tests
và critical browser E2E cho full intake-to-warranty journey, gồm desktop và
360px. Test roles, exact payment state/disposition/due matrix, zero-total
non-repaired case, validation, upload, authoritative money, idempotency/replay,
expired-token replay, conflict, stale polling, terminal immutability, archived
source profiles, follow-up source unchanged, TRACK_ORDER denylist/token safety,
loading/empty/error states, keyboard/dialog accessibility và no horizontal
overflow. Chạy format, lint, typecheck, test, browser E2E và build. Không commit hoặc push.
```
