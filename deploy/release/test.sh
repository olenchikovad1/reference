#!/usr/bin/env bash
# Приёмка выпуска по TC-2026-11-05; тестовые БД и модели готовит runner.
set -euo pipefail
cd "$(dirname "$0")/../.."
# TC-ADOPT-012: обязательное + влияние + регрессии + срок ротации. История
# хранится вне чистого клона; новая рабочая копия не обнуляет last_success.
candidate="$(git rev-parse --git-path reference-testing-candidate)"
if [ -f "$candidate" ]; then
  read -r candidate_commit candidate_tag < "$candidate"
  if [ "$candidate_commit" != "$(git rev-parse HEAD)" ] || [ -z "$candidate_tag" ]; then
    echo 'кандидат не принадлежит текущему коммиту — повторите build' >&2
    exit 1
  fi
  api_image="$(docker image inspect "reference-api:$candidate_tag" --format '{{.Id}}')"
  web_image="$(docker image inspect "reference-web:$candidate_tag" --format '{{.Id}}')"
  tunnel_image="$(docker image inspect "reference-tunnel:$candidate_tag" --format '{{.Id}}')"
  # HTTP-сценарий не изображает настоящий SSH. Проверяем поставляемый
  # транспорт отдельно: точный скрипт из образа и исполняемый OpenSSH.
  docker run --rm --entrypoint cat "$tunnel_image" /tunnel.sh | cmp - infra/tunnel/tunnel.sh
  docker run --rm --entrypoint ssh "$tunnel_image" -V
  python3 scripts/testing/run.py --stage candidate \
    --image "api=$api_image" --image "web=$web_image" --image "tunnel=$tunnel_image"
else
  python3 scripts/testing/run.py --stage change
fi
