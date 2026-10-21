# Один Dockerfile на весь монорепозиторий. Цели:
#   build      — сборка всего; используется и для миграций
#   rating-bot — рейтинг-бот
#   online-bot — бот онлайна серверов
#   giveaway-bot — бот розыгрышей
#   panel      — веб-панель

FROM node:22-alpine AS deps
RUN apk add --no-cache openssl && corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY apps/rating-bot/package.json apps/rating-bot/
COPY apps/online-bot/package.json apps/online-bot/
COPY apps/giveaway-bot/package.json apps/giveaway-bot/
COPY apps/panel/package.json apps/panel/
RUN pnpm install --frozen-lockfile

FROM deps AS build
# Prisma нужен адрес базы только для проверки схемы, подключения при сборке нет.
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
ENV NEXT_TELEMETRY_DISABLED=1
COPY packages packages
COPY apps apps
RUN pnpm -F @flamebot/core build && pnpm -F rating-bot build && pnpm -F online-bot build && pnpm -F giveaway-bot build && pnpm -F panel build

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
USER node
WORKDIR /app/apps/giveaway-bot
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
