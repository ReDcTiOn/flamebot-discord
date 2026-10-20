#!/usr/bin/env bash
# Резервная копия базы в backups/. Хранятся последние 14 копий каждого вида.
#   ./deploy/backup.sh                  — обычная копия: backups/flamebot-<дата>.sql.gz
#   ./deploy/backup.sh before-restore   — копия перед восстановлением (её restore.sh сам не выбирает)
# Каждый день по расписанию (crontab -e у пользователя flamebot):
#   30 4 * * * /opt/flamebot/prod/deploy/backup.sh >/dev/null
set -Eeuo pipefail
cd "$(dirname "$(readlink -f "$0")")/.."
umask 077

if ! docker compose ps --status running --services | grep -qx db; then
  echo "База ещё не запущена: копировать нечего."
  exit 0
fi

prefix=${1:-flamebot}
[[ $prefix =~ ^[a-z][a-z-]*$ ]] || { echo "Вид копии — только латиница и дефис."; exit 1; }

mkdir -p backups
stamp=$(date +%Y%m%d-%H%M%S)
file="backups/$prefix-$stamp.sql.gz"
# Две копии в одну секунду не должны затирать друг друга.
n=1
while [[ -e $file ]]; do file="backups/$prefix-$stamp-$n.sql.gz"; n=$((n + 1)); done
# --clean: при восстановлении старые таблицы сначала удаляются, база становится точной копией.
docker compose exec -T db pg_dump -U flamebot -d flamebot --clean --if-exists --no-owner | gzip > "$file.part"
mv "$file.part" "$file"
find backups -maxdepth 1 -name "$prefix-*.sql.gz" -printf '%T@ %p\n' | sort -rn | tail -n +15 | cut -d' ' -f2- | xargs -r rm --
echo "Резервная копия: $file ($(du -h "$file" | cut -f1))"
