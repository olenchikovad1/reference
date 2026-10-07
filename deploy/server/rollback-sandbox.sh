#!/usr/bin/env bash
# Откат «Референса» на sandbox к прежнему тегу (deployed.prev) — без миграций:
# схема к этому моменту новее кода, и прежний код с ней работает (миграции
# только добавляют). Данные в томах не трогаются.
set -euo pipefail
cd "$(dirname "$0")/../.."
tag="${1:-$(cat deployed.prev 2>/dev/null || true)}"
[ -n "$tag" ] || { echo "прежнего тега нет (deployed.prev)" >&2; exit 1; }
REFERENCE_TAG="$tag" docker compose --env-file .env -f infra/compose.sandbox.yaml up -d --force-recreate api
cp deployed deployed.prev 2>/dev/null || true
echo "$tag" > deployed
echo "откат на sandbox: $tag"
