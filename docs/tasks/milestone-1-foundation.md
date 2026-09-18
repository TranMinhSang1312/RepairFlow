# Milestone 1 — Monorepo Foundation

This document demonstrates how one milestone becomes bounded implementation tasks.

## RF-001 — Workspace and shared packages

### Scope

- Root pnpm workspace and scripts.
- Shared TypeScript, ESLint, and Prettier configuration.
- `@repairflow/contracts` and `@repairflow/config` packages.

### Acceptance criteria

- Workspace dependencies install from one root command.
- Shared packages build before applications.
- Invalid required environment variables fail fast.
- Format, lint, typecheck, and config tests pass.

## RF-002 — Web foundation

### Scope

- Next.js App Router application.
- Minimal responsive foundation page.
- Web health route.

### Acceptance criteria

- Web runs on port 3000.
- `GET /api/health` returns a typed health payload.
- Production build succeeds.
- No business workflow is implemented.

## RF-003 — API and worker foundation

### Scope

- NestJS API and standalone worker.
- Structured Pino logging with sensitive header redaction.
- Request ID propagation, standard error envelope, and health endpoint.
- Graceful worker shutdown.

### Acceptance criteria

- API runs on port 3001.
- `GET /api/v1/health` returns `200` and `X-Request-Id`.
- Worker starts and stops without exposing secrets.
- API and worker tests/builds pass.

## RF-004 — Local infrastructure, database, and CI

### Scope

- PostgreSQL and private MinIO bucket through Docker Compose.
- Prisma configuration, initial migration, and deterministic seed.
- GitHub Actions quality workflow.

### Acceptance criteria

- `pnpm dev:infra` starts PostgreSQL and MinIO.
- Prisma schema validates and the initial migration applies to an empty database.
- Seed is safe to run repeatedly.
- CI runs format check, lint, typecheck, tests, and build.
- `.env` and runtime secrets are not tracked.

## Out of scope

- Authentication and tenant guards.
- Customer, device, and repair-order endpoints.
- Quote workflow, notifications, and AI providers.
- Production deployment.
