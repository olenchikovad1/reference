#!/usr/bin/env bash
# Включение требует доказанной общей границы памяти и готовых образов.
set -euo pipefail
cd "$(dirname "$0")/../.."
if [[ ${REFERENCE_ROTATION_ENABLED:-} != 1 ]]; then
  echo 'Reference rotation is paused until an isolated runner has been verified.' >&2
  exit 78
fi
exec timeout --signal=KILL 600s python3 scripts/testing/run.py "$@" --stage rotation
