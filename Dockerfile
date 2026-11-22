# Один Dockerfile на весь монорепозиторий. Цели:
#   build      — ядро и исходники для миграций и импорта
#   link-bot   — бот привязки Steam к Discord (и HTTP API для плагина на игровых серверах)
#   rating-bot — рейтинг-бот
#   online-bot — бот онлайна серверов
#   giveaway-bot — бот розыгрышей
#   maps-bot   — бот карт вайпов (RustMaps, S3, Discord, Pterodactyl, Telegram)
#   notice-bot — бот объявлений о вайпах (Telegram, Discord, ВКонтакте, gamestores)
#   panel      — веб-панель

FROM node:22-alpine AS deps
RUN apk add --no-cache openssl && corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY apps/link-bot/package.json apps/link-bot/
COPY apps/rating-bot/package.json apps/rating-bot/
COPY apps/online-bot/package.json apps/online-bot/
COPY apps/giveaway-bot/package.json apps/giveaway-bot/
COPY apps/maps-bot/package.json apps/maps-bot/
COPY apps/notice-bot/package.json apps/notice-bot/
COPY apps/panel/package.json apps/panel/
RUN pnpm install --frozen-lockfile

FROM deps AS core-build
# Prisma нужен адрес базы только для проверки схемы, подключения при сборке нет.
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
COPY packages/core packages/core
# Права файлов приходят из папки на сервере. Если git писал их со строгим umask (077), боты
# под пользователем node не прочитают package.json ядра и упадут с ERR_MODULE_NOT_FOUND.
RUN chmod -R a+rX package.json pnpm-workspace.yaml packages
RUN pnpm -F @flamebot/core build

# Исходники приложений нужны CLI импорта, которые запускаются через сервис migrate.
FROM core-build AS build
COPY apps apps

FROM core-build AS link-bot-build
COPY apps/link-bot apps/link-bot
RUN chmod -R a+rX apps/link-bot
RUN pnpm -F link-bot build

FROM node:22-alpine AS link-bot
RUN apk add --no-cache openssl
ENV NODE_ENV=production
WORKDIR /app
COPY --from=core-build /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=core-build /app/node_modules ./node_modules
COPY --from=core-build /app/packages/core ./packages/core
COPY --from=link-bot-build /app/apps/link-bot/package.json ./apps/link-bot/package.json
COPY --from=link-bot-build /app/apps/link-bot/node_modules ./apps/link-bot/node_modules
COPY --from=link-bot-build /app/apps/link-bot/dist ./apps/link-bot/dist
# Том бота: здесь лежит его ключ шифрования токена. Принадлежит пользователю node.
RUN mkdir -p /data && chown node:node /data && chmod 700 /data
ENV BOT_DATA_DIR=/data LINK_API_HOST=0.0.0.0 LINK_API_PORT=3010
USER node
EXPOSE 3010
WORKDIR /app/apps/link-bot
CMD ["node", "dist/index.js"]

FROM core-build AS rating-bot-build
COPY apps/rating-bot apps/rating-bot
RUN chmod -R a+rX apps/rating-bot
RUN pnpm -F rating-bot build

FROM node:22-alpine AS rating-bot
RUN apk add --no-cache openssl
ENV NODE_ENV=production
WORKDIR /app
COPY --from=core-build /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=core-build /app/node_modules ./node_modules
COPY --from=core-build /app/packages/core ./packages/core
COPY --from=rating-bot-build /app/apps/rating-bot/package.json ./apps/rating-bot/package.json
COPY --from=rating-bot-build /app/apps/rating-bot/node_modules ./apps/rating-bot/node_modules
COPY --from=rating-bot-build /app/apps/rating-bot/dist ./apps/rating-bot/dist
# Том бота: здесь лежит его ключ шифрования токенов. Принадлежит пользователю node.
RUN mkdir -p /data && chown node:node /data && chmod 700 /data
ENV BOT_DATA_DIR=/data
USER node
WORKDIR /app/apps/rating-bot
CMD ["node", "dist/index.js"]

FROM core-build AS online-bot-build
COPY apps/online-bot apps/online-bot
RUN chmod -R a+rX apps/online-bot
RUN pnpm -F online-bot build

