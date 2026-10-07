#!/usr/bin/env bash
# Быстрые тесты перед выкаткой: фронтенд (vitest) — без базы и без моделей.
# Тесты сервиса с базой гоняются до слияния, на стенде (CLAUDE.md, «Проверки
# кода»): в чистом клоне установки базы и моделей нет.
set -euo pipefail
cd "$(dirname "$0")/../.."
registry="$(grep '^PLATFORM_NPM_REGISTRY=' infra/.env | cut -d= -f2-)"
docker build -q --target dev -t reference-web-test --build-arg PLATFORM_NPM_REGISTRY="$registry" web >/dev/null
docker run --rm reference-web-test npx vitest run
