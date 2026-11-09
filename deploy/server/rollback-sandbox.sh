#!/usr/bin/env bash
# Откат «Референса» на sandbox к прежнему тегу (deployed.prev) — без миграций:
# схема к этому моменту новее кода, и прежний код с ней работает (миграции
# только добавляют). Данные в томах не трогаются.
set -euo pipefail
cd "$(dirname "$0")/../.."
tag="${1:-$(cat deployed.prev 2>/dev/null || true)}"
[ -n "$tag" ] || { echo "прежнего тега нет (deployed.prev)" >&2; exit 1; }
compose() {
  REFERENCE_TAG="$tag" docker compose --env-file .env -f infra/compose.sandbox.yaml "$@"
}
docker image inspect "reference-api:$tag" >/dev/null
compose config --quiet
# Прежний API запускает своего потребителя. Останавливаем внешний до его старта.
workers="$(docker ps -q --filter label=com.docker.compose.project=reference \
  --filter label=com.docker.compose.service=voice)"
if [ -n "$workers" ]; then
  mapfile -t voice_ids <<< "$workers"
  docker stop --time 90 "${voice_ids[@]}" >/dev/null
fi
compose up -d --wait --wait-timeout 180 --no-deps --pull never --force-recreate api
# Сокет может обслуживать прежний API, пока тот ещё не переключился.
workers="$(docker ps -q --filter label=com.docker.compose.project=reference \
  --filter label=com.docker.compose.service=clip)"
if [ -n "$workers" ]; then
  mapfile -t clip_ids <<< "$workers"
  docker stop "${clip_ids[@]}" >/dev/null
fi
[ -f deployed ] && [ "$(cat deployed)" != "$tag" ] && cp deployed deployed.prev
echo "$tag" > deployed
echo "откат на sandbox: $tag"
