# Основа зафиксирована по той же причине, что и у сервиса.
FROM node:22.14.0-alpine

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
