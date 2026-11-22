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
apps=(link-bot rating-bot online-bot giveaway-bot maps-bot notice-bot panel)
selected=()
# HEAD мог измениться до прерванной сборки. Сравниваем с последним проверенным запуском.
deployed_file=$(git rev-parse --git-path flamebot-deployed)
apply_pending="$deployed_file.pending"
deployed=""
if [[ -f $deployed_file ]]; then
  deployed=$(<"$deployed_file")
  if [[ ! $deployed =~ ^[0-9a-f]{40,64}$ ]] || ! git cat-file -e "$deployed^{commit}" 2>/dev/null; then
    deployed=""
  fi
fi
rollback=${deployed:-$prev}

all_running() {
  local services=$1 service
  for service in db "${apps[@]}"; do
    grep -qxF "$service" <<<"$services" || return 1
  done
}

full=1
if [[ $mode == pull && -n $deployed && ! -e $apply_pending ]] && all_running "$(docker compose ps --status running --services)"; then
  full=0
  changed=$(git -c core.quotepath=false diff --no-renames --name-only "$deployed" "$next") \
    || fail "Не удалось определить изменённые сервисы."
  while IFS= read -r file; do
    case $file in
      apps/*/package.json) full=1; break ;;
      apps/link-bot/*|apps/rating-bot/*|apps/online-bot/*|apps/giveaway-bot/*|apps/maps-bot/*|apps/notice-bot/*|apps/panel/*)
        service=${file#apps/}
        service=${service%%/*}
        if [[ " ${selected[*]} " != *" $service "* ]]; then selected+=("$service"); fi
        ;;
      ''|README.md|SECURITY.md|docs/*|.github/*) ;;
      *) full=1; break ;;
    esac
  done <<<"$changed"
fi

save_deployed() {
  printf '%s\n' "$1" > "$deployed_file.tmp" && mv -f -- "$deployed_file.tmp" "$deployed_file" && rm -f -- "$apply_pending"
}

if [[ $full == 0 && ${#selected[@]} == 0 ]]; then
  save_deployed "$next" || fail "Не удалось записать версию запуска."
  say "Образы обновлять не требуется: $(git log -1 --format='%h %s')"
  exit 0
fi

./deploy/backup.sh || fail "Не удалось сделать резервную копию базы, обновление остановлено."

check() {
  local services restarting
  for _ in $(seq 1 45); do
    services=$(docker compose ps --status running --services) || return 1
    if all_running "$services" \
      && curl -fsS -o /dev/null --max-time 3 "http://127.0.0.1:$port/login"; then
      # Бот мог упасть сразу после старта: смотрим, что за пару секунд ничего не перезапустилось.
      sleep 3
      restarting=$(docker compose ps --status restarting --services) || return 1
      [[ -z $restarting ]] && return 0
    fi
    sleep 2
  done
  return 1
}

start() {
  if [[ $full == 1 ]]; then
    say "Собираю все образы (текущая версия пока работает)"
    docker compose --parallel 1 build --pull || return 1
    say "Обновляю сервисы и проверяю миграции"
    : > "$apply_pending" || return 1
    docker compose up -d --no-build --remove-orphans
  else
    say "Собираю: ${selected[*]}"
    docker compose --parallel 1 build --pull "${selected[@]}" || return 1
    say "Обновляю: ${selected[*]}"
    : > "$apply_pending" || return 1
    docker compose up -d --no-deps --no-build "${selected[@]}"
  fi
}

if start && check; then
  save_deployed "$next" || fail "Контейнеры запущены, но не удалось записать версию запуска."
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
docker compose logs --tail=40 migrate link-bot rating-bot online-bot giveaway-bot maps-bot notice-bot panel || true

if [[ $next == "$rollback" ]]; then
  fail "Откатывать некуда: код не менялся. Смотри логи выше и .env."
fi

say "Откатываюсь на ${rollback:0:7}"
git reset --quiet --hard "$rollback"
if start && check; then
  save_deployed "$rollback" || fail "Прошлая версия запущена, но не удалось записать версию запуска."
  fail "Вернулась прошлая версия ${rollback:0:7}, она работает. Новая (${next:0:7}) — с ошибкой, логи выше.
Если новая версия успела изменить базу, восстанови копию: ./deploy/restore.sh"
fi
fail "Прошлая версия тоже не поднялась. Смотри: docker compose logs"
