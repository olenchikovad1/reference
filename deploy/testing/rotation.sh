#!/usr/bin/env bash
# Вызывает существующий исполнитель installation даже при отсутствии релизов.
# История REFERENCE_TEST_STATE должна находиться вне очищаемого checkout.
set -euo pipefail
cd "$(dirname "$0")/../.."
python3 scripts/testing/run.py --stage rotation "$@"
