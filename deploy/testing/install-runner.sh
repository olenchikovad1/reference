#!/usr/bin/env bash
# Собственный непривилегированный runner приватного репозитория Reference.
# stdin: краткоживущий registration token GitHub, не личный MCP/GitHub-ключ.
set -euo pipefail
read -r registration_token
target="$HOME/reference-testing-runner"
if [ -L "$target" ]; then
  echo 'runner path must not be a symlink' >&2
  exit 1
fi
mkdir -p "$target"
chmod 700 "$target"
cd "$target"
version=2.338.2
checksum=baebf204307bac6193480852732f0aba2ae97b6c5597c244f4d5558390147c40
archive="actions-runner-linux-x64-$version.tar.gz"
if [ ! -f .runner ]; then
  curl -fsSL --retry 2 --max-time 300 -o "$archive" \
    "https://github.com/actions/runner/releases/download/v$version/$archive"
  printf '%s  %s\n' "$checksum" "$archive" | sha256sum -c -
  tar xzf "$archive"
  ./config.sh --unattended --url https://github.com/Laretto-Team/reference \
    --token "$registration_token" --name reference-testing-sandbox \
    --labels reference --work _work
fi
unset registration_token
# Cron принадлежит текущему пользователю. Linger=no: user service завершился
# бы после logout. Flock не допускает два Listener; cron восстанавливает упавший.
python3 - <<'PY'
import subprocess
result = subprocess.run(['crontab', '-l'], capture_output=True, text=True)
if result.returncode and 'no crontab' not in result.stderr:
    raise RuntimeError('Cannot read current user crontab')
marker = '# reference-testing-runner'
lines = [line for line in result.stdout.splitlines() if not line.endswith(marker)]
lines.append('* * * * * flock -n "$HOME/reference-testing-runner/.run.lock" "$HOME/reference-testing-runner/run.sh" >> "$HOME/reference-testing-runner/runner.log" 2>&1 ' + marker)
subprocess.run(['crontab', '-'], input='\n'.join(lines)+'\n', text=True, check=True)
PY
nohup flock -n "$target/.run.lock" "$target/run.sh" </dev/null >> "$target/runner.log" 2>&1 &
echo 'Reference runner registered; user cron owns recovery. Verify online in GitHub.'
