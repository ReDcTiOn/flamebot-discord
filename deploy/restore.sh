#!/usr/bin/env bash
# Восстанавливает базу из резервной копии. Текущие данные заменяются копией.
#   ./deploy/restore.sh                              — последняя копия из backups/
#   ./deploy/restore.sh backups/flamebot-....sql.gz  — конкретная копия
# Перед восстановлением текущее состояние сохраняется в backups/before-restore-*.sql.gz,
# так что шаг можно отменить: ./deploy/restore.sh backups/before-restore-....sql.gz
set -Eeuo pipefail
cd "$(dirname "$(readlink -f "$0")")/.."

file=${1:-$(find backups -maxdepth 1 -name 'flamebot-*.sql.gz' -printf '%T@ %p\n' 2>/dev/null | sort -rn | head -n1 | cut -d' ' -f2-)}
[[ -n $file && -f $file ]] || { echo "Копия не найдена. Список: ls backups/"; exit 1; }
gzip -t "$file" || { echo "Файл $file повреждён."; exit 1; }

echo "Восстановить базу из $file? Текущие данные будут заменены."
read -r -p "Напиши yes: " answer
[[ $answer == yes ]] || { echo "Отменено."; exit 1; }

docker compose up -d db
./deploy/backup.sh before-restore
docker compose stop rating-bot online-bot giveaway-bot maps-bot notice-bot panel
# Схема очищается целиком: иначе таблицы, которых нет в копии (например, от более новой миграции),
# остались бы и сломали следующее обновление. Всё в одной транзакции: при ошибке база не изменится.
{
  echo 'SET client_min_messages = warning; DROP SCHEMA public CASCADE; CREATE SCHEMA public;'
  gunzip -c "$file"
} | docker compose exec -T db psql -q --single-transaction -v ON_ERROR_STOP=1 -U flamebot -d flamebot >/dev/null
docker compose up -d
echo "База восстановлена из $file."
