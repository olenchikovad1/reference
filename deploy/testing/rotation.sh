#!/usr/bin/env bash
# Включение требует доказанной общей границы памяти и готовых образов.
set -euo pipefail
cd "$(dirname "$0")/../.."
if [[ ${REFERENCE_ROTATION_ENABLED:-} != 1 ]]; then
  echo 'Reference rotation is paused until an isolated runner has been verified.' >&2
  exit 78
fi
read -r nonce </proc/sys/kernel/random/uuid
export REFERENCE_ROTATION_RUN_PREFIX="reference-tc-${nonce//-/}"
# Если контроллер убит, его finally уже не выполнится. Оставляем время
# на принудительное завершение только контейнеров этого прогона.
status=0
timeout --signal=KILL 590s python3 scripts/testing/run.py "$@" --stage rotation || status=$?
if (( status == 124 || status >= 128 )); then
  local_docker=(env -u DOCKER_CONTEXT -u DOCKER_HOST docker --host unix:///var/run/docker.sock)
  if containers="$(timeout --signal=KILL 3s "${local_docker[@]}" ps -aq \
      --filter "label=reference.testing=$REFERENCE_ROTATION_RUN_PREFIX")"; then
    if [[ -n "$containers" ]]; then
      mapfile -t ids <<< "$containers"
      timeout --signal=KILL 5s "${local_docker[@]}" rm -f "${ids[@]}" >/dev/null || true
    fi
  fi
  timeout --signal=KILL 1s "${local_docker[@]}" network rm "$REFERENCE_ROTATION_RUN_PREFIX" >/dev/null 2>&1 || true
fi
exit "$status"
