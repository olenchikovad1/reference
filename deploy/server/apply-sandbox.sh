#!/usr/bin/env bash
# Поднять тег «Референса» на sandbox (план 120): модели по описи, база,
# брокер, схема, сервис. Картинки — в Yandex Object Storage. Выполняется на sandbox в /opt/reference.
set -euo pipefail
cd "$(dirname "$0")/../.."
tag="${1:?нужен тег — его печатает build.sh}"
[ -f .env ] || { echo "нет .env — он приезжает с отправкой" >&2; exit 1; }
compose() {
  REFERENCE_TAG="$tag" docker compose --env-file .env \
    -f infra/compose.sandbox.yaml -f infra/compose.sandbox.clip.yaml -f infra/compose.sandbox.voice.yaml "$@"
}
# Не переключаем работающий API, если отдельно заданный образ ещё не доставлен.
images="$(compose config --images api clip voice)"
while IFS= read -r image; do
  docker image inspect "$image" >/dev/null 2>&1 || {
    echo "на sandbox нет образа $image" >&2
    exit 1
  }
done <<< "$images"
echo "сверяю и докачиваю модели по описи (первый раз — ~1.9 ГБ)"
python3 scripts/stand/fetch_models.py
echo "поднимаю базу и брокер"
compose up -d postgres rabbitmq
echo "накатываю схему"
compose --profile migrate run --rm migrate
previous="$(cat deployed 2>/dev/null || true)"
restore() {
  local status="$1"
  if [ -n "$previous" ]; then
    echo "не поднялся тег $tag; возвращаю API $previous" >&2
    bash deploy/server/rollback-sandbox.sh "$previous" || echo "откат $previous не удался" >&2
  fi
  exit "$status"
}
echo "поднимаю CLIP и жду готовности сокета"
compose up -d --wait --wait-timeout 75 --no-deps --pull never clip || restore "$?"
echo "переключаю API на внешний CLIP и отключаю встроенный голосовой потребитель"
compose up -d --wait --wait-timeout 180 --no-deps --pull never --force-recreate api || restore "$?"
echo "поднимаю голосовой воркер"
compose up -d --wait --wait-timeout 75 --no-deps --pull never voice || restore "$?"
[ -f deployed ] && [ "$(cat deployed)" != "$tag" ] && cp deployed deployed.prev
echo "$tag" > deployed
echo ""
echo "выкачено на sandbox: $tag"
