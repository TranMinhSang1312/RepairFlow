# RepairFlow Implementation Plan

Status: proposed plan for `spec-v0.1`

## Delivery strategy

Build a modular monolith through vertical slices. Each milestone must leave the application runnable. Do not assign multiple agents to the same schema or API contract area without explicit file ownership.

## Milestone 0 — Specification freeze

Deliverables:

- Architecture, product specification, domain rules, RBAC, screen specifications.
- OpenAPI contract and Prisma schema.
- AI contracts, error catalogue, and testing strategy.
- Review and tag `spec-v0.1`.

Exit criteria:

- No unresolved naming mismatch among status enums, routes, roles, and model fields.
- Core API operations have request, response, and error definitions.
- Prisma schema parses and formats successfully once tooling is initialized.

## Milestone 1 — Monorepo foundation

Issue group: `RF-001` to `RF-004`.

Deliverables:

- pnpm workspace with `apps/web`, `apps/api`, `apps/worker`.
- Shared TypeScript, lint, formatting, environment validation, and test configuration.
- Prisma CLI configuration with `dotenv` loading `DATABASE_URL` from the local environment.
- PostgreSQL and local S3-compatible storage through Docker Compose.
- Prisma migrations and seed data.
- CI for install, format check, lint, typecheck, test, and build.
- Request ID, structured logging, health endpoints, and error envelope.

Exit criteria:

- One command starts local dependencies and applications.
- CI passes on an empty vertical slice.
- No application contains production secrets.

## Milestone 2 — Identity and tenant boundary

Issue group: `RF-010` to `RF-014`.

Deliverables:

- Register first owner/shop, login, refresh, logout, current user.
- Password hashing, hashed refresh sessions, and rate limiting.
- Shop selection through validated membership.
- Owner membership and branch management.
- Tenant-aware repository base and cross-tenant integration tests.

Exit criteria:

- A user from shop A receives not-found behavior for shop B resources.
- Inactive membership loses access.
- Refresh-token reuse and logout behavior are tested.

## Milestone 3 — Intake vertical slice

Issue group: `RF-020` to `RF-026`.

Deliverables:

- Customer and device create/search/update.
- Presigned media upload flow.
- Intake form and repair-order creation.
- Server-generated order codes, snapshots, accessories, timeline event.
- Repair board and order workspace overview.

Exit criteria:

- Receptionist creates an order with required evidence on mobile viewport.
- Duplicate submission returns the original result.
- Another shop cannot search or fetch the customer, device, media, or order.

## Milestone 4 — Diagnosis, quote, and customer decision

Issue group: `RF-030` to `RF-038`.

Deliverables:

- Assignment and state-machine service.
- Append-only diagnosis revisions.
- Quote drafts, server totals, send transaction, immutable versions.
- Public token creation and filtered portal.
- Idempotent accept/partial accept/decline.
- Transactional outbox and a fake notification adapter.

Exit criteria:

- The full intake-to-approval journey works.
- Old, expired, revoked, and superseded tokens cannot decide.
- Repeated customer submission cannot create multiple decisions.

This milestone is the first external demo and pilot-candidate release.

## Milestone 5 — Repair, QC, handover, and warranty

Issue group: `RF-040` to `RF-049`.

Deliverables:

- Approved-scope work logs and part snapshots.
- Waiting-parts branch and re-quote flow.
- Versioned QC templates and append-only QC runs.
- Payment records, handover transaction, and warranty snapshot.
- Linked warranty order.

Exit criteria:

- Repaired outcome cannot bypass passing QC.
- Completed state cannot occur without physical handover evidence.
- Warranty return leaves the source order unchanged.

## Milestone 6 — Notifications and operations

Issue group: `RF-050` to `RF-055`.

Deliverables:

- Worker claiming/retry/dead-letter behavior for outbox events.
- Email adapter first; Zalo/SMS adapter later.
- Owner-visible failed-job view.
- Backup, restore procedure, error tracking, and basic metrics.

Exit criteria:

- A committed business action cannot lose its pending notification.
- Retrying a job does not send duplicate binding messages.

## Milestone 7 — AI assistance behind feature flags

Issue group: `RF-060` to `RF-064`.

Order:

1. Customer-safe technical summary.
2. Device OCR.
3. Intake draft from audio/text.
4. Checklist suggestion.

Exit criteria:

- Every output passes schema validation and is shown as a draft.
- Provider failure never blocks the core workflow.
- PII redaction, timeout, cost budget, and audit metadata are tested.
- Product analytics can measure acceptance/edit rate and time saved.

## GitHub issue template

Every implementation issue should contain:

```text
ID and title
User value
Required reading
In scope
Out of scope
API/schema contracts affected
Acceptance criteria
Security and tenant checks
Required tests
Owned files/modules
Dependencies
```

## Pull-request order

1. Contract update, when required.
2. Database migration.
3. Backend behavior and tests.
4. Generated/shared client contract.
5. Frontend behavior and tests.
6. Documentation and validation evidence.

One PR may contain the full order for a small vertical slice. Large slices should use stacked PRs without merging consumers before their contract dependency.
