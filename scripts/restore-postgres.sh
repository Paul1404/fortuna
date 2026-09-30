#!/usr/bin/env bash
# Restore a pg_dump custom-format archive into the Fortuna database.
# Replaces existing objects. Stop the app (or point at an empty database) first.
#   DATABASE_URL=... scripts/restore-postgres.sh /path/fortuna.dump
set -euo pipefail
if [[ -z ${DATABASE_URL:-} || $# -ne 1 || ! -f $1 ]]; then
	echo "Usage: DATABASE_URL=... scripts/restore-postgres.sh /path/fortuna.dump" >&2
	exit 2
fi
command -v pg_restore >/dev/null || { echo "pg_restore is required" >&2; exit 2; }
pg_restore --dbname="$DATABASE_URL" --clean --if-exists --no-owner --no-privileges --exit-on-error "$1"
echo "Restore completed from $1"
