#!/usr/bin/env bash
# Отправить на sandbox основную часть «Референса» (план 120): описание служб,
# значения, файлы изделий и принтов из git, опись моделей и образ сервиса.
set -euo pipefail
cd "$(dirname "$0")/../.."
tag="${1:?нужен тег — его печатает build.sh}"
[ -f infra/sandbox.env ] || { echo "нет infra/sandbox.env — его кладёт установка" >&2; exit 1; }
. deploy/release/_remote.sh deploy/sandbox.env /opt/reference
docker image inspect "reference-api:$tag" >/dev/null 2>&1 || { echo "образа reference-api:$tag нет — сначала build.sh" >&2; exit 1; }
echo "==> отправляю описания служб, значения и файлы на sandbox"
on_server "mkdir -p $target/images $target/infra $target/deploy/server $target/scripts/stand"
send infra/ infra/compose.sandbox.yaml
send deploy/server/ deploy/server/apply-sandbox.sh deploy/server/rollback-sandbox.sh
send scripts/stand/ scripts/stand/fetch_models.py
send "" manifest.reference.yaml
send .env infra/sandbox.env
on_server "chmod 600 $target/.env && chmod +x $target/deploy/server/*.sh"
# Кадры, принты, голос и описания — то, что лежит в git (решение 0012); модели
# качаются на самой машине по описи (apply-sandbox.sh).
git ls-files -z infra/stand/files infra/stand/fixtures | tar --null -czf - -T - | on_server "tar -xzf - -C $target"
send_images "reference-api-$tag" "reference-api:$tag"
