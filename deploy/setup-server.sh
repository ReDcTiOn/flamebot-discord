#!/usr/bin/env bash
# Первичная настройка чистого Ubuntu 22.04 / 24.04 под FlameBot. Запускается один раз от root:
#   sudo bash /opt/flamebot/prod/deploy/setup-server.sh
#
# Что делает:
#   - ставит Docker и Caddy из официальных репозиториев;
#   - включает файрвол: наружу открыты только SSH, 80 и 443;
#   - включает автоматические обновления безопасности и fail2ban для SSH;
#   - ограничивает размер логов Docker;
#   - добавляет swap, если памяти мало (сборка панели требует ~2 ГБ);
#   - создаёт пользователя flamebot, от которого живут копии бота в /opt/flamebot;
#   - ставит команду flamebot-deploy для автодеплоя из GitHub (см. docs/DEPLOY.md).
# Повторный запуск безопасен.
set -Eeuo pipefail

APP_USER=flamebot
APP_HOME=/opt/flamebot

log() { printf '\n\033[1;33m==> %s\033[0m\n' "$*"; }

[[ $EUID -eq 0 ]] || { echo "Запусти через sudo: sudo bash $0"; exit 1; }
# shellcheck source=/dev/null
. /etc/os-release
[[ ${ID:-} == ubuntu ]] || { echo "Скрипт рассчитан на Ubuntu, а тут ${PRETTY_NAME:-неизвестная система}."; exit 1; }
export DEBIAN_FRONTEND=noninteractive

log "Пакеты системы"
apt-get update -q
apt-get install -y -q ca-certificates curl gnupg git ufw fail2ban unattended-upgrades \
  debian-keyring debian-archive-keyring apt-transport-https

log "Репозитории Docker и Caddy"
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
  > /etc/apt/sources.list.d/docker.list
curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key \
  | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
chmod a+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt \
  -o /etc/apt/sources.list.d/caddy-stable.list
apt-get update -q
apt-get install -y -q docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin caddy

log "Логи Docker: не больше 30 МБ на контейнер"
if [[ ! -f /etc/docker/daemon.json ]]; then
  cat > /etc/docker/daemon.json <<'JSON'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}
JSON
fi
systemctl enable --now docker
systemctl restart docker
systemctl enable --now caddy

log "Файрвол"
# Порт SSH берём из настроек sshd, чтобы не закрыть себе доступ, если он не 22.
ssh_ports=$(sshd -T 2>/dev/null | awk '$1 == "port" { print $2 }' || true)
for p in ${ssh_ports:-22}; do ufw allow "$p/tcp" comment "SSH" >/dev/null; done
ufw allow 80/tcp comment "HTTP (Caddy)" >/dev/null
ufw allow 443/tcp comment "HTTPS (Caddy)" >/dev/null
ufw allow 443/udp comment "HTTP/3 (Caddy)" >/dev/null
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw --force enable
# Docker публикует только 127.0.0.1:3000/3001, так что в обход ufw наружу ничего не торчит.

log "Автообновления безопасности и fail2ban"
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'CONF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
CONF
systemctl enable --now fail2ban

log "Swap"
mem_mb=$(awk '/MemTotal/ { print int($2 / 1024) }' /proc/meminfo)
if [[ -z $(swapon --show --noheadings) && $mem_mb -lt 3500 ]]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo "Добавлен swap 2 ГБ (памяти ${mem_mb} МБ)."
else
  echo "Swap не нужен или уже есть."
fi

log "Пользователь $APP_USER"
if ! id "$APP_USER" >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" "$APP_USER"
fi
# Группа docker даёт права, равные root: в неё добавляем только этого пользователя.
usermod -aG docker "$APP_USER"
install -d -m 0750 -o "$APP_USER" -g "$APP_USER" "$APP_HOME"
if [[ -d $APP_HOME/prod ]]; then chown -R "$APP_USER:$APP_USER" "$APP_HOME/prod"; fi
if [[ -d $APP_HOME/staging ]]; then chown -R "$APP_USER:$APP_USER" "$APP_HOME/staging"; fi
install -d -m 0700 -o "$APP_USER" -g "$APP_USER" "/home/$APP_USER/.ssh"

log "Команда автодеплоя"
# Копия вне репозитория: обновление кода не может подменить то, что запускает ключ деплоя.
install -m 0755 "$(dirname "$(readlink -f "$0")")/ssh-deploy.sh" /usr/local/bin/flamebot-deploy

log "Готово"
cat <<EOF
Дальше (подробно в docs/DEPLOY.md):
  1. sudo -iu $APP_USER
  2. cd $APP_HOME/prod && cp .env.example .env && nano .env
  3. ./deploy/update.sh
  4. Пропиши домен в /etc/caddy/Caddyfile (образец: deploy/Caddyfile.example) и sudo systemctl reload caddy
EOF
