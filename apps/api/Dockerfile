# Multi-stage: the image that ships carries compiled output and production
# dependencies only — no TypeScript sources, no test tooling, no compiler.

FROM node:22-bookworm-slim AS builder

WORKDIR /app

# Prisma's query engine links against OpenSSL.
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY prisma ./prisma
COPY tsconfig.json ./
COPY src ./src

RUN npx prisma generate && npm run build

# Drop dev dependencies, then regenerate the Prisma client so the pruned tree
# still carries it. Order matters: pruning first and generating second is what
# keeps the compiler and test runner out of the final image without losing the
# generated client.
RUN npm prune --omit=dev && npx prisma generate


FROM node:22-bookworm-slim AS runner

RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package.json ./package.json

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
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
