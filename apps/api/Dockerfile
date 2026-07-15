# Citrus Care API (Hono) — build from the REPO ROOT so the npm-workspaces
# layout is available:
#   docker build -f apps/api/Dockerfile .
FROM node:22-alpine AS base

FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /repo

# Install workspace dependencies (root lockfile covers apps/* + packages/*).
# All workspace package.json files must be present for `npm ci` to resolve.
COPY package.json package-lock.json* ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN npm ci

FROM base AS runner
WORKDIR /repo

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 hono

COPY --from=deps /repo/node_modules ./node_modules
COPY package.json package-lock.json* ./
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api

USER hono

EXPOSE 3003
ENV API_PORT=3003

# vite-node runs the TypeScript sources directly (same resolution as vitest).
CMD ["npm", "run", "start", "-w", "apps/api"]
