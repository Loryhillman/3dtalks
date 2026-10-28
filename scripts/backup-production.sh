#!/usr/bin/env bash
# Consistent single-process backup: pause the app briefly while snapshotting DB/files.
# Run as root from the deployed checkout. No Docker volumes are deleted.
set -euo pipefail
umask 077
cd "$(dirname "${BASH_SOURCE[0]}")/.."
backup_root=${BACKUP_ROOT:-/opt/3dtalks-backups}
mkdir -p "$backup_root"
backup_root=$(realpath "$backup_root")
chmod 700 "$backup_root"
exec 9> "$backup_root/backup.lock"
flock -n 9 || { echo 'Another backup is already running' >&2; exit 1; }
compose=(docker compose -f compose.yaml -f compose.production.yaml)
app=$("${compose[@]}" ps -q app)
test -n "$app"
test "$(docker inspect --format '{{.State.Running}} {{.State.Paused}}' "$app")" = 'true false'
image=$(docker inspect --format '{{.Image}}' "$app")
stamp=$(date -u +%Y%m%dT%H%M%SZ)
temporary="$backup_root/.incomplete-$stamp"
complete="$backup_root/3dtalks-$stamp"
mkdir "$temporary"
paused=false
resume() { if "$paused"; then docker unpause "$app" >/dev/null; fi; }
trap resume EXIT
docker pause "$app" >/dev/null
paused=true
cp .env "$temporary/environment.env"
git rev-parse HEAD > "$temporary/revision.txt"
printf '%s\n' "$image" > "$temporary/image.txt"
"${compose[@]}" exec -T postgres pg_dump -U postgres -d virtual_world -Fc > "$temporary/database.dump"
docker run --rm --network none --memory=128m --pids-limit=32 --volumes-from "$app:ro" \
  --user 0 --entrypoint tar "$image" -czf - /app/uploads /app/public/uploads \
  /app/public/models /app/public/generated /app/public/uploaded /app/public/scenes \
  /app/public/gallery_content /app/.local-state > "$temporary/files.tar.gz"
test -s "$temporary/database.dump"
gzip -t "$temporary/files.tar.gz"
docker unpause "$app" >/dev/null
paused=false
(cd "$temporary" && sha256sum database.dump files.tar.gz > SHA256SUMS)
mv "$temporary" "$complete"
printf '%s\n' "$complete" > "$backup_root/latest"
# Retain seven completed copies owned by this script. Never prune incomplete copies
# or unrelated backup directories, and validate every resolved deletion target.
mapfile -t copies < <(find "$backup_root" -mindepth 1 -maxdepth 1 -type d -name '3dtalks-*' | sort -r)
for old in "${copies[@]:7}"; do
  [[ ${old##*/} =~ ^3dtalks-[0-9]{8}T[0-9]{6}Z$ ]] || continue
  resolved=$(realpath "$old")
  [[ $resolved == "$backup_root/"* && $resolved != "$backup_root" ]] || exit 1
  rm -rf -- "$resolved"
done
echo "Backup completed: $complete"
