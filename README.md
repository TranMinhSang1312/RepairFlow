# RepairFlow

RepairFlow is a multi-tenant SaaS for operating phone, laptop, and tablet repair shops from intake through quote approval, repair, quality control, handover, and warranty.

The repository is specification-first. Read [AGENTS.md](./AGENTS.md) and the documents under [`docs/`](./docs/) before implementing code.

## Planned workspace

```text
apps/web       Next.js staff dashboard and customer portal
apps/api       NestJS modular monolith
apps/worker    Background jobs, notifications, and AI tasks
packages/*     Shared contracts, UI, configuration, and observability
prisma/        PostgreSQL schema and migrations
```

## Current status

The product and technical contracts are being defined. Application scaffolding starts after the `spec-v0.1` milestone is reviewed.

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
