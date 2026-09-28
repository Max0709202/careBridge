# The family web app (React), built with Vite and served by nginx.
#
# Build from the repository root — the build reads web/delete-account.* and the
# nginx config under infrastructure/:
#
#   docker build -f apps/family_web/Dockerfile -t carebridge-family-web .
#
# It is a drop-in for Dockerfile.web: same nginx config, same
# Content-Security-Policy, same same-origin /api proxy. Nothing in the policy
# needs loosening — the bundle has no inline script, no eval, and bundles its
# own fonts.

FROM node:22.23.2-alpine AS builder

WORKDIR /app
RUN corepack enable

# Dependencies on their own layer, so editing source does not reinstall.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/family_web/package.json apps/family_web/
RUN pnpm install --frozen-lockfile --filter @carebridge/family-web

COPY apps/family_web apps/family_web
COPY web/delete-account.html web/delete-account.js web/

# Relative by default: nginx proxies /api from the same origin.
ARG API_BASE_URL=/api/v1
ENV VITE_CAREBRIDGE_API_BASE_URL=${API_BASE_URL}
RUN pnpm --filter @carebridge/family-web build


FROM nginx:1.27-alpine

COPY --from=builder /app/apps/family_web/dist /usr/share/nginx/html
COPY infrastructure/nginx/carebridge.conf /etc/nginx/conf.d/default.conf
COPY infrastructure/nginx/security-headers.conf /etc/nginx/carebridge/security-headers.conf

EXPOSE 80

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- http://127.0.0.1/ >/dev/null 2>&1 || exit 1
