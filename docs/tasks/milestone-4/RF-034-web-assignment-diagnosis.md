# RF-034 — Web assignment and diagnosis workspace

## Objective

Extend the repair-order workspace so permitted staff can assign a technician, start diagnosis, and view or publish diagnosis revisions from desktop and mobile.

## Scope

- Add assignment controls using the active-technician endpoint.
- Show current assignee and reassignment history summary where contracted.
- Show only valid, role-appropriate state actions.
- Add diagnosis tab with ordered immutable revisions and publish/correction form.
- Handle optimistic conflict by reloading and explaining the change.
- Preserve current overview and timeline behavior.

## Outside scope

- Quote editor, public portal, work, QC, handover, staff administration, and AI.
- Client-side authority over permission or status.

## UI flow

1. Workspace loads current user, selected shop, order detail, and active technicians.
2. Owner/receptionist selects an active technician and confirms assignment.
3. When guards allow, owner/receptionist starts diagnosis through the transition API.
4. Owner or active assigned technician opens `Diagnosis`, reads history, and publishes a new revision.
5. On `lockVersion` conflict, keep typed diagnosis text, reload server state, and tell the user what changed.

## Validation and states

- Required finding/recommendation and contract length limits.
- Loading skeleton, empty history, submit progress, API field errors, forbidden state, stale state, and retry.
- Disable double submit but rely on server guards.
- Polling failure keeps displayed workspace data and marks it stale.

## Tenant and role rules

- UI derives available actions from current membership and current assignment but never replaces API authorization.
- Technician sees only assigned orders and cannot access assignment controls.
- Owner can assign and diagnose; receptionist can assign/start but cannot publish diagnosis.

## API/UI involved

- Active-technician discovery.
- Assignment endpoint.
- Transition endpoint.
- Diagnosis endpoint and extended repair-order detail.
- `/orders/[repairOrderId]` workspace.

## Expected files

- `apps/web/src/components/repair-orders/repair-order-workspace.tsx`
- New focused components under `apps/web/src/components/repair-orders/`
- `apps/web/src/lib/api/intake-api.ts` or a renamed staff API client owned by this RF
- `apps/web/src/lib/api/types.ts`
- Component and API-client tests
- `apps/web/src/app/globals.css` only for required workspace styles

## Dependencies

- RF-031, RF-032, and RF-033 merged.

## Acceptance criteria

- Permitted users can assign/reassign and start diagnosis.
- Owner/active technician can publish a revision; receptionist cannot see the publish action.
- History remains readable and immutable.
- Deep links, refresh, loading, empty, error, conflict, and stale states work.
- UI is usable at 360px without horizontal page overflow or hidden primary actions.

## Required tests

- Role-based action visibility.
- Assignment and transition success/error.
- Diagnosis validation, publish, correction, and preserved input after conflict.
- Polling failure keeps stale data.
- Keyboard labels/focus and 360px viewport behavior.

## Definition of Done

- No backend or public-contract changes.
- Existing board/intake/auth tests remain green.
- Format, lint, typecheck, tests, and production build pass.

## AI implementation prompt

```text
Bạn đang làm RF-034 — Web assignment and diagnosis workspace trong C:\RepairFlow.
Đọc AGENTS.md, docs/tasks/milestone-4/README.md,
docs/tasks/milestone-4/RF-034-web-assignment-diagnosis.md,
docs/screen-specs.md, docs/rbac.md, docs/domain-rules.md,
docs/openapi.yaml và code workspace hiện tại.

Trước khi code, tóm tắt UI flow, API mapping, role visibility, validation,
optimistic conflict, stale-data behavior và file ownership. Sau đó triển khai
assignment controls, valid start-diagnosis action và diagnosis history/form.

Không sửa backend hoặc public contract, không triển khai quote, work, QC, handover
hay AI. Test role, loading/empty/error, conflict giữ input, polling failure và
viewport 360px. Chạy format, lint, typecheck, test và build. Không commit hoặc push.
```
