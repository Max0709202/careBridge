# Multi-stage: the image that ships carries compiled output and production
# dependencies only — no TypeScript sources, no test tooling, no compiler.
#
# The build context is the **repository root**, not apps/api, because the API
# now resolves through the pnpm workspace: its lockfile and its shared
# tsconfig/eslint packages live above it. `pnpm deploy` is what makes that
# affordable — it materialises a self-contained, hoisted node_modules for one
# workspace package, so the runner stage never needs to know a workspace
# existed.

FROM node:22-bookworm-slim AS builder

# Prisma's query engine links against OpenSSL.
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
# Non-interactive: pnpm otherwise refuses to purge a modules directory without
# a TTY and aborts the build rather than asking.
ENV CI=true
RUN corepack enable

WORKDIR /repo

# Manifests first, on their own layer, so editing source does not re-resolve
# the dependency graph.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/api/package.json ./apps/api/
COPY packages/typescript-config/package.json ./packages/typescript-config/
COPY packages/eslint-config/package.json ./packages/eslint-config/
COPY packages/contracts/package.json ./packages/contracts/

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @carebridge/api...

COPY packages/typescript-config ./packages/typescript-config
COPY packages/contracts ./packages/contracts
COPY apps/api/prisma ./apps/api/prisma
COPY apps/api/tsconfig.json ./apps/api/
COPY apps/api/src ./apps/api/src

WORKDIR /repo/apps/api
RUN pnpm exec prisma generate && pnpm run build

# A pruned, production-only tree with the workspace links resolved to real
# directories. Order matters: deploy first, regenerate the Prisma client into
# the deployed tree second — the generated client is not something pnpm can
# copy, because it did not come from the registry.
WORKDIR /repo
# Two details here are the difference between this working and not:
#
#   * `rm -rf` before the copy, not `cp -r` onto an existing directory. Whether
#     `pnpm deploy` carries `dist` across depends on how it resolves the ignore
#     rules, and `cp -r src dest` onto an existing `dest` nests rather than
#     replaces. Being explicit makes the result the same either way.
#
#   * The Prisma CLI is invoked **directly**, not through `pnpm exec`. The
#     deployed tree is outside the workspace and carries no `packageManager`
#     field, so `pnpm exec` there makes corepack fetch whatever pnpm is newest
#     and then run a dependency-status check that tries to reinstall the tree
#     we just carefully pruned. The binary is right there; use it.
RUN pnpm deploy --filter @carebridge/api --prod /deploy \
    && rm -rf /deploy/dist \
    && cp -r /repo/apps/api/dist /deploy/dist \
    && cd /deploy \
    && ./node_modules/.bin/prisma generate


FROM node:22-bookworm-slim AS runner

RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /deploy/node_modules ./node_modules
COPY --from=builder /deploy/dist ./dist
COPY --from=builder /deploy/prisma ./prisma
COPY --from=builder /deploy/package.json ./package.json

COPY apps/api/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh && chown -R node:node /app

# Never root. A container process that does not need to write outside its own
# directory has no reason to be able to.
USER node

EXPOSE 3000

# Liveness, not readiness: a database blip must not get the container killed and
# restarted, which would turn a recoverable outage into a crash loop.
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=5 \
    CMD curl -fsS http://127.0.0.1:3000/api/v1/health/live || exit 1

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/src/main.js"]
