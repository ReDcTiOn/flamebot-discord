#!/usr/bin/env bash
# Команда для ключа автодеплоя из GitHub. Ставится в /usr/local/bin/flamebot-deploy
# (deploy/setup-server.sh) и прописывается в ~/.ssh/authorized_keys пользователя flamebot:
#   command="/usr/local/bin/flamebot-deploy",restrict ssh-ed25519 AAAA... github-deploy
# С таким ключом можно только попросить сервер обновиться из GitHub — ни shell,
# ни своего кода, ни туннелей. Что именно ставить, сервер берёт из репозитория сам.
set -Eeuo pipefail
home=${FLAMEBOT_HOME:-/opt/flamebot}

case "${SSH_ORIGINAL_COMMAND:-}" in
  prod) target=prod ;;
  staging) target=staging ;;
  *) echo "Разрешены только команды: prod, staging." >&2; exit 2 ;;
esac

[[ -x $home/$target/deploy/update.sh ]] || { echo "Копия $target не установлена в $home/$target." >&2; exit 3; }
exec "$home/$target/deploy/update.sh"
