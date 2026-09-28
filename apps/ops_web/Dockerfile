# The ops console (React), built with Vite and served by nginx.
#
# Build from the repository root — the build reads the nginx config under
# infrastructure/:
#
#   docker build -f apps/ops_web/Dockerfile -t carebridge-ops-web .
#
# A drop-in for Dockerfile.ops: its own image and its own origin, for the same
# reasons — a dispatcher's console is a different product for different people,
# one origin would mean one XSS reaches both surfaces, and a separate origin
# can sit behind an office allowlist without touching the family app. Same
# nginx config, same same-origin /api proxy, same Content-Security-Policy.
# Nothing in the policy needs loosening: the bundle has no inline script, no
# eval, and bundles its own fonts.

FROM node:22.23.2-alpine AS builder

WORKDIR /app
RUN corepack enable

# Dependencies on their own layer, so editing source does not reinstall.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/ops_web/package.json apps/ops_web/
RUN pnpm install --frozen-lockfile --filter @carebridge/ops-web

COPY apps/ops_web apps/ops_web

# Relative by default: nginx proxies /api from the same origin.
ARG API_BASE_URL=/api/v1
ENV VITE_CAREBRIDGE_API_BASE_URL=${API_BASE_URL}
RUN pnpm --filter @carebridge/ops-web build


FROM nginx:1.27-alpine

COPY --from=builder /app/apps/ops_web/dist /usr/share/nginx/html
COPY infrastructure/nginx/carebridge.conf /etc/nginx/conf.d/default.conf
COPY infrastructure/nginx/security-headers.conf /etc/nginx/carebridge/security-headers.conf

EXPOSE 80

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- http://127.0.0.1/ >/dev/null 2>&1 || exit 1
