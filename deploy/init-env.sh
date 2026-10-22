#!/usr/bin/env bash
# Мастер настройки .env: спрашивает данные приложения Discord для входа в панель,
# сам генерирует пароль базы и секрет сессий и записывает .env с правами только для владельца.
#   ./deploy/init-env.sh
# Токены ботов здесь не нужны: они задаются в панели, раздел «Подключение» у каждого бота.
# Повторный запуск безопасен: текущие значения подставляются как ответы по умолчанию,
# а пароль базы и секрет сессий сохраняются (новый пароль сломал бы уже созданную базу).
set -Eeuo pipefail
cd "$(dirname "$(readlink -f "$0")")/.."

say() { printf '\033[1;33m%s\033[0m\n' "$*"; }
fail() { printf '\033[1;31m%s\033[0m\n' "$*" >&2; exit 1; }

current() { [[ -f .env ]] && grep -E "^$1=" .env | tail -n1 | cut -d= -f2- | tr -d '"'"'" || true; }

random_hex() {
  if command -v openssl >/dev/null; then openssl rand -hex "$1"
  else od -An -N"$1" -tx1 /dev/urandom | tr -d ' \n'; fi
}

# ask NAME "Вопрос" [по умолчанию] [regex] [hidden]
ask() {
  local name=$1 question=$2 default=${3:-} pattern=${4:-} hidden=${5:-} value
  while true; do
    if [[ -n $default && $hidden == hidden ]]; then question+=" [оставить текущий]"
    elif [[ -n $default ]]; then question+=" [$default]"; fi
    if [[ $hidden == hidden ]]; then
      read -r -s -p "$question: " value; echo
    else
      read -r -p "$question: " value
    fi
    value=${value:-$default}
    if [[ -z $value ]]; then echo "  Нужно значение."; continue; fi
    if [[ -n $pattern && ! $value =~ $pattern ]]; then echo "  Не похоже на правильное значение, попробуй ещё раз."; continue; fi
    printf -v "$name" '%s' "$value"
    return
  done
}

if [[ -f .env ]]; then
  say "Файл .env уже есть. Текущие значения будут ответами по умолчанию, пароль базы и секрет сессий не изменятся."
  read -r -p "Продолжить? Напиши yes: " answer
  [[ $answer == yes ]] || fail "Отменено, .env не изменён."
fi

say "Приложение Discord для входа в панель (https://discord.com/developers/applications)"
ask CLIENT_ID "Application ID (General Information)" "$(current DISCORD_CLIENT_ID)" '^[0-9]{17,20}$'
ask CLIENT_SECRET "Client Secret (OAuth2), ввод скрыт" "$(current DISCORD_CLIENT_SECRET)" '^.{16,}$' hidden
ask GUILD "ID сервера Discord (ПКМ по серверу → Копировать ID)" "$(current GUILD_ID)" '^[0-9]{17,20}$'

say "Панель"
def=$(current PANEL_URL); ask PANEL "Адрес панели, например https://bots.flamerust.gg" "${def:-http://localhost:3000}" '^https?://[^ ]+$'
PANEL=${PANEL%/}
TRUST=false
if [[ $PANEL == https://* ]]; then TRUST=true; fi
def=$(current PANEL_PORT); ask PORT "Порт панели на 127.0.0.1" "${def:-3000}" '^[0-9]{2,5}$'
def=$(current COMPOSE_PROJECT_NAME); ask PROJECT "Имя копии в Docker (flamebot для рабочей, flamebot-staging для тестовой)" "${def:-flamebot}" '^[a-z0-9][a-z0-9_-]*$'

PG=$(current POSTGRES_PASSWORD); PG=${PG:-$(random_hex 24)}
SESSION=$(current SESSION_SECRET); SESSION=${SESSION:-$(random_hex 32)}
RCON=$(current ALLOW_PRIVATE_RCON); RCON=${RCON:-false}
# API бота привязки Steam: у рабочей копии 3010, у тестовой (панель на 3001) — 3011.
LINK_PORT=$(current LINK_API_PORT); LINK_PORT=${LINK_PORT:-$((PORT + 10))}

# Старые переменные оставляем, если они были: боты перенесут их в базу при первом запуске.
legacy=""
for v in DISCORD_TOKEN GIVEAWAY_DISCORD_TOKEN ONLINE_SECRET_KEY; do
  value=$(current "$v")
  if [[ -n $value ]]; then legacy+="$v=$value"$'\n'; fi
done

umask 077
tmp=$(mktemp .env.XXXXXX)
cat > "$tmp" <<EOF
# Создано мастером deploy/init-env.sh $(date '+%Y-%m-%d %H:%M'). Токены ботов задаются в панели.
DISCORD_CLIENT_ID=$CLIENT_ID
DISCORD_CLIENT_SECRET=$CLIENT_SECRET
GUILD_ID=$GUILD
PANEL_URL=$PANEL
TRUST_PROXY=$TRUST
PANEL_PORT=$PORT
LINK_API_PORT=$LINK_PORT
COMPOSE_PROJECT_NAME=$PROJECT
SESSION_SECRET=$SESSION
POSTGRES_PASSWORD=$PG
DATABASE_URL=postgresql://flamebot:$PG@localhost:5432/flamebot
ALLOW_PRIVATE_RCON=$RCON
EOF
if [[ -n $legacy ]]; then
  printf '\n# Старые переменные: боты переносят их в базу при первом запуске, потом строки можно удалить.\n%s' "$legacy" >> "$tmp"
fi
chmod 600 "$tmp"
mv "$tmp" .env

say "Готово: .env записан (доступ только у владельца)."
cat <<EOF

Дальше:
  1. В Developer Portal → OAuth2 → Redirects добавь: $PANEL/api/auth/callback
  2. Запусти: ./deploy/update.sh --restart   (или docker compose up -d --build)
  3. Войди в панель и в каждом боте открой «Подключение», чтобы задать токен Discord.
EOF
