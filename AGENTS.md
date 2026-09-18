# RepairFlow Agent Instructions

These instructions apply to the entire repository. More specific `AGENTS.md` files may narrow rules for a subdirectory but must not weaken product invariants or security rules defined here.

## Required reading

Before changing code, read these sources in order:

1. `docs/product-spec.md`
2. `docs/domain-rules.md`
3. `docs/architecture.md`
4. `docs/rbac.md`
5. `docs/screen-specs.md`
6. `docs/openapi.yaml`
7. `prisma/schema.prisma`
8. The GitHub issue assigned to the change

For AI work, also read `docs/ai-contracts.md`. For test work, read `docs/testing-strategy.md`.

## Sources of truth

Use the following precedence when documents overlap:

1. Business behavior and state transitions: `docs/domain-rules.md`
2. Authorization: `docs/rbac.md`
3. HTTP request and response shape: `docs/openapi.yaml`
4. Persisted data shape: `prisma/schema.prisma`
5. Screen behavior: `docs/screen-specs.md`
6. System boundaries and deployment: `docs/architecture.md`
7. Delivery order: `docs/implementation-plan.md`

Do not silently resolve conflicts between sources. Record the conflict in the pull request and update all affected contracts in the same change after the decision is made.

## Architecture rules

- Keep the backend as a NestJS modular monolith. Do not introduce microservices.
- The frontend must never access PostgreSQL directly.
- Business modules communicate through public services or internal domain events, not another module's repository.
- Every business query and mutation must run with an authenticated `shopId` tenant context.
- Never trust `shopId`, role, totals, state, or ownership supplied by a client.
- A supplied `X-Shop-Id` is only a selector. The API must validate active membership before creating tenant context.
- Repair-order status changes must use the repair-order state-machine service. Do not update `status` directly.
- A quote in `SENT` or any terminal state is immutable. Changes require a new version.
- Store money as integer VND. Never use floating point for money.
- Store files in private object storage. PostgreSQL stores metadata and object keys only.
- Use transactional outbox records for notifications and external side effects tied to business transactions.
- AI providers may only be called through the AI Gateway from a background job.
- AI output is an untrusted draft. Validate its schema and require human confirmation before changing business data.

## Security and privacy

- Public customer tokens must be random, scoped, expiring, revocable, and stored only as hashes.
- Never write access tokens, refresh tokens, customer public tokens, device PINs, passwords, or secrets to logs.
- Do not store a device unlock credential in ordinary fields or notes.
- Private notes, internal costs, audit payloads, and staff identities must not appear in the customer portal.
- Media access uses short-lived signed URLs after an authorization check.
- Validate upload size, MIME type, and ownership.
- Apply rate limits to authentication and public endpoints.
- Cross-tenant access tests are mandatory for every new repository or endpoint.

## API and database changes

- Validate all external input at the API boundary.
- Return errors using `docs/error-codes.md`.
- Use an `Idempotency-Key` for quote decisions, handovers, and payment creation.
- API contract changes require an update to `docs/openapi.yaml` in the same pull request.
- Database changes require a Prisma migration. Never edit a deployed database manually.
- Do not delete or rewrite audit, timeline, diagnosis, sent quote, work-log, or approval history.
- Use a new record or an explicit superseding reference when correcting append-only data.
- Add indexes for tenant-scoped list and lookup queries introduced by a change.

## Development workflow

- Work on one GitHub issue per branch.
- Use branch names such as `feat/RF-005-public-quote-approval`.
- Keep a pull request limited to its acceptance criteria.
- Do not perform unrelated refactors or rename public contracts without an issue.
- One agent owns a file-changing task at a time. Coordinate changes to `schema.prisma` and `openapi.yaml` before parallel implementation.
- Prefer generated clients/types from OpenAPI or shared schemas over handwritten duplicates.
- Keep controllers thin; put business decisions in domain/application services.
- External providers must sit behind interfaces and have deterministic fakes for tests.

## Required checks

Before declaring a task complete, run the repository commands for:

```text
format check
lint
typecheck
unit tests
integration tests relevant to the change
build
```

The exact commands will be added to the root `package.json` when the monorepo is initialized.

## Definition of done

A task is complete only when:

- Its acceptance criteria pass.
- Authorization and tenant boundaries are enforced server-side.
- State transitions and monetary totals are calculated server-side.
- Relevant tests cover successful and rejected paths.
- Prisma migrations and OpenAPI changes are included when applicable.
- Logs and customer responses contain no sensitive data.
- Documentation matches the final behavior.
- The pull request explains the behavior change and validation performed.

