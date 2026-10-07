#!/usr/bin/env bash
# Быстрые тесты перед выкаткой: фронтенд (vitest) — без базы и без моделей.
# Тесты сервиса с базой гоняются до слияния, на стенде (CLAUDE.md, «Проверки
# кода»): в чистом клоне установки базы и моделей нет.
set -euo pipefail
cd "$(dirname "$0")/../.."
registry="$(grep '^PLATFORM_NPM_REGISTRY=' infra/.env | cut -d= -f2-)"
docker build -q --target dev -t reference-web-test --build-arg PLATFORM_NPM_REGISTRY="$registry" web >/dev/null
# Манифест — тем же путём, что на стенде (infra/compose.yaml): тест разделов
# сверяет меню с ним, а в образ фронтенда он не входит. pwd -W — путь Windows
# для docker на машине выкатывающего; MSYS_NO_PATHCONV — чтобы Git Bash не
# переписал путь внутри контейнера.
root="$(pwd -W 2>/dev/null || pwd)"
MSYS_NO_PATHCONV=1 docker run --rm -v "$root/manifest.reference.yaml:/manifest.reference.yaml:ro"   reference-web-test npx vitest run
