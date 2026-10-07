#!/bin/sh
# Держать туннель к сервису «Референса» на sandbox. Порт 8031 слушается внутри
# сети «Референса» на hub; на sandbox сервис слушает только 127.0.0.1:8031.
# На той стороне пользователь reference-tunnel: без оболочки, проброс только к
# этому адресу. Обрыв — выход, и compose поднимает туннель заново.
set -eu
exec ssh -N \
  -i /tunnel/id_ed25519 \
  -o UserKnownHostsFile=/tunnel/known_hosts -o StrictHostKeyChecking=yes \
  -o BatchMode=yes -o ExitOnForwardFailure=yes \
  -o ServerAliveInterval=30 -o ServerAliveCountMax=3 \
  -L 0.0.0.0:8031:127.0.0.1:8031 \
  "${TUNNEL_USER:?}@${TUNNEL_HOST:?}"
