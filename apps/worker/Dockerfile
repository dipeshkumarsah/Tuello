# syntax=docker/dockerfile:1.7
# Multi-stage build for @tuello/worker. Build context: repository root.
ARG NODE_IMAGE=node:22-alpine

FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN npm install -g pnpm@10.28.0 --no-fund --no-audit
WORKDIR /repo

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig.base.json eslint.config.mjs ./
COPY packages ./packages
COPY apps/worker ./apps/worker
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --filter "@tuello/worker..."
RUN pnpm --filter "@tuello/worker..." build
# Self-contained production tree: only runtime deps, workspace packages copied in.
RUN pnpm --filter "@tuello/worker" deploy --prod --legacy /out \
 && cd "$(cd /out && node -p "require('fs').realpathSync(require('path').dirname(require.resolve('@tuello/db/package.json')))")" \
 && node "$(node -p "require.resolve('prisma/build/index.js')")" generate --schema prisma/schema.prisma

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 4100
HEALTHCHECK --interval=15s --timeout=3s --retries=5 CMD wget -qO- http://127.0.0.1:4100/healthz || exit 1
CMD ["node", "dist/main.js"]
