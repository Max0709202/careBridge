#!/bin/sh
# Migrations run before the process that depends on them accepts traffic.
#
# `migrate deploy` — never `migrate dev` — so a container start can only apply
# migrations that are already committed. Generating one against a production
# database is how a schema drifts away from the repository that is supposed to
# describe it.
set -eu

echo "[entrypoint] Applying database migrations…"
./node_modules/.bin/prisma migrate deploy

if [ "${SEED_ON_START:-false}" = "true" ]; then
  echo "[entrypoint] Seeding demo data…"
  node dist/prisma/seed.js
fi

echo "[entrypoint] Starting API…"
exec "$@"
