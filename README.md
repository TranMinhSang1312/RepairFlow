# RepairFlow

RepairFlow is a multi-tenant SaaS for operating phone, laptop, and tablet repair shops from intake through quote approval, repair, quality control, handover, and warranty.

The repository is specification-first. Read [AGENTS.md](./AGENTS.md) and the documents under [`docs/`](./docs/) before implementing code.

## Workspace

```text
apps/web       Next.js staff dashboard and customer portal
apps/api       NestJS modular monolith
apps/worker    Background jobs, notifications, and AI tasks
packages/*     Shared contracts, UI, configuration, and observability
prisma/        PostgreSQL schema and migrations
```

## Current status

The `spec-v0.1` contracts are frozen and Milestone 1 provides the runnable monorepo foundation. Business features begin with Milestone 2.

## Local setup

Requirements: Node.js 24+, pnpm 11+, and Docker Desktop.

```cmd
copy .env.example .env
pnpm install
pnpm dev:infra
pnpm db:migrate
pnpm db:seed
pnpm dev:apps
```

After the database has been initialized, `pnpm dev` builds shared packages, starts Docker infrastructure, and runs all three applications.

Local endpoints:

- Web: `http://localhost:3000`
- Web health: `http://localhost:3000/api/health`
- API health: `http://localhost:3001/api/v1/health`
- MinIO console: `http://localhost:9001`

Quality checks:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## Documentation order

1. `docs/product-spec.md`
2. `docs/domain-rules.md`
3. `docs/architecture.md`
4. `docs/rbac.md`
5. `docs/screen-specs.md`
6. `docs/openapi.yaml`
7. `prisma/schema.prisma`
8. `docs/ai-contracts.md`
9. `docs/error-codes.md`
10. `docs/testing-strategy.md`
11. `docs/implementation-plan.md`

## License

No license has been granted yet.
