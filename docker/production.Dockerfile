FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
ENV NODE_ENV=development
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY prisma.config.ts prisma.config.ts
COPY prisma/schema.prisma prisma/schema.prisma
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/security/package.json packages/security/package.json
RUN DATABASE_URL=postgresql://repairflow:repairflow@localhost:5432/repairflow \
    pnpm install --frozen-lockfile --prod=false

FROM dependencies AS source
COPY . .
RUN pnpm build:packages

FROM source AS api
RUN pnpm --filter @repairflow/api build
ENV NODE_ENV=production
USER node
EXPOSE 3001
CMD ["node", "apps/api/dist/main.js"]

FROM source AS worker
RUN pnpm --filter @repairflow/worker build
ENV NODE_ENV=production
USER node
EXPOSE 3002
CMD ["node", "apps/worker/dist/index.js"]

FROM source AS web
ARG NEXT_PUBLIC_OBJECT_STORAGE_ORIGIN=https://s3.example.com
ENV NODE_ENV=production
ENV NEXT_PUBLIC_OBJECT_STORAGE_ORIGIN=${NEXT_PUBLIC_OBJECT_STORAGE_ORIGIN}
RUN pnpm --filter @repairflow/web build
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
USER node
EXPOSE 3000
CMD ["node", "apps/web/.next/standalone/apps/web/server.js"]