FROM node:22-alpine AS online-bot
RUN apk add --no-cache openssl
ENV NODE_ENV=production
WORKDIR /app
COPY --from=core-build /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=core-build /app/node_modules ./node_modules
COPY --from=core-build /app/packages/core ./packages/core
COPY --from=online-bot-build /app/apps/online-bot/package.json ./apps/online-bot/package.json
COPY --from=online-bot-build /app/apps/online-bot/node_modules ./apps/online-bot/node_modules
COPY --from=online-bot-build /app/apps/online-bot/dist ./apps/online-bot/dist
# Том бота: здесь лежит его ключ шифрования токенов. Принадлежит пользователю node.
RUN mkdir -p /data && chown node:node /data && chmod 700 /data
ENV BOT_DATA_DIR=/data
USER node
WORKDIR /app/apps/online-bot
CMD ["node", "dist/index.js"]

FROM core-build AS giveaway-bot-build
COPY apps/giveaway-bot apps/giveaway-bot
RUN chmod -R a+rX apps/giveaway-bot
RUN pnpm -F giveaway-bot build

FROM node:22-alpine AS giveaway-bot
RUN apk add --no-cache openssl
ENV NODE_ENV=production
WORKDIR /app
COPY --from=core-build /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=core-build /app/node_modules ./node_modules
COPY --from=core-build /app/packages/core ./packages/core
COPY --from=giveaway-bot-build /app/apps/giveaway-bot/package.json ./apps/giveaway-bot/package.json
COPY --from=giveaway-bot-build /app/apps/giveaway-bot/node_modules ./apps/giveaway-bot/node_modules
COPY --from=giveaway-bot-build /app/apps/giveaway-bot/dist ./apps/giveaway-bot/dist
# Том бота: здесь лежит его ключ шифрования токенов. Принадлежит пользователю node.
RUN mkdir -p /data && chown node:node /data && chmod 700 /data
ENV BOT_DATA_DIR=/data
USER node
WORKDIR /app/apps/giveaway-bot
CMD ["node", "dist/index.js"]

FROM core-build AS maps-bot-build
COPY apps/maps-bot apps/maps-bot
RUN chmod -R a+rX apps/maps-bot
RUN pnpm -F maps-bot build

FROM node:22-alpine AS maps-bot
RUN apk add --no-cache openssl
ENV NODE_ENV=production
WORKDIR /app
COPY --from=core-build /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=core-build /app/node_modules ./node_modules
COPY --from=core-build /app/packages/core ./packages/core
COPY --from=maps-bot-build /app/apps/maps-bot/package.json ./apps/maps-bot/package.json
COPY --from=maps-bot-build /app/apps/maps-bot/node_modules ./apps/maps-bot/node_modules
COPY --from=maps-bot-build /app/apps/maps-bot/dist ./apps/maps-bot/dist
# Том бота: ключ шифрования секретов и временные файлы карт (до 600 МБ, в tmpfs не держим).
RUN mkdir -p /data && chown node:node /data && chmod 700 /data
ENV BOT_DATA_DIR=/data
USER node
WORKDIR /app/apps/maps-bot
CMD ["node", "dist/index.js"]

FROM core-build AS notice-bot-build
COPY apps/notice-bot apps/notice-bot
RUN chmod -R a+rX apps/notice-bot
RUN pnpm -F notice-bot build

FROM node:22-alpine AS notice-bot
RUN apk add --no-cache openssl
ENV NODE_ENV=production
WORKDIR /app
COPY --from=core-build /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=core-build /app/node_modules ./node_modules
COPY --from=core-build /app/packages/core ./packages/core
COPY --from=notice-bot-build /app/apps/notice-bot/package.json ./apps/notice-bot/package.json
COPY --from=notice-bot-build /app/apps/notice-bot/node_modules ./apps/notice-bot/node_modules
COPY --from=notice-bot-build /app/apps/notice-bot/dist ./apps/notice-bot/dist
# Том бота: здесь лежит его ключ шифрования секретов.
RUN mkdir -p /data && chown node:node /data && chmod 700 /data
ENV BOT_DATA_DIR=/data
USER node
WORKDIR /app/apps/notice-bot
CMD ["node", "dist/index.js"]

FROM core-build AS panel-build
COPY apps/panel apps/panel
RUN chmod -R a+rX apps/panel
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm -F panel build

FROM node:22-alpine AS panel
RUN apk add --no-cache openssl
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=panel-build --chown=node:node /app/apps/panel/.next/standalone ./
COPY --from=panel-build --chown=node:node /app/apps/panel/.next/static ./apps/panel/.next/static
# Шрифты карточки профиля для редактора.
COPY --from=panel-build --chown=node:node /app/packages/core/assets ./packages/core/assets
USER node
EXPOSE 3000
CMD ["node", "apps/panel/server.js"]
