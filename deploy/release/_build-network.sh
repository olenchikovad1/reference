#!/usr/bin/env bash
# Реестр платформы на Linux-исполнителе слушает loopback хоста. Имя Docker
# Desktop там отсутствует: сборке нужны и сеть хоста, и явный адрес этого имени.
# На Windows/macOS имя предоставляет Docker Desktop, его сеть не меняем.
build_network=()
if [ "$(uname -s)" = Linux ]; then
  build_network=(--network host --add-host host.docker.internal:127.0.0.1)
fi
