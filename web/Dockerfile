# Основа зафиксирована по той же причине, что и у сервиса.
# Стенд — ступень dev (дев-сервер с подменой модулей); бой — ступень prod:
# статика сборки за nginx (план 120). Стенд называет ступень явно.
FROM node:22.14.0-alpine AS dev

WORKDIR /app

# Адрес реестра нужен во время СБОРКИ: npm читает .npmrc здесь, а env_file
# действует только в рантайме. Без аргумента подстановка даёт пустую строку,
# и npm падает с ERR_INVALID_URL — проверено 23.09.2026.
ARG PLATFORM_NPM_REGISTRY
ENV PLATFORM_NPM_REGISTRY=${PLATFORM_NPM_REGISTRY}

# Зависимости ставятся до копирования кода. .npmrc копируется вместе с ними:
# без него реестр @platform/* неизвестен, и установка молча берёт чужой пакет.
COPY package.json .npmrc ./
RUN npm install

COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
# Шрифты и прочее, что отдаётся как есть. Без этого они молча не грузятся, всё
# падает в запасной шрифт, и на экране оказывается не то, что уйдёт в печать.
COPY public ./public

# Процесс работает не от суперпользователя. Пользователь node есть в образе.
RUN chown -R node:node /app
USER node

EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]


# --- бой ---------------------------------------------------------------------
# Сборка статики из тех же зависимостей, что у стенда. Значения VITE_* вшиваются
# в сборку, поэтому приходят аргументами: боевой адрес платформы и запрет
# стенда без платформы — не значения web/.env разработчика.
FROM dev AS build
ARG VITE_PLATFORM_URL
ARG VITE_WITHOUT_PLATFORM=false
ENV VITE_PLATFORM_URL=${VITE_PLATFORM_URL} VITE_WITHOUT_PLATFORM=${VITE_WITHOUT_PLATFORM}
RUN test -n "$VITE_PLATFORM_URL" || { echo "нет VITE_PLATFORM_URL — боевой адрес платформы" >&2; exit 1; }
RUN npm run build

# Статика за nginx: порт и имя те же, что у стенда (reference-web:5173), — адрес
# в манифесте один на стенд и бой. Запросы к сервису nginx отдаёт туннелю до
# sandbox (решение владельца 07.10.2026: «Референс» целиком на sandbox).
FROM nginx:1.27.3-alpine AS prod
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html/reference
EXPOSE 5173
