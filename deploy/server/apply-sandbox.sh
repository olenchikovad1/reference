#!/usr/bin/env bash
# Поднять тег «Референса» на sandbox (план 120): модели по описи, база,
# брокер, схема, сервис. Картинки — в Yandex Object Storage. Выполняется на sandbox в /opt/reference.
set -euo pipefail
cd "$(dirname "$0")/../.."
tag="${1:?нужен тег — его печатает build.sh}"
[ -f .env ] || { echo "нет .env — он приезжает с отправкой" >&2; exit 1; }
compose() { REFERENCE_TAG="$tag" docker compose --env-file .env -f infra/compose.sandbox.yaml "$@"; }
docker image inspect "reference-api:$tag" >/dev/null 2>&1 || {
  echo "в теге $tag нет образа reference-api — отправьте заново" >&2
  exit 1
}
echo "сверяю и докачиваю модели по описи (первый раз — ~1.9 ГБ)"
python3 scripts/stand/fetch_models.py
echo "поднимаю базу и брокер"
compose up -d postgres rabbitmq
echo "накатываю схему"
compose --profile migrate run --rm migrate
echo "поднимаю сервис"
compose up -d --force-recreate api
state=""
for _ in $(seq 1 45); do
  state="$(docker inspect --format '{{.State.Health.Status}}' "$(compose ps -q api | head -1)" 2>/dev/null || echo '')"
  [ "$state" = "healthy" ] && break
  sleep 4
done
[ "$state" = "healthy" ] || { echo "сервис не поднялся; смотрите: docker compose -f infra/compose.sandbox.yaml logs api --tail 50" >&2; exit 1; }
[ -f deployed ] && [ "$(cat deployed)" != "$tag" ] && cp deployed deployed.prev
echo "$tag" > deployed
echo ""
echo "выкачено на sandbox: $tag"
