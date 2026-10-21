# Один Dockerfile на весь монорепозиторий. Цели:
#   build      — сборка всего; используется и для миграций
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
COPY apps/rating-bot/package.json apps/rating-bot/
COPY apps/online-bot/package.json apps/online-bot/
COPY apps/giveaway-bot/package.json apps/giveaway-bot/
COPY apps/maps-bot/package.json apps/maps-bot/
COPY apps/notice-bot/package.json apps/notice-bot/
COPY apps/panel/package.json apps/panel/
RUN pnpm install --frozen-lockfile

FROM deps AS build
# Prisma нужен адрес базы только для проверки схемы, подключения при сборке нет.
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
ENV NEXT_TELEMETRY_DISABLED=1
COPY packages packages
COPY apps apps
# Права файлов приходят из папки на сервере. Если git писал их со строгим umask (077), боты
# под пользователем node не прочитают package.json ядра и упадут с ERR_MODULE_NOT_FOUND.
RUN chmod -R a+rX package.json pnpm-workspace.yaml packages apps
RUN pnpm -F @flamebot/core build && pnpm -F rating-bot build && pnpm -F online-bot build && pnpm -F giveaway-bot build && pnpm -F maps-bot build && pnpm -F notice-bot build && pnpm -F panel build

FROM node:22-alpine AS rating-bot
RUN apk add --no-cache openssl
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/core ./packages/core
COPY --from=build /app/apps/rating-bot/package.json ./apps/rating-bot/package.json
COPY --from=build /app/apps/rating-bot/node_modules ./apps/rating-bot/node_modules
COPY --from=build /app/apps/rating-bot/dist ./apps/rating-bot/dist
# Том бота: здесь лежит его ключ шифрования токенов. Принадлежит пользователю node.
RUN mkdir -p /data && chown node:node /data && chmod 700 /data
ENV BOT_DATA_DIR=/data
USER node
WORKDIR /app/apps/rating-bot
CMD ["node", "dist/index.js"]

FROM node:22-alpine AS online-bot
RUN apk add --no-cache openssl
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/core ./packages/core
COPY --from=build /app/apps/online-bot/package.json ./apps/online-bot/package.json
COPY --from=build /app/apps/online-bot/node_modules ./apps/online-bot/node_modules
COPY --from=build /app/apps/online-bot/dist ./apps/online-bot/dist
# Том бота: здесь лежит его ключ шифрования токенов. Принадлежит пользователю node.
RUN mkdir -p /data && chown node:node /data && chmod 700 /data
ENV BOT_DATA_DIR=/data
USER node
WORKDIR /app/apps/online-bot
CMD ["node", "dist/index.js"]

FROM node:22-alpine AS giveaway-bot
RUN apk add --no-cache openssl
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/core ./packages/core
COPY --from=build /app/apps/giveaway-bot/package.json ./apps/giveaway-bot/package.json
COPY --from=build /app/apps/giveaway-bot/node_modules ./apps/giveaway-bot/node_modules
COPY --from=build /app/apps/giveaway-bot/dist ./apps/giveaway-bot/dist
# Том бота: здесь лежит его ключ шифрования токенов. Принадлежит пользователю node.
RUN mkdir -p /data && chown node:node /data && chmod 700 /data
ENV BOT_DATA_DIR=/data
USER node
WORKDIR /app/apps/giveaway-bot
CMD ["node", "dist/index.js"]

FROM node:22-alpine AS maps-bot
RUN apk add --no-cache openssl
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/core ./packages/core
COPY --from=build /app/apps/maps-bot/package.json ./apps/maps-bot/package.json
COPY --from=build /app/apps/maps-bot/node_modules ./apps/maps-bot/node_modules
COPY --from=build /app/apps/maps-bot/dist ./apps/maps-bot/dist
# Том бота: ключ шифрования секретов и временные файлы карт (до 600 МБ, в tmpfs не держим).
RUN mkdir -p /data && chown node:node /data && chmod 700 /data
ENV BOT_DATA_DIR=/data
USER node
WORKDIR /app/apps/maps-bot
CMD ["node", "dist/index.js"]

FROM node:22-alpine AS notice-bot
RUN apk add --no-cache openssl
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/core ./packages/core
COPY --from=build /app/apps/notice-bot/package.json ./apps/notice-bot/package.json
COPY --from=build /app/apps/notice-bot/node_modules ./apps/notice-bot/node_modules
COPY --from=build /app/apps/notice-bot/dist ./apps/notice-bot/dist
# Том бота: здесь лежит его ключ шифрования секретов.
RUN mkdir -p /data && chown node:node /data && chmod 700 /data
ENV BOT_DATA_DIR=/data
USER node
WORKDIR /app/apps/notice-bot
CMD ["node", "dist/index.js"]

FROM node:22-alpine AS panel
RUN apk add --no-cache openssl
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /app/apps/panel/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/panel/.next/static ./apps/panel/.next/static
# Шрифты карточки профиля для редактора.
COPY --from=build --chown=node:node /app/packages/core/assets ./packages/core/assets
USER node
EXPOSE 3000
CMD ["node", "apps/panel/server.js"]
