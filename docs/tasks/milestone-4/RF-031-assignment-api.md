# RF-031 — Technician discovery and assignment API

## Objective

Allow an owner or receptionist to discover active technicians and assign or reassign one technician to a tenant-owned repair order while preserving assignment history.

## Scope

- Implement tenant-scoped active-technician discovery defined by RF-030.
- Implement assignment/reassignment endpoint and response mapping.
- Close the previous active assignment and insert the new one in one transaction.
- Append an internal/public-safe timeline event as defined by the contract.
- Update repair-order reads so the active assignee is returned consistently.

## Outside scope

- Invitations, role changes, deactivation, schedules, workload balancing, or automatic assignment.
- Starting diagnosis or changing repair-order status.
- Diagnosis, quote, notification, and UI.

## Flow

1. Authenticate and establish active tenant context.
2. Require `OWNER` or `RECEPTIONIST` capability.
3. Read the order by `(shopId, repairOrderId)`; foreign resources return not found.
4. Validate that the target user has an active `TECHNICIAN` membership in the same shop.
5. In one transaction, close any active assignment, create the new assignment, and append an event.
6. Return the active assignment representation.

## Business and security rules

- A technician cannot assign or reassign themselves.
- Inactive, invited, non-technician, and foreign-shop memberships are not assignable.
- Reassigning to the already active technician is deterministic according to RF-030; prefer returning the current assignment without duplicating history.
- Assignment history is append-only; old rows are closed with `unassignedAt`.
- Tenant filters are mandatory in every query.

## API/UI involved

- `GET /api/v1/technicians`
- `POST /api/v1/repair-orders/{repairOrderId}/assignments`
- Repair-order list/detail assignee mapping
- No UI in this RF.

## Expected files

- `apps/api/src/modules/repair-orders/assignments/*`
- `apps/api/src/modules/repair-orders/repair-orders.module.ts`
- `apps/api/src/common/permissions/capability.ts`
- `apps/api/test/assignments.e2e.test.ts`
- Existing repair-order read mapper/tests where necessary

## Dependencies

- RF-030 merged.
- Existing RF-011 tenant and permission guards.

## Acceptance criteria

- Owner/receptionist can list and assign an active same-shop technician.
- Reassignment closes the previous row and preserves both records.
- Technician, inactive membership, wrong role, wrong shop, and foreign order are rejected correctly.
- Concurrent assignment requests never leave two active assignments.
- Board/detail show the new active assignee.

## Required tests

- Owner and receptionist success.
- Technician forbidden.
- Inactive/non-technician/cross-tenant target.
- Cross-tenant order not found.
- Same-technician retry behavior.
- Reassignment history.
- Concurrent assignment uniqueness and rollback on event failure.

## Definition of Done

- Thin controller, tenant-scoped repository, transactional service, and stable response mapping.
- No direct status changes.
- Format, lint, typecheck, unit/integration tests, and build pass.

## AI implementation prompt

```text
Bạn đang làm RF-031 — Technician discovery and assignment API trong C:\RepairFlow.
Đọc AGENTS.md, docs/tasks/milestone-4/README.md,
docs/tasks/milestone-4/RF-031-assignment-api.md, contract RF-030 đã merge,
docs/domain-rules.md, docs/rbac.md, docs/openapi.yaml,
prisma/schema.prisma và docs/testing-strategy.md.

Trước khi code, tóm tắt contract, role matrix, tenant isolation, transaction,
assignment-history rule và file ownership. Sau đó triển khai technician discovery,
assignment/reassignment, timeline event và assignee response mapping đúng contract.

Không triển khai transition, diagnosis, quote, notification hoặc UI. Viết test cho
role, inactive membership, wrong role, cross-tenant, reassignment, retry cùng kỹ
thuật viên, rollback và concurrent assignment. Chạy format, lint, typecheck, test
và build. Không commit hoặc push.
```
