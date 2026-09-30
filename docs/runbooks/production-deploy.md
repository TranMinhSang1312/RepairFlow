# Production deployment and rollback

The three production images share dependency and package build layers from
`docker/production.Dockerfile`. Copy
`.env.production.example` to a secret-managed `.env.production`; never commit it.
The API is kept private behind the web reverse proxy. Set `API_TRUST_PROXY_HOPS`
to the exact number of trusted hops between the API and the client so rate limits
use the real client address. The proxy must overwrite or append `X-Forwarded-For`
consistently; do not expose port 3001 directly.

Before rollout:

1. Verify PostgreSQL automated backups, PITR, SSL, encryption and a tested restore.
2. Verify object-storage versioning, encryption, lifecycle cleanup and an IAM key
   limited to the private bucket.
3. Run `pnpm db:validate`, `pnpm exec prisma migrate deploy`, `pnpm openapi:lint`,
   and the release test/build commands in CI.
4. Record `RELEASE_VERSION`, migration status, backup verification time and the
feature flags in the release evidence.

Validate and build the example package with the same environment file used by
the deployment platform:

```sh
docker compose --env-file .env.production -f docker-compose.production.example.yml config
docker compose --env-file .env.production -f docker-compose.production.example.yml build
```

`NEXT_PUBLIC_OBJECT_STORAGE_ORIGIN` is a build-time value used by the web CSP.
It must be the public HTTPS origin that appears in signed upload/download URLs.

Deploy API first. The container command applies forward-only Prisma migrations
before starting the process. Then deploy the worker and web container. Check
`/api/v1/health/ready`, worker `/health/ready`, login, intake and a signed media
download with synthetic data.

Rollback means redeploying the previous application image while keeping the
database at its latest compatible migration. Never roll back by deleting rows or
reverting a migration. If a migration is not backward compatible, stop traffic,
restore to a new database from the last verified backup, validate the restore
drill, and switch the connection string through the deployment platform.

Provider smoke tests are opt-in and must use synthetic recipients/media. Resend,
DeepSeek, PITR and object versioning require production credentials and cannot be
validated by local CI.
