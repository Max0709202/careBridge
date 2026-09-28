# The driver web app (React), built with Vite and served by nginx.
#
# Build from the repository root — the build reads the nginx config under
# infrastructure/:
#
#   docker build -f apps/driver_web/Dockerfile \
#     --build-arg UPLOAD_ORIGIN=https://documents.example.com -t carebridge-driver-web .
#
# Its own image and its own origin, for the reason the ops console has one: a
# different product for different people, and one origin would mean one XSS
# reaches both and one localStorage holds both sessions.
#
# Geolocation needs a secure context. Serve this over HTTPS (localhost is the
# only exception browsers make).

FROM node:22.23.2-alpine AS builder

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/driver_web/package.json apps/driver_web/
RUN pnpm install --frozen-lockfile --filter @carebridge/driver-web

COPY apps/driver_web apps/driver_web

ARG API_BASE_URL=/api/v1
ENV VITE_CAREBRIDGE_API_BASE_URL=${API_BASE_URL}
RUN pnpm --filter @carebridge/driver-web build


FROM nginx:1.27-alpine

# The origin pre-signed document uploads are PUT to, added to connect-src.
# Leave empty when storage is served from this origin.
ARG UPLOAD_ORIGIN=

COPY --from=builder /app/apps/driver_web/dist /usr/share/nginx/html
COPY infrastructure/nginx/carebridge.conf /etc/nginx/conf.d/default.conf
COPY infrastructure/nginx/driver-security-headers.conf /etc/nginx/carebridge/security-headers.conf
RUN case "$UPLOAD_ORIGIN" in *[\ \;\"\'*]*) echo "UPLOAD_ORIGIN must be a single origin" >&2; exit 1;; esac \
 && sed -i "s#__UPLOAD_ORIGIN__#${UPLOAD_ORIGIN}#" /etc/nginx/carebridge/security-headers.conf

EXPOSE 80

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- http://127.0.0.1/ >/dev/null 2>&1 || exit 1
