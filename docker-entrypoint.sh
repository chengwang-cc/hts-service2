#!/bin/sh
# Container entrypoint: run pending migrations, then start the app.
#
# Runs the TypeORM CLI against the compiled data-source so every
# container restart leaves the DB at the latest schema before the
# Nest app starts. Previously the data-source's prod migrations path
# pointed at a directory that didn't exist in the runtime image
# (/app/db/migrations rather than /app/dist/db/migrations) — every
# deploy needed a manual `npm run db:run` over an SSH tunnel to
# apply schema. Fixed 2026-06-17.
#
# Failure mode: if the migration step fails, the container exits
# non-zero. ECS treats that as a crash, restarts, and the deployment
# circuit-breaker eventually rolls back to the prior revision. This
# is the right behavior — a broken migration should NOT leak into
# a half-applied state where the app boots against a schema it
# doesn't expect.
#
# Override (for emergency recovery):
#   AUTO_MIGRATE=false  → skip the migration step and boot the app
#                         as-is. Use when ops needs the container up
#                         to inspect data while a migration is being
#                         debugged out-of-band.
set -eu

if [ "${AUTO_MIGRATE:-true}" = "true" ]; then
  echo "[entrypoint] running TypeORM migrations against $DB_HOST..."
  # TypeORM CLI ships in node_modules. We point it at the compiled
  # data-source.js (dist/db/data-source.js) — no ts-node needed at
  # runtime.
  node ./node_modules/typeorm/cli.js migration:run -d ./dist/db/data-source.js
  echo "[entrypoint] migrations OK."
else
  echo "[entrypoint] AUTO_MIGRATE=false; skipping migrations."
fi

# Hand off to the app — exec replaces this shell with node so signals
# (SIGTERM from ECS) reach the Nest process directly.
exec node dist/main.js
