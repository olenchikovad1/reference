"""Файл тестов — отдельный процесс, БД и S3-пространство; модели общие только как производные."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time


def main() -> int:
    for file in sys.argv[1:]:
        key = hashlib.sha256(file.encode()).hexdigest()[:12]
        environment = dict(os.environ)
        base = environment['DATABASE_URL'].rsplit('/', 1)[0]
        environment['DATABASE_URL'] = base + '/tc_' + key
        environment['S3_BUCKET'] = 'tc-' + key
        print('TC API: ' + file, flush=True)
        started = time.monotonic()
        report = '/evidence/' + Path(file).stem + '.xml'
        result = subprocess.run([sys.executable, '-m', 'pytest', '-q', file, '--junitxml=' + report], env=environment)
        with Path('/evidence/progress.jsonl').open('a', encoding='utf-8') as stream:
            stream.write(json.dumps({'file':file, 'exit_code':result.returncode, 'seconds':time.monotonic() - started}) + '\n')
        if result.returncode:
            # Первого отказа достаточно для решения: оставшееся не считается исполненным.
            return result.returncode
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
