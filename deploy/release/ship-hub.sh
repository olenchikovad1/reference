#!/usr/bin/env bash
# Отправить на hub его часть «Референса» (план 120): фронтенд и туннель до
# сервиса на sandbox, ключ туннеля и значения.
set -euo pipefail
cd "$(dirname "$0")/../.."
tag="${1:?нужен тег — его печатает build.sh}"
[ -f infra/hub.env ] || { echo "нет infra/hub.env — его кладёт установка" >&2; exit 1; }
[ -f infra/tunnel-keys/id_ed25519 ] || { echo "нет ключа туннеля infra/tunnel-keys/ — его кладёт установка" >&2; exit 1; }
. deploy/release/_remote.sh deploy/hub.env /opt/platform-apps/reference
for image in "reference-web:$tag" "reference-tunnel:$tag"; do
  docker image inspect "$image" >/dev/null 2>&1 || { echo "образа $image нет — сначала build.sh" >&2; exit 1; }
done
echo "==> отправляю описания служб, значения и ключ туннеля на hub"
on_server "mkdir -p $target/images $target/infra $target/deploy/server $target/tunnel"
send infra/ infra/compose.hub.yaml
send deploy/server/ deploy/server/apply-hub.sh deploy/server/rollback-hub.sh
send .env infra/hub.env
send tunnel/ infra/tunnel-keys/id_ed25519 infra/tunnel-keys/known_hosts
on_server "chmod 600 $target/.env $target/tunnel/id_ed25519 && chmod 700 $target/tunnel && chmod +x $target/deploy/server/*.sh"
send_images "reference-hub-$tag" "reference-web:$tag" "reference-tunnel:$tag"
