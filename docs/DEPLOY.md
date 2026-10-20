# Развёртывание на VPS (Ubuntu)

Схема: на сервере две копии FlameBot из одного репозитория.

| Копия | Папка | Ветка | Панель | Discord |
|---|---|---|---|---|
| Рабочая (prod) | `/opt/flamebot/prod` | `main` | `https://panel.example.com` | твой сервер и твой бот |
| Тестовая (staging) | `/opt/flamebot/staging` | `dev` | `https://staging.example.com` | тестовый сервер и тестовый бот |

Обновление выглядит так: правишь код у себя, отправляешь в `dev`, тестовая копия обновляется сама,
проверяешь её. Всё хорошо — переносишь `dev` в `main`, рабочая копия обновляется сама.
Каждое обновление делает резервную копию базы, а если новая версия не поднялась, сервер сам возвращает прошлую.

Тестовая копия необязательна: без неё всё работает так же, просто обновления сразу идут в рабочую.

## Что нужно

- VPS с Ubuntu 22.04 или 24.04. Памяти 2 ГБ на одну копию, 4 ГБ на рабочую и тестовую вместе.
  На 1 ГБ тоже заработает: скрипт добавит swap, но сборка будет идти долго.
- Домен (или поддомен) с A-записью на IP сервера, чтобы у панели был HTTPS.
  Без домена панель можно открыть через SSH-туннель, см. [в конце](#без-домена).

## 1. Подготовка сервера (один раз)

Зайди на сервер под root и скачай проект:

```bash
apt-get update && apt-get install -y git
git clone https://github.com/ReDcTiOn/flamebot-discord.git /opt/flamebot/prod
bash /opt/flamebot/prod/deploy/setup-server.sh
```

Скрипт поставит Docker и Caddy, включит файрвол (открыты только SSH, 80, 443), автообновления безопасности,
fail2ban и создаст пользователя `flamebot`, от которого работают копии бота.

Чтобы заходить сразу под `flamebot` своим SSH-ключом:

```bash
install -o flamebot -g flamebot -m 600 ~/.ssh/authorized_keys /home/flamebot/.ssh/authorized_keys
```

## 2. Рабочая копия

```bash
sudo -iu flamebot
cd /opt/flamebot/prod
cp .env.example .env
chmod 600 .env
nano .env
```

Что заполнить в `.env`:

- `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `GUILD_ID` — как у тебя на ПК.
- `ONLINE_SECRET_KEY` — **тот же, что на ПК**, если переносишь базу: иначе бот онлайна не прочитает сохранённые пароли RCON.
- `PANEL_URL=https://panel.example.com`, `TRUST_PROXY=true`.
- `COMPOSE_PROJECT_NAME=flamebot`, `PANEL_PORT=3000`.
- `POSTGRES_PASSWORD` и `SESSION_SECRET` — новые: `openssl rand -hex 24` и `openssl rand -hex 32`.

Запуск (первая сборка займёт несколько минут):

```bash
./deploy/update.sh
```

## 3. Домен и HTTPS

1. Открой `/etc/caddy/Caddyfile` (`sudo nano /etc/caddy/Caddyfile`), замени содержимое образцом из
   [deploy/Caddyfile.example](../deploy/Caddyfile.example) со своим доменом и выполни `sudo systemctl reload caddy`.
   Сертификат Caddy выпустит сам.
2. В [Discord Developer Portal](https://discord.com/developers/applications) → OAuth2 → Redirects добавь
   `https://panel.example.com/api/auth/callback`.

Открывай панель и входи через Discord.

## 4. Перенос данных с ПК

Ранги, магазин, игроки и серверы уже настроены у тебя в Docker на ПК — их можно перенести целиком.

**Одновременно бот с одним токеном должен работать только в одном месте**, иначе опыт будет начисляться дважды.

На ПК (Git Bash, в папке проекта):

```bash
docker compose stop rating-bot online-bot panel
docker compose exec -T db pg_dump -U flamebot -d flamebot --clean --if-exists --no-owner | gzip > flamebot.sql.gz
scp flamebot.sql.gz root@IP_СЕРВЕРА:/tmp/
```

На сервере:

```bash
sudo install -d -o flamebot -g flamebot -m 700 /opt/flamebot/prod/backups
sudo install -o flamebot -g flamebot -m 600 /tmp/flamebot.sql.gz /opt/flamebot/prod/backups/
sudo rm /tmp/flamebot.sql.gz
sudo -iu flamebot
cd /opt/flamebot/prod && ./deploy/restore.sh backups/flamebot.sql.gz
```

Когда на сервере всё заработало, на ПК: `docker compose down` (данные на ПК останутся в томе Docker).

## 5. Как выкатывать обновления

Вручную, на сервере:

```bash
sudo -iu flamebot
cd /opt/flamebot/prod && ./deploy/update.sh
```

Скрипт:

1. делает резервную копию базы в `backups/` (хранятся последние 14);
2. забирает код ветки из GitHub;
3. собирает новую версию, пока старая продолжает работать;
4. перезапускает, применяет миграции базы и проверяет, что боты и панель поднялись;
5. если нет — показывает логи и возвращает прошлую версию.

Другие режимы:

```bash
./deploy/update.sh --restart     # после правки .env: пересобрать и перезапустить без загрузки кода
./deploy/update.sh 81d1c32       # откат на конкретный коммит (список: git log --oneline)
./deploy/restore.sh              # вернуть базу из последней резервной копии
```

Перед восстановлением `restore.sh` сохраняет текущую базу в `backups/before-restore-*.sql.gz`,
так что восстановление тоже можно отменить: `./deploy/restore.sh backups/before-restore-....sql.gz`.

Откат кода не откатывает базу. Если новая версия меняла базу (новая миграция) и с ней что-то не так —
после отката кода восстанови базу из копии, которую `update.sh` сделал перед обновлением.

## 6. Тестовая копия (staging)

Нужны **отдельное приложение Discord** (тестовый бот) и **отдельный Discord-сервер** для проверок:
один токен бота не может работать в двух копиях.

1. Создай ветку `dev` у себя: `git checkout -b dev && git push -u origin dev`.
2. На сервере под `flamebot`:

   ```bash
   git clone -b dev https://github.com/ReDcTiOn/flamebot-discord.git /opt/flamebot/staging
   cd /opt/flamebot/staging && cp .env.example .env && chmod 600 .env && nano .env
   ```

   В `.env` тестовой копии: данные тестового приложения Discord и тестового сервера,
   `COMPOSE_PROJECT_NAME=flamebot-staging`, `PANEL_PORT=3001`, `PANEL_URL=https://staging.example.com`,
   `TRUST_PROXY=true`, свои `POSTGRES_PASSWORD`, `SESSION_SECRET` и `ONLINE_SECRET_KEY`
   (`pnpm -F online-bot gen-key` на ПК).
3. `./deploy/update.sh`, затем блок `staging.example.com` в Caddyfile и Redirect
   `https://staging.example.com/api/auth/callback` у тестового приложения в Developer Portal.

База у тестовой копии своя и пустая. Можно залить в неё копию рабочей базы через `restore.sh`,
но тогда серверы онлайна придётся ввести заново: у тестовой копии другой `ONLINE_SECRET_KEY`.

Порядок работы:

```bash
git checkout dev
# ...правки, проверка у себя в Docker...
git push                                  # тестовая копия обновится
# проверил на тестовом сервере Discord — выкатываем в рабочую:
git checkout main && git merge --ff-only dev && git push && git checkout dev
```

## 7. Автодеплой из GitHub

После зелёного CI GitHub сам заходит на сервер и запускает `update.sh`: ветка `dev` обновляет тестовую копию,
`main` — рабочую. Ключ, который для этого хранится в GitHub, на сервере умеет только одно:
попросить обновиться из репозитория. Shell, свой код и туннели с ним недоступны.

На сервере под root:

```bash
ssh-keygen -t ed25519 -N "" -C github-deploy -f /root/deploy_key
echo "command=\"/usr/local/bin/flamebot-deploy\",restrict $(cat /root/deploy_key.pub)" >> /home/flamebot/.ssh/authorized_keys
chown flamebot:flamebot /home/flamebot/.ssh/authorized_keys && chmod 600 /home/flamebot/.ssh/authorized_keys
cat /root/deploy_key        # содержимое — в секрет DEPLOY_SSH_KEY, затем удали файл:
shred -u /root/deploy_key /root/deploy_key.pub
```

На ПК получи отпечаток сервера: `ssh-keyscan IP_СЕРВЕРА` (если SSH не на 22: `ssh-keyscan -p ПОРТ IP_СЕРВЕРА`).

В GitHub: репозиторий → Settings → Secrets and variables → Actions.

| Тип | Имя | Значение |
|---|---|---|
| Secret | `DEPLOY_SSH_KEY` | приватный ключ целиком, с строками BEGIN/END |
| Secret | `DEPLOY_HOST` | IP или домен сервера |
| Secret | `DEPLOY_KNOWN_HOSTS` | вывод `ssh-keyscan` |
| Secret | `DEPLOY_PORT` | порт SSH, если не 22 |
| Variable | `DEPLOY_ENABLED` | `true` |

Чтобы рабочая копия обновлялась только после твоего подтверждения: Settings → Environments → `production` →
Required reviewers → добавь себя. Тогда в Actions у деплоя появится кнопка Approve.

Запустить деплой руками: Actions → Deploy → Run workflow → выбрать `staging` или `prod`.

Если тестовая копия не нужна, просто не создавай `/opt/flamebot/staging`: деплой из `dev` завершится с ошибкой
«Копия staging не установлена», рабочая копия от этого не пострадает.

## Повседневное

```bash
cd /opt/flamebot/prod
docker compose ps                       # что запущено
docker compose logs -f --tail=100 rating-bot   # логи бота (online-bot, panel — аналогично)
./deploy/backup.sh                      # резервная копия прямо сейчас
```

Резервная копия каждый день в 4:30 — `crontab -e` под `flamebot`, строка:

```
30 4 * * * /opt/flamebot/prod/deploy/backup.sh >/dev/null
```

Копии лежат на том же сервере. Чтобы пережить потерю сервера, время от времени забирай их к себе:
`scp flamebot@IP_СЕРВЕРА:/opt/flamebot/prod/backups/*.sql.gz .`

## Безопасность сервера

- `.env` — только у `flamebot` (`chmod 600`), в git он не попадает.
- Порт 3000/3001 наружу не открывай: панель доступна только через Caddy с HTTPS.
- Когда вход по SSH-ключу проверен, отключи вход по паролю: в `/etc/ssh/sshd_config` поставь
  `PasswordAuthentication no` и выполни `sudo systemctl reload ssh`. Сначала убедись, что ключ работает,
  иначе закроешь себе доступ.
- В группе `docker` только `flamebot`: эта группа даёт права, равные root.

## Без домена

Панель можно открывать через SSH-туннель, тогда Caddy и домен не нужны.
В `.env`: `PANEL_URL=http://localhost:3000`, `TRUST_PROXY=false`, Redirect в Developer Portal —
`http://localhost:3000/api/auth/callback`. На ПК:

```bash
ssh -N -L 3000:127.0.0.1:3000 flamebot@IP_СЕРВЕРА
```

и открывай `http://localhost:3000`, пока туннель запущен.
