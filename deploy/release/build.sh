#!/usr/bin/env bash
# Собрать образы «Референса» для боя (план 120) и напечатать тег.
# Выполняет установка (installation) в чистом клоне ветки; вручную — так же.
# Тег один на обе машины: сервис на sandbox, фронтенд и туннель на hub.
set -euo pipefail
cd "$(dirname "$0")/../.."
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "есть незакоммиченные правки — в бой едет только закоммиченное:" >&2
  git status --short --untracked-files=no >&2
  exit 1
fi
# Боевой адрес платформы вшивается в сборку фронтенда (VITE_PLATFORM_URL).
platform_url="${REFERENCE_PLATFORM_URL:-https://platform.toribrands.ru}"
registry="$(grep '^PLATFORM_NPM_REGISTRY=' infra/.env | cut -d= -f2-)"
tag="$(date +%Y%m%d-%H%M)-$(git rev-parse --short HEAD)"
echo "==> собираю образы, тег $tag"
docker build -q -t "reference-api:$tag" api >/dev/null
docker build -q --target prod -t "reference-web:$tag" \
  --build-arg PLATFORM_NPM_REGISTRY="$registry" --build-arg VITE_PLATFORM_URL="$platform_url" web >/dev/null
docker build -q -t "reference-tunnel:$tag" infra/tunnel >/dev/null
echo ""
echo "тег: $tag"
