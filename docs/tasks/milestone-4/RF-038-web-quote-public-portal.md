# RF-038 — Web quote workspace and public decision portal

## Objective

Complete the milestone UI: staff can prepare/send an immutable quote and customers can review and decide it from a secure public link without an account.

## Scope

- Add quote history and draft editor to the staff workspace.
- Preview client totals while clearly treating server totals as authoritative.
- Add send confirmation with version, items, total, expiry, channel, immutability warning, and copy-link result.
- Create public token route/page for order tracking and quote review.
- Add accept-all, valid optional selection/partial accept, and decline flows with final confirmation.
- After decision, render the recorded result read-only.
- Handle invalid, expired, revoked, superseded, decided, rate-limited, loading, and network states.

## Outside scope

- Real email/SMS/Zalo UI promises, customer login, work logs, parts, QC, handover, payments, warranty, and AI.

## Staff UI flow

1. Owner/receptionist opens the Quote tab and sees immutable version history.
2. Create or edit only the current draft; add/remove/reorder items and set optional groups.
3. Submit draft and replace previews with authoritative server totals.
4. Review send confirmation and send/copy link.
5. Sent version becomes read-only and workspace/board show `AWAITING_APPROVAL`.

## Public UI flow

1. Read token only from route params; never display, log, persist, or place it in analytics.
2. Load public-safe order and bound quote.
3. Select permitted optional items while all required scope stays selected.
4. Review exact items and server-derived amount, explicitly confirm, then submit with one idempotency key.
5. Replace controls with final decision and timestamp.

## Validation and states

- Item description, positive quantity, non-negative integer VND unit price/discount, expiry, note lengths, and approval groups follow OpenAPI.
- Disable accidental double submit; preserve form values on retryable errors.
- A server total mismatch replaces the preview and asks the user to review again before send/decision.
- Staff polling failure preserves current data with stale warning.
- Public errors use friendly copy and never reveal internal IDs.

## Tenant and role rules

- Staff routes use bearer session plus validated shop context.
- Only owner/receptionist receive quote mutation controls.
- Public route uses only the scoped token and contains no staff shell or tenant selector.

## API/UI involved

- Quote create/update/send APIs.
- Extended staff repair-order detail.
- Public order read and quote decision APIs.
- `/orders/[repairOrderId]` Quote tab.
- New public route such as `/p/[token]` according to RF-030.

## Expected files

- New quote components under `apps/web/src/components/repair-orders/`
- New public portal components under `apps/web/src/components/public/`
- Public route under `apps/web/src/app/`
- `apps/web/src/lib/api/` staff/public clients and types
- Focused tests and required styles

## Dependencies

- RF-034 for workspace composition.
- RF-035, RF-036, and RF-037 merged.

## Acceptance criteria

- Owner/receptionist can create/edit a draft, see authoritative totals, and send it.
- Sent versions are visibly immutable and copy link is available.
- Customer can view safe data and accept, partially accept valid optional scope, or decline.
- Final decision is read-only after success.
- Invalid token states and retryable network errors have distinct safe UX.
- Both staff and public flows work at 360px and are keyboard accessible.

## Required tests

- Staff role visibility, draft validation, total reconciliation, send confirmation, immutability, and copy-link.
- Public safe render, optional selection rules, accept/partial/decline, double-submit prevention, and final state.
- Invalid/expired/revoked/superseded/decided/rate-limited/network states.
- Token is absent from local/session storage, visible copy, console logs, and analytics hooks.
- 360px viewport, focus order, labels, and no horizontal page overflow.

## Definition of Done

- No backend or public-contract changes.
- Existing auth/intake/board/workspace behavior remains green.
- Format, lint, typecheck, tests, and production build pass.

## AI implementation prompt

```text
Bạn đang làm RF-038 — Web quote workspace and public decision portal trong
C:\RepairFlow. Đọc AGENTS.md, docs/tasks/milestone-4/README.md,
docs/tasks/milestone-4/RF-038-web-quote-public-portal.md,
docs/screen-specs.md, docs/rbac.md, docs/domain-rules.md,
docs/openapi.yaml và code web hiện tại.

Trước khi code, tóm tắt staff/public flows, API mapping, role rules, quote
immutability, total reconciliation, token handling, loading/error states và file
ownership. Sau đó triển khai Quote tab, send confirmation/copy link và public
read/decision portal.

Không sửa backend hoặc contract, không triển khai real notification, work, QC,
payment, handover hoặc AI. Test role, validation, totals, token safety, all public
token states, decisions, double submit, viewport 360px và accessibility. Chạy
format, lint, typecheck, test và build. Không commit hoặc push.
```
