#!/usr/bin/env bash
# Write a compressed pg_dump archive of the Fortuna database.
#   DATABASE_URL=... scripts/backup-postgres.sh /existing/dir/fortuna-$(date +%F).dump
set -euo pipefail
if [[ -z ${DATABASE_URL:-} || $# -ne 1 ]]; then
	echo "Usage: DATABASE_URL=... scripts/backup-postgres.sh /existing/directory/fortuna.dump" >&2
	exit 2
fi
command -v pg_dump >/dev/null || { echo "pg_dump is required" >&2; exit 2; }
output=$1
[[ -d $(dirname "$output") ]] || { echo "Directory does not exist: $(dirname "$output")" >&2; exit 2; }
[[ -e $output ]] && { echo "Refusing to overwrite: $output" >&2; exit 2; }
umask 077
partial="${output}.partial.$$"
trap 'rm -f -- "$partial"' EXIT INT TERM
pg_dump --dbname="$DATABASE_URL" --format=custom --no-owner --no-privileges --file="$partial"
[[ -s $partial ]] || { echo "pg_dump produced an empty archive" >&2; exit 1; }
mv -- "$partial" "$output"
trap - EXIT INT TERM
echo "Backup written to $output"
