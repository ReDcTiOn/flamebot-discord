#!/usr/bin/env bash
# Обновляет копию FlameBot в этой папке и перезапускает её.
#   ./deploy/update.sh             — свежая версия ветки, на которой стоит папка (prod: main, staging: dev)
#   ./deploy/update.sh <коммит>    — переключиться на конкретный коммит, например для отката
#   ./deploy/update.sh --restart   — пересобрать и перезапустить без загрузки кода (после правки .env)
#
# Порядок: резервная копия базы → git → сборка (старая версия в это время работает) →
# перезапуск с миграциями → проверка. Если проверка не прошла, код возвращается
# на прошлый коммит и собирается заново.
set -Eeuo pipefail
self=$(readlink -f "$0")
cd "$(dirname "$self")/.."

say() { printf '\033[1;33m==> %s\033[0m\n' "$*"; }
fail() { printf '\033[1;31m%s\033[0m\n' "$*" >&2; exit 1; }

[[ -f .env ]] || fail "Нет файла .env. Скопируй образец: cp .env.example .env и заполни."
command -v docker >/dev/null || fail "Docker не установлен (sudo bash deploy/setup-server.sh)."

# Два обновления одновременно (руками и из GitHub) друг другу помешают.
# Блокировку держит отдельный процесс flock (-o): фоновые процессы git и docker её не наследуют
# и не оставляют висеть после выхода скрипта.
if [[ -z ${FLAMEBOT_DEPLOY_LOCKED:-} ]]; then
  rc=0
  FLAMEBOT_DEPLOY_LOCKED=1 flock -n -o -E 75 .deploy.lock "$self" "$@" || rc=$?
  [[ $rc -ne 75 ]] || fail "Обновление уже идёт."
  exit "$rc"
fi

env_value() { grep -E "^$1=" .env | tail -n1 | cut -d= -f2- | tr -d '"'"'" || true; }
port=$(env_value PANEL_PORT)
port=${port:-3000}
project=$(env_value COMPOSE_PROJECT_NAME)
project=${project:-$(basename "$PWD")}

branch=$(git rev-parse --abbrev-ref HEAD)
prev=$(git rev-parse HEAD)
mode=${1:-pull}

if [[ $mode != --restart ]]; then
  # Правки прямо на сервере потеряются при обновлении, поэтому сначала останавливаемся.
  [[ -z $(git status --porcelain --untracked-files=no) ]] \
    || fail "В папке есть изменённые файлы (git status). Перенеси правки в репозиторий или отмени: git checkout -- ."
  say "Загружаю код ($project, ветка $branch)"
  git fetch --quiet origin
fi

case $mode in
  --restart) ;;
  pull)
    git merge --quiet --ff-only "origin/$branch" \
      || fail "Ветка на сервере разошлась с GitHub. Проверь git log, обновление остановлено."
    ;;
  *)
    git cat-file -e "$mode^{commit}" 2>/dev/null || fail "Коммит $mode не найден."
    git reset --quiet --hard "$mode"
    ;;
esac

next=$(git rev-parse HEAD)
if [[ $mode == pull && $next == "$prev" ]] && docker compose ps --status running --services | grep -qx panel; then
  say "Уже последняя версия: $(git log -1 --format='%h %s')"
  exit 0
fi

./deploy/backup.sh || fail "Не удалось сделать резервную копию базы, обновление остановлено."

check() {
  local services
  for _ in $(seq 1 45); do
    services=$(docker compose ps --status running --services)
    if grep -qx rating-bot <<<"$services" && grep -qx online-bot <<<"$services" && grep -qx panel <<<"$services" \
      && curl -fsS -o /dev/null --max-time 3 "http://127.0.0.1:$port/login"; then
      # Бот мог упасть сразу после старта: смотрим, что за пару секунд ничего не перезапустилось.
      sleep 3
      [[ -z $(docker compose ps --status restarting --services) ]] && return 0
    fi
    sleep 2
  done
  return 1
}

start() {
  say "Собираю образы (текущая версия пока работает)"
  docker compose build --pull
  say "Перезапускаю"
  docker compose up -d --remove-orphans
}

if start && check; then
  # Старые образы и кэш сборки копятся с каждым обновлением и за пару месяцев забивают диск.
  # Кэш, которым пользовались за последнюю неделю, остаётся: следующая сборка будет быстрой.
  docker image prune -f >/dev/null
  docker builder prune -f --filter until=168h >/dev/null || true
  say "Готово: $(git log -1 --format='%h %s')"
  if [[ $next != "$prev" ]]; then
    echo "Изменения:"
    git log --format='  %h %s' "$prev..$next" 2>/dev/null || true
  fi
  exit 0
fi

echo
printf '\033[1;31mНовая версия не поднялась.\033[0m Последние логи:\n'
docker compose logs --tail=40 migrate rating-bot online-bot panel || true

if [[ $next == "$prev" ]]; then
  fail "Откатывать некуда: код не менялся. Смотри логи выше и .env."
fi

say "Откатываюсь на ${prev:0:7}"
git reset --quiet --hard "$prev"
if start && check; then
  fail "Вернулась прошлая версия ${prev:0:7}, она работает. Новая (${next:0:7}) — с ошибкой, логи выше.
Если новая версия успела изменить базу, восстанови копию: ./deploy/restore.sh"
fi
fail "Прошлая версия тоже не поднялась. Смотри: docker compose logs"
