#!/usr/bin/env bash
set -euo pipefail
migration_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
container="protect-manager-role-check-$RANDOM-$$"
trap 'docker rm -f "$container" >/dev/null 2>&1 || true' EXIT
docker run --rm -d --name "$container" -e POSTGRES_PASSWORD=test postgres:16-alpine >/dev/null
# TCP excludes the temporary Unix-socket-only server used during initdb.
for _ in $(seq 1 30); do
  if docker exec "$container" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec "$container" pg_isready -h 127.0.0.1 -U postgres >/dev/null
docker cp "$migration_dir/protect-manager-role.check.sql" "$container:/tmp/role-check.sql"
docker cp "$migration_dir/20260920200000_protect_manager_role_on_insert.sql" "$container:/tmp/20260920200000_protect_manager_role_on_insert.sql"
docker exec "$container" psql -U postgres -v ON_ERROR_STOP=1 -f /tmp/role-check.sql
