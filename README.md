# FlameBot

Боты для Discord-сервера RUST-сообщества и общая веб-панель управления.

Сейчас в составе один бот, **Scrap Rank**: опыт за общение в чате, ранги по уровням строительства (Голый → Солома → Дерево → Камень → Металл → МВК), репутация через `/rep` и магазин за скрап. Панель с самого начала рассчитана на нескольких ботов: вход, доступ, журнал действий и данные сервера у них общие, а у каждого бота свой раздел.

## Структура

```
apps/
  rating-bot/   бот Scrap Rank (discord.js)
  panel/        веб-панель (Next.js), вход через Discord
packages/
  core/         схема базы (Prisma), общие правила: ранги, проверка ролей, валидация настроек
```

Бот и панель общаются только через PostgreSQL. Панель не знает токен бота, бот не знает секрет OAuth.

## Команды бота

| Команда | Что делает |
|---|---|
| `/profile [игрок]` | картинка-карточка: ранг, прогресс, скрап, репутация, бейджи, место в топе. Вид настраивается в панели, раздел «Карточка профиля» |
| `/top [по]` | топ-10 по опыту, репутации или скрапу |
| `/rep игрок` | +1 к репутации (с ограничениями от накрутки) |
| `/shop` | магазин: роли, личная роль, бейджи |

## Настройка Discord-приложения

1. Создай приложение на <https://discord.com/developers/applications>.
2. **Bot**: нажми Reset Token и сохрани токен в `.env` как `DISCORD_TOKEN`. Включи **Message Content Intent** (без него бот не видит длину сообщений). Выключи **Public Bot**, чтобы бота не мог добавить кто угодно.
3. **OAuth2**: скопируй Client ID и Client Secret в `.env`. В Redirects добавь `<PANEL_URL>/api/auth/callback`, например `https://panel.example.com/api/auth/callback`.
4. Пригласи бота на сервер по ссылке (подставь свой Client ID):

   ```
   https://discord.com/oauth2/authorize?client_id=CLIENT_ID&scope=bot+applications.commands&permissions=268454912
   ```

   Права: просмотр каналов, отправка сообщений, встраивание ссылок, управление ролями. Больше ничего боту не нужно.
5. В настройках сервера перетащи роль бота **выше** ролей рангов и ролей из магазина, иначе он не сможет их выдавать.

## Локальная разработка

Нужны Node.js 22+, pnpm 10 и PostgreSQL (проще всего в Docker).

```bash
cp .env.example .env
```

Заполни `.env`. Для базы в Docker:

```bash
docker run -d --name flamebot-pg -e POSTGRES_USER=flamebot -e POSTGRES_PASSWORD=devpass -e POSTGRES_DB=flamebot -p 127.0.0.1:5432:5432 postgres:17-alpine
```

и `DATABASE_URL=postgresql://flamebot:devpass@localhost:5432/flamebot`.

```bash
pnpm install
pnpm db:deploy
pnpm dev:rating-bot
pnpm dev:panel
```

Слэш-команды бот регистрирует на сервере сам при каждом запуске.

Панель откроется на <http://localhost:3000>. Войти могут владелец сервера, роли с правом «Администратор» или «Управлять сервером» и роли, отмеченные на странице «Доступ». Бот должен хотя бы раз запуститься: панель проверяет права по снимку ролей, который он записывает.

Проверки перед коммитом:

```bash
pnpm typecheck
pnpm test
```

## Запуск на сервере

На VPS с Docker:

```bash
cp .env.example .env
docker compose up -d --build
```

Compose сам применит миграции базы (сервис `migrate`), затем запустит бота и панель. Обновление после `git pull` — та же команда.

Панель слушает только `127.0.0.1:3000`. Наружу её выставляет reverse proxy с HTTPS, например Caddy:

```
panel.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

С HTTPS панель автоматически включает защищённые cookie (`__Host-`), HSTS и `upgrade-insecure-requests`. В `.env` поставь `PANEL_URL=https://panel.example.com` и `TRUST_PROXY=true`.

## Как подключить нового бота

1. Добавь таблицы бота в `packages/core/prisma/schema.prisma` отдельным разделом и создай миграцию: `pnpm db:migrate`.
2. Создай приложение в `apps/<имя-бота>/` по образцу `apps/rating-bot`. Бот должен раз в минуту отмечаться в таблице `BotStatus` под своим ключом.
3. Добавь страницы в `apps/panel/src/app/(panel)/<ключ>/` и опиши модуль в `apps/panel/src/modules/index.ts`. Главная, меню, журнал и доступ подхватят его сами.
4. Добавь сервис в `docker-compose.yml`.

## Безопасность

Подробности в [SECURITY.md](SECURITY.md). Главное правило: репозиторий публичный, секреты живут только в `.env` на сервере.
