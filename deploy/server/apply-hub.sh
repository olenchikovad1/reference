#!/usr/bin/env bash
# Поднять тег «Референса» на hub (план 120): фронтенд и туннель до sandbox.
# Выполняется на hub в /opt/platform-apps/reference.
set -euo pipefail
cd "$(dirname "$0")/../.."
tag="${1:?нужен тег — его печатает build.sh}"
[ -f .env ] || { echo "нет .env — он приезжает с отправкой" >&2; exit 1; }
compose() { REFERENCE_TAG="$tag" docker compose --env-file .env -f infra/compose.hub.yaml "$@"; }
for image in "reference-web:$tag" "reference-tunnel:$tag"; do
  docker image inspect "$image" >/dev/null 2>&1 || { echo "в теге $tag нет образа $image — отправьте заново" >&2; exit 1; }
done
compose up -d --force-recreate reference-tunnel web
[ -f deployed ] && [ "$(cat deployed)" != "$tag" ] && cp deployed deployed.prev
echo "$tag" > deployed
echo "выкачено на hub: $tag"
