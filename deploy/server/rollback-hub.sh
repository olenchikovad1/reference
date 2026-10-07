#!/usr/bin/env bash
# Откат части «Референса» на hub к прежнему тегу (deployed.prev).
set -euo pipefail
cd "$(dirname "$0")/../.."
tag="${1:-$(cat deployed.prev 2>/dev/null || true)}"
[ -n "$tag" ] || { echo "прежнего тега нет (deployed.prev)" >&2; exit 1; }
REFERENCE_TAG="$tag" docker compose --env-file .env -f infra/compose.hub.yaml up -d --force-recreate reference-tunnel web
cp deployed deployed.prev 2>/dev/null || true
echo "$tag" > deployed
echo "откат на hub: $tag"
