"""Только временные тестовые контейнеры. Рабочие env/БД сюда не передаются."""
import hashlib
import base64
import importlib.util
import ipaddress
import json
import os
from pathlib import Path
import platform
import re
import subprocess
import time
import uuid
import xml.etree.ElementTree as ET
from dataclasses import dataclass

from scripts.testing.policy import Group
from scripts.testing.policy import fingerprint

ROTATION_MEMORY = 2 * 1024 ** 3
API_MEMORY = '1152m'
MODEL_MEMORY = '1408m'


@dataclass(frozen=True)
class RotationEnvelope:
    """Общая граница для контроллера и контейнеров одного Linux-хоста."""

    member: Path
    parent: str
    version: str
    memory: int

    def contains(self, membership: str) -> bool:
        controller = '' if self.version == '2' else 'memory'
        for line in membership.splitlines():
            _, controllers, path = line.split(':', 2)
            if controller in controllers.split(','):
                return Path(path).is_relative_to(self.member)
        return False


def rotation_envelope(root: Path) -> RotationEnvelope:
    """Отказ до сборок, скачиваний и тестов, если ядро не ограничивает весь прогон."""
    if os.environ.get('REFERENCE_ROTATION_ENABLED') != '1':
        raise RuntimeError('Rotation paused: REFERENCE_ROTATION_ENABLED=1 requires a verified Linux cgroup')
    if platform.system() != 'Linux':
        raise RuntimeError('Rotation requires a local Linux Docker engine and a shared memory cgroup')
    code, endpoint, _ = command(['docker', 'context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'],
                                cwd=root, timeout=10)
    if code or os.environ.get('DOCKER_CONTEXT') or (
            os.environ.get('DOCKER_HOST') or endpoint.strip()) != 'unix:///var/run/docker.sock':
        raise RuntimeError('Rotation requires the local default Docker Unix socket')
    code, driver, _ = command(['docker', 'info', '--format', '{{.CgroupVersion}}/{{.CgroupDriver}}'],
                              cwd=root, timeout=10)
    options = {
        '2/systemd': ('2', '/reference.slice/reference-testing.slice', 'reference-testing.slice'),
        '2/cgroupfs': ('2', '/reference-testing', '/reference-testing'),
        '1/cgroupfs': ('1', '/reference-testing', '/reference-testing'),
    }
    if code or driver.strip() not in options:
        raise RuntimeError('Rotation cannot verify the Docker memory cgroup driver')
    version, member, parent = options[driver.strip()]
    cgroup = Path('/sys/fs/cgroup') / ('memory' if version == '1' else '') / member.lstrip('/')
    try:
        memory = int((cgroup / ('memory.max' if version == '2' else 'memory.limit_in_bytes')).read_text())
        if version == '2':
            swap_disabled = (cgroup / 'memory.swap.max').read_text().strip() == '0'
        else:
            swap_disabled = (int((cgroup / 'memory.memsw.limit_in_bytes').read_text()) == memory
                             and (cgroup / 'memory.swappiness').read_text().strip() == '0')
        envelope = RotationEnvelope(Path(member), parent, version, memory)
        inside = envelope.contains(Path('/proc/self/cgroup').read_text())
    except (OSError, ValueError) as failure:
        raise RuntimeError('Rotation memory/swap limits are absent or unlimited') from failure
    if not inside or not swap_disabled or not 0 < memory <= ROTATION_MEMORY:
        raise RuntimeError('Rotation requires the controller in the reference cgroup: RAM <= 2 GiB, swap = 0')
    return envelope


def image_runtime(image: dict) -> str:
    """Attestation меняет image ID даже при тех же исполняемых слоях/настройках."""
    required = ['RootFS', 'Config', 'Architecture', 'Os']
    if any(image.get(key) is None for key in required) or not image['RootFS'].get('Layers'):
        raise ValueError('Image runtime inputs are incomplete; reuse forbidden')
    payload = {key:image[key] for key in required}
    payload.update(Variant=image.get('Variant'), OsVersion=image.get('OsVersion'))
    return hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def free_subnet(config: list[dict]) -> str:
    occupied = [ipaddress.ip_network(part['Subnet'], strict=False) for item in config
                for part in (item.get('IPAM', {}).get('Config') or []) if part.get('Subnet')]
    subnet = next((part for part in ipaddress.ip_network('10.231.0.0/16').subnets(new_prefix=28)
                   if not any(part.version == other.version and part.overlaps(other) for other in occupied)), None)
    if subnet is None:
        raise RuntimeError('No nonoverlapping private test subnet available')
    return str(subnet)


def command(args: list[str], *, cwd: Path, timeout: int = 600) -> tuple[int, str, float]:
    started = time.monotonic()
    try:
        result = subprocess.run(args, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                encoding='utf-8', errors='replace', timeout=timeout)
        return result.returncode, result.stdout, time.monotonic() - started
    except subprocess.TimeoutExpired as failure:
        partial = failure.stdout or ''
        if isinstance(partial, bytes):
            partial = partial.decode('utf-8', errors='replace')
        return 124, partial + '\nTimeout: result is failed, not reused or passed.', time.monotonic() - started


class DockerRuntime:
    def __init__(self, root: Path, state: Path, output: Path, images: dict[str, str], *,
                 models: bool = False, envelope: RotationEnvelope | None = None):
        self.root, self.state, self.output = root, state, output
        self.prefix = 'reference-tc-' + uuid.uuid4().hex[:12]
        self.images = images
        self.api_image = images.get('api', 'reference-tc-api')
        self.web_image = images.get('web-test', 'reference-tc-web-tests')
        self.models, self.envelope = models, envelope
        self.created: list[str] = []
        self.network_created = False
        self.preparation_seconds = 0.0
        import sys
        self.environments: dict[str, dict] = {'host': {'python': platform.python_version(), 'os': platform.system(),
                                                     'build':platform.python_build(),
                                                     'executable':hashlib.sha256(Path(sys.executable).read_bytes()).hexdigest()}}
        self.env = {
            'DATABASE_URL': f'postgresql+asyncpg://tc:synthetic-only@{self.prefix}-db/tc',
            'S3_ENDPOINT': f'http://{self.prefix}-s3:9000', 'S3_BUCKET': 'tc-assets',
            'S3_ACCESS_KEY': 'synthetic', 'S3_SECRET_KEY': 'synthetic-test-only',
            'FILES_VOLUME_PATH': '/srv/reference/files', 'FIXTURES_PATH': '/srv/reference/fixtures',
            'EMBEDDING_MODEL_PATH': '/srv/reference/files/models/clip-vit-base-patch32/vision_model_quantized.onnx',
            'WITHOUT_PLATFORM': 'true', 'PLATFORM_CORE_URL': '', 'PLATFORM_CREDENTIAL': '',
            'PLATFORM_NOTIFICATIONS_URL': '', 'PLM_BASE_URL': '', 'PLM_MACHINE_KEY': '', 'AMQP_URL': '',
            'OMP_NUM_THREADS': '1', 'OPENBLAS_NUM_THREADS': '1',
        }
        self.data_root = root / 'infra/stand/files'
        self.web_flags = ['-e','VITE_WITHOUT_PLATFORM=false','-e','VITE_PLATFORM_URL=' + os.environ.get('REFERENCE_PLATFORM_URL','https://platform.toribrands.ru')]
        self.derived: Path | None = None
        self.derived_descriptor: dict = {}

    def container(self, memory: str) -> list[str]:
        """Суммарный потолок задаёт общий cgroup, дочерний ограничивает один сервис."""
        args = ['docker', 'run', '--memory', memory, '--memory-swap', memory]
        if self.envelope:
            args += ['--pull=never', '--cgroup-parent', self.envelope.parent]
        return args

    def checked(self, args: list[str], timeout: int = 600) -> str:
        code, text, _ = command(args, cwd=self.root, timeout=timeout)
        if code:
            # Команда не содержит рабочих ключей; модель/реестр не получают их вообще.
            raise RuntimeError(f'Test preparation failed ({code}): ' + text[-2400:])
        return text.strip()

    def prepare(self) -> None:
        started = time.monotonic()
        if self.envelope:
            self.prepare_rotation_images()
        else:
            self.build_test_images()
        self.api_image = self.checked(['docker','image','inspect',self.api_image,'--format','{{.Id}}'])
        if not self.models:
            self.web_image = self.checked(['docker','image','inspect',self.web_image,'--format','{{.Id}}'])
        self.images = {key:self.checked(['docker','image','inspect',value,'--format','{{.Id}}']) for key,value in self.images.items()}
        self.prepare_image_inputs()
        if self.models:
            self.prepare_model_inputs()
        else:
            self.environments['api']['model_data'] = 'separate-model-profile'
            fixtures = [f'infra/stand/files/{entry.name}' + ('/**' if entry.is_dir() else '')
                        for entry in self.data_root.iterdir() if entry.name not in {'models', 'dictionaries'}]
            self.environments['api']['test_data'] = fingerprint(self.root, fixtures, {'models': False})
        for key, image in [('postgres_image','pgvector/pgvector:pg17'), ('s3_image','bitnamilegacy/minio:2025.4.22@sha256:50cec18ac4184af4671a78aedd5554942c8ae105d51a465fa82037949046da01')]:
            code, _, _ = command(['docker', 'image', 'inspect', image], cwd=self.root, timeout=15)
            if code:
                if self.envelope:
                    raise RuntimeError('Preload rotation dependency before enabling rotation: ' + image)
                self.checked(['docker', 'pull', image], 600)
            self.environments['api'][key] = self.checked(['docker', 'image', 'inspect', image, '--format', '{{.Id}}'])
        self.preparation_seconds = time.monotonic() - started

    def prepare_rotation_images(self) -> None:
        required = {'api'} if self.models else {'api', 'web-test'}
        if required - self.images.keys():
            raise RuntimeError('Preload the test images and pass --image for: ' + ', '.join(sorted(required)))
        # Проверяем реальное размещение дочернего контейнера до тестов, а не только флаг.
        name = self.prefix + '-cgroup-probe'
        self.created.append(name)
        observed = self.checked([*self.container('64m'), '--rm', '--name', name, '--cgroupns=host',
                                 '--network', 'none', '--entrypoint', 'cat', self.api_image, '/proc/self/cgroup'], 15)
        if not self.envelope or not self.envelope.contains(observed):
            raise RuntimeError('Docker did not place rotation containers in the controller memory cgroup')

    def build_test_images(self) -> None:
        registry = os.environ.get('PLATFORM_NPM_REGISTRY')
        if not registry:
            for name in ['infra/.env', 'web/.env']:
                file = self.root / name
                if file.exists():
                    for line in file.read_text(encoding='utf-8').splitlines():
                        if line.startswith('PLATFORM_NPM_REGISTRY='):
                            registry = line.split('=', 1)[1].strip().strip('"')
        if not registry:
            raise RuntimeError('PLATFORM_NPM_REGISTRY required; no unknown dependency reuse')
        if 'api' not in self.images:
            network = ['--network','host','--add-host','host.docker.internal:127.0.0.1'] if platform.system() == 'Linux' else []
            self.checked(['docker', 'build', '-q', *network, '-t', self.api_image, 'api'], 1200)
        network = ['--network','host','--add-host','host.docker.internal:127.0.0.1'] if platform.system() == 'Linux' else []
        if 'web-test' not in self.images:
            self.checked(['docker', 'build', '-q', *network, '--target', 'dev', '-t', self.web_image,
                          '--build-arg', 'PLATFORM_NPM_REGISTRY=' + registry, 'web'], 1200)

    def prepare_image_inputs(self) -> None:
        if not self.models:
            name = self.prefix + '-web-inputs'
            self.created.append(name)
            self.environments['web'] = json.loads(self.checked([*self.container('768m'), '--rm', '--name', name,
                '--network', 'none', *self.web_flags, self.web_image, 'node', '/app/testing-inputs.cjs']))
            expected_web = fingerprint(self.root, ['web/src/**','web/public/**','web/package.json','web/tsconfig.json','web/vite.config.ts','web/index.html','web/testing-inputs.cjs','web/.npmrc'], {'source':'web-code-v1'})
            if self.environments['web']['source'] != expected_web:
                raise RuntimeError('Frontend image source differs from measured checkout')
        probe = '''import importlib.metadata as m,json,platform,hashlib,subprocess,pathlib
root=pathlib.Path('/app')
files=[p for pattern in ['reference_api/**','alembic/**','alembic.ini','pyproject.toml'] for p in root.glob(pattern) if p.is_file() and '__pycache__' not in p.parts and p.suffix not in {'.pyc','.pyo'} and p.name!='.env']
h=hashlib.sha256(json.dumps({'source':'api-code-v1'},sort_keys=True,separators=(',',':')).encode())
for p in sorted(set(files),key=lambda p:p.relative_to(root).as_posix()):
 h.update(('api/'+p.relative_to(root).as_posix()).encode()+b'\\0');h.update(p.read_bytes())
print(json.dumps({'source':h.hexdigest(),'python':platform.python_version(),'platform':platform.system(),
'machine':platform.machine(),'system':hashlib.sha256(subprocess.check_output(['dpkg-query','-W'])).hexdigest(),
'dependency_records':hashlib.sha256(''.join(sorted((d.metadata['Name']+str(d.read_text('RECORD'))) for d in m.distributions())).encode()).hexdigest(),
'dependencies':sorted((d.metadata['Name'],d.version) for d in m.distributions())}))'''
        name = self.prefix + '-api-inputs'
        self.created.append(name)
        self.environments['api'] = json.loads(self.checked([*self.container('256m'), '--rm', '--name', name,
                                                          '--network', 'none', self.api_image, 'python', '-c', probe]))
        self.environments['api']['runtime'] = image_runtime(json.loads(self.checked(['docker','image','inspect',self.api_image]))[0])
        expected_api = fingerprint(self.root, ['api/reference_api/**','api/alembic/**','api/alembic.ini','api/pyproject.toml'], {'source':'api-code-v1'})
        if self.environments['api']['source'] != expected_api:
            raise RuntimeError('API image source differs from measured checkout')
        self.environments['api']['configuration'] = ('isolated-tc-stand-v2:no-broker:no-external-plm:no-bell:'
                                                     f'models={self.models}:blas_threads=1')

    def prepare_model_inputs(self) -> None:
        inventory = json.loads((self.root / 'infra/stand/fixtures/models.json').read_text(encoding='utf-8'))
        items = [item for model in inventory['models'] for item in model['files']]
        if not all((self.data_root / item['path']).exists() for item in items):
            self.data_root = self.state / 'model-files'
            spec = importlib.util.spec_from_file_location('tc_fetch_models', self.root / 'scripts/stand/fetch_models.py')
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            module.FILES = self.data_root
            for item in module.inventory():
                module.fetch(item)
        verified = []
        for item in items:
            path = self.data_root / item['path']
            digest = hashlib.sha256()
            with path.open('rb') as stream:
                for block in iter(lambda: stream.read(1024 * 1024), b''):
                    digest.update(block)
            if digest.hexdigest() != item['sha256']:
                raise RuntimeError('Test model checksum mismatch: ' + item['path'])
            verified.append([item['path'], digest.hexdigest()])
        self.environments['api']['model_data'] = hashlib.sha256(json.dumps(verified, sort_keys=True).encode()).hexdigest()
        self.environments['api']['test_data'] = fingerprint(self.root, ['infra/stand/files/**'], {'model_data': self.environments['api']['model_data']})
        descriptor = {'api_runtime':self.environments['api']['runtime'], 'model_data':self.environments['api']['model_data'],
                      'dependencies':self.environments['api']['dependencies'], 'configuration':'word-vectors-v1',
                      'engine':self.checked(['docker','info','--format','{{.ID}}/{{.NCPU}}/{{.KernelVersion}}'])}
        self.derived_descriptor = descriptor
        key = hashlib.sha256(json.dumps(descriptor, sort_keys=True).encode()).hexdigest()
        self.derived = self.state / 'derived' / key
        self.derived.mkdir(parents=True, exist_ok=True)
        self.derived.chmod(0o777)
        receipt = self.derived / 'receipt.json'
        if receipt.exists():
            saved = json.loads(receipt.read_text(encoding='utf-8'))
            if saved['inputs'] != descriptor:
                raise RuntimeError('Derived model cache has unknown inputs')
            for name, expected in saved['files'].items():
                if not re.fullmatch(r'(siglip-)?words-[0-9a-f]+\.npy', name):
                    raise ValueError('Unexpected derived artifact name')
                if hashlib.sha256((self.derived / name).read_bytes()).hexdigest() != expected:
                    raise RuntimeError('Derived model cache checksum mismatch')
        elif any(self.derived.iterdir()):
            raise RuntimeError('Derived model cache lacks provenance; refusing reuse')
        bootstrap = self.state / 'derived-bootstrap.json'
        if bootstrap.exists() and not receipt.exists():
            saved = json.loads(bootstrap.read_text(encoding='utf-8'))
            # Импорт только из наблюдённого тестового производителя той же модели/кода.
            if saved['api_image'] != self.api_image or saved['model_data'] != descriptor['model_data'] or saved['dependencies'] != descriptor['dependencies']:
                raise RuntimeError('Bootstrap computation artifacts do not match current inputs')
            source = Path(saved['directory'])
            for name, expected in saved['files'].items():
                if '/' in name or '\\' in name or not re.fullmatch(r'(siglip-)?words-[0-9a-f]+\.npy', name):
                    raise ValueError('Unexpected derived artifact name')
                data = (source / name).read_bytes()
                if hashlib.sha256(data).hexdigest() != expected:
                    raise RuntimeError('Bootstrap artifact checksum mismatch')
                (self.derived / name).write_bytes(data)
            receipt.write_text(json.dumps({'inputs':descriptor,'files':saved['files'],'producer':saved['producer'],
                                           'kind':'computation artifacts only; not reused test success'}), encoding='utf-8')

    def start_services(self) -> None:
        if self.network_created:
            return
        code, response, _ = command(['docker', 'network', 'create', '--internal', '--label', 'reference.testing=' + self.prefix, self.prefix], cwd=self.root, timeout=30)
        if code:
            if 'address pools' not in response:
                raise RuntimeError('Test network creation failed: ' + response[-500:])
            networks = self.checked(['docker', 'network', 'ls', '-q']).splitlines()
            config = json.loads(self.checked(['docker', 'network', 'inspect', *networks]))
            self.checked(['docker', 'network', 'create', '--internal', '--subnet', free_subnet(config), '--label', 'reference.testing=' + self.prefix, self.prefix])
        self.network_created = True
        for name, image, flags in [
            (self.prefix + '-db', self.environments['api']['postgres_image'], ['-e', 'POSTGRES_USER=tc', '-e', 'POSTGRES_PASSWORD=synthetic-only', '-e', 'POSTGRES_DB=tc']),
            (self.prefix + '-s3', self.environments['api']['s3_image'], ['--entrypoint', 'minio', '-e', 'MINIO_ROOT_USER=synthetic', '-e', 'MINIO_ROOT_PASSWORD=synthetic-test-only']),
        ]:
            memory = '320m' if name.endswith('-db') else '256m'
            args = [*self.container(memory), '-d', '--name', name, '--network', self.prefix,
                    '--label', 'reference.testing=' + self.prefix, *flags, image]
            if name.endswith('-s3'):
                args += ['server', '/bitnami/minio/data']
            self.created.append(name)
            self.checked(args)
        for _attempt in range(30):
            code, _, _ = command(['docker', 'exec', self.prefix + '-db', 'pg_isready', '-U', 'tc', '-d', 'tc'], cwd=self.root, timeout=10)
            if code == 0:
                break
            time.sleep(1)
        else:
            raise RuntimeError('Isolated PostgreSQL did not become ready')

    def api_flags(self) -> list[str]:
        flags = ['--network', self.prefix]
        for key, value in self.env.items():
            flags += ['-e', key + '=' + value]
        for source, target in [
            (self.root / 'api/tests', '/app/tests'), (self.root / 'manifest.reference.yaml', '/manifest.reference.yaml'),
            (self.root / 'manifest.reference.yaml', '/app/manifest.reference.yaml'),
            (self.root / 'scripts', '/app/scripts'),
            (self.root / 'infra/stand/fixtures', '/srv/reference/fixtures'),
        ]:
            flags += ['-v', f'{source}:{target}:ro']
        # В чистом клоне models/dictionaries отсутствуют. Вложенный bind под
        # read-only files требует mkdir и падает на Linux; монтируем соседей.
        files = self.root / 'infra/stand/files'
        assets = {source.name: source for source in files.iterdir()} if files.exists() else {}
        if not self.models:
            for part in ['models', 'dictionaries']:
                assets.pop(part, None)
        if self.data_root != self.root / 'infra/stand/files':
            for part in ['models', 'dictionaries']:
                directory = self.data_root / part
                if directory.exists():
                    assets[part] = directory
        for part, source in sorted(assets.items()):
            flags += ['-v', f'{source}:/srv/reference/files/{part}:ro']
        if self.derived:
            flags += ['-v',f'{self.derived}:/srv/reference/cache']
        return flags

    def execute(self, groups: list[Group], runtime: str) -> tuple[dict[str, dict], float]:
        destination = self.output / runtime
        destination.mkdir(parents=True, exist_ok=True)
        destination.chmod(0o777)
        if runtime == 'host':
            import sys
            args = [sys.executable, '-m', 'unittest', 'discover', '-s', 'scripts/testing', '-p', 'test_*.py']
        elif runtime == 'web':
            paths = [name.removeprefix('web/') for group in groups for name in group.tests]
            name = self.prefix + '-web-tests'
            self.created.append(name)
            args = [*self.container('768m'), '--rm', '--name', name, *self.web_flags, '--label', 'reference.testing=' + self.prefix, '-v', f'{destination}:/evidence', '-v', f'{self.root / "manifest.reference.yaml"}:/manifest.reference.yaml:ro',
                    self.web_image, 'npm', 'test', '--', '--run', '--minWorkers=1', '--maxWorkers=1',
                    *paths, '--reporter=json', '--outputFile=/evidence/result.json']
        else:
            self.start_services()
            ordered = sorted(groups, key=lambda group:(not group.core, group.category == 'compute', group.id))
            paths = [name.removeprefix('api/') for group in ordered for name in group.tests]
            name = self.prefix + ('-model-tests' if self.models else '-api-tests')
            self.created.append(name)
            args = [*self.container(MODEL_MEMORY if self.models else API_MEMORY), '--rm', '--name', name,
                    '--label', 'reference.testing=' + self.prefix, *self.api_flags(), '-v', f'{destination}:/evidence',
                    self.api_image, 'python', '/app/scripts/testing/api_batch.py', *paths]
        code, log, elapsed = command(args, cwd=self.root, timeout=2400)
        (destination / 'output.log').write_text(log, encoding='utf-8')
        results = {}
        if runtime == 'host':
            match = re.search(r'Ran (\d+) tests?', log)
            count = int(match[1]) if match else 0
            results[groups[0].id] = {'status': 'executed' if code == 0 and count else 'failed', 'tests': count, 'test_seconds': elapsed}
        elif runtime == 'web' and (destination / 'result.json').exists():
            report = json.loads((destination / 'result.json').read_text(encoding='utf-8'))
            for group in groups:
                file = next((item for item in report.get('testResults', []) if item['name'].replace('\\', '/').endswith(group.tests[0].removeprefix('web/'))), None)
                count = len(file.get('assertionResults', [])) if file else 0
                good = code == 0 and count and file['status'] == 'passed' and all(item['status'] == 'passed' for item in file['assertionResults'])
                results[group.id] = {'status': 'executed' if good else 'failed', 'tests': count,
                                     'test_seconds': max(0, file['endTime'] - file['startTime']) / 1000 if file else 0}
        elif runtime == 'api':
            progress = destination / 'progress.jsonl'
            completed = {row['file']:row['exit_code'] for row in
                         (json.loads(line) for line in progress.read_text(encoding='utf-8').splitlines())} if progress.exists() else {}
            for group in groups:
                report = destination / (Path(group.tests[0]).stem + '.xml')
                cases = list(ET.parse(report).getroot().iter('testcase')) if report.exists() else []
                module = 'tests.' + Path(group.tests[0]).stem
                mine = [case for case in cases if case.get('classname', '').split('.Test')[0] == module]
                good = completed.get(group.tests[0].removeprefix('api/')) == 0 and bool(mine) and all(not any(case.find(tag) is not None for tag in ['failure', 'error', 'skipped']) for case in mine)
                results[group.id] = {'status': 'executed' if good else 'failed' if mine else 'skipped', 'tests': len(mine),
                                     'test_seconds': sum(float(case.get('time', 0)) for case in mine)}
        for group in groups:
            results.setdefault(group.id, {'status': 'failed', 'tests': 0, 'test_seconds': 0})
            results[group.id].update(batch_seconds=elapsed, exit_code=code, log=runtime + '/output.log')
        if runtime == 'api' and self.derived:
            files = {path.name:hashlib.sha256(path.read_bytes()).hexdigest() for path in self.derived.glob('*.npy') if not path.name.endswith('.part.npy')}
            (self.derived / 'receipt.json').write_text(json.dumps({'inputs':self.derived_descriptor,'files':files,
                'producer':self.output.name,'kind':'computation artifacts only; no test success inferred'}), encoding='utf-8')
        return results, elapsed

    def candidate(self) -> dict:
        """Ровно доставляемые образы: nginx → адрес/порт туннеля → API → отдельная БД.

        SSH-соединение между машинами здесь не изображается реальным: проверяем
        HTTP-контракт частей, права отдельно проверяет REF-API-rights.
        """
        self.start_services()
        started = time.monotonic()
        digests = {key:self.checked(['docker', 'image', 'inspect', value, '--format', '{{.Id}}']) for key, value in self.images.items()}
        # Схема и ведро только в одноразовом приватном контуре.
        self.checked([*self.container(API_MEMORY), '--rm', *self.api_flags(), self.api_image, 'alembic', 'upgrade', 'head'])
        create_bucket = 'import boto3,os; boto3.client("s3",endpoint_url=os.environ["S3_ENDPOINT"],aws_access_key_id="synthetic",aws_secret_access_key="synthetic-test-only").create_bucket(Bucket=os.environ["S3_BUCKET"])'
        self.checked([*self.container(API_MEMORY), '--rm', *self.api_flags(), self.api_image, 'python', '-c', create_bucket])
        api_name = self.prefix + '-api'
        self.created.append(api_name)
        self.checked([*self.container(API_MEMORY), '-d', '--name', api_name, '--network-alias', 'reference-tunnel',
                      '--label', 'reference.testing=' + self.prefix, *self.api_flags(), self.api_image,
                      'uvicorn', 'reference_api.app:app', '--host', '0.0.0.0', '--port', '8031'])
        web_name = self.prefix + '-web'
        self.created.append(web_name)
        self.checked([*self.container('128m'), '-d', '--name', web_name, '--network', self.prefix,
                      '--label', 'reference.testing=' + self.prefix, self.images['web']])
        base = 'http://' + web_name + ':5173'

        def request(path: str, body: dict | None = None) -> tuple[int, bytes]:
            # У --internal сети нет опубликованного host-порта. Клиент идёт
            # по настоящему HTTP к nginx внутри того же изолированного контура.
            client = '''import sys,json,urllib.request,base64
data=sys.argv[2].encode() if sys.argv[2] else None
request=urllib.request.Request(sys.argv[1],data=data,headers={'Content-Type':'application/json'})
with urllib.request.urlopen(request,timeout=10) as response:
 print(json.dumps({'status':response.status,'body':base64.b64encode(response.read()).decode()}))'''
            raw = json.loads(self.checked(['docker','exec',api_name,'python','-c',client,
                                          base + path, json.dumps(body) if body is not None else ''], 20))
            return raw['status'], base64.b64decode(raw['body'])

        for _attempt in range(30):
            try:
                if request('/reference/api/health/live')[0] == 200:
                    break
            except (OSError, RuntimeError):
                pass
            time.sleep(1)
        else:
            raise RuntimeError('Candidate route did not become ready')
        status, html = request('/reference/')
        if status != 200 or b'assets/' not in html:
            raise RuntimeError('Candidate frontend did not serve its compiled artifact')
        build_inputs = json.loads(request('/reference/build-inputs.json')[1])
        if any(build_inputs.get(key) != value for key, value in self.environments['web'].items()):
            raise RuntimeError('Candidate frontend dependencies differ from tested dependencies')
        manifest = json.loads(request('/manifest')[1])
        if manifest.get('code') != 'reference':
            raise RuntimeError('Two-machine manifest route differs')
        work = {'version':3, 'coordinateSpace':'canvas', 'stateCode':'front', 'composition':{'elements':[], 'selectedId':None}}
        body = {'name':'TC-ADOPT-012 candidate synthetic', 'sheet_digest':'b' * 64, 'image_digests':[], 'texts':[], 'work':work}
        status, raw = request('/reference/api/references', body)
        identity = json.loads(raw)['id']
        full = json.loads(request(f'/reference/api/references/{identity}')[1])
        if status != 200 or full.get('work') != work:
            raise RuntimeError('Candidate did not preserve work through nginx/API/database')
        request(f'/reference/api/references/{identity}/trash', {})
        return {'accepted':True, 'image_digests':digests, 'duration_seconds':time.monotonic() - started,
                'outcomes':['compiled_frontend','same_resolved_frontend_dependencies','web_to_tunnel_address_8031_to_api',
                            'manifest_at_root','save_and_reopen_work_v3_real_postgres','synthetic_data_only'],
                'boundary':'Isolated HTTP contract, not a real cross-host SSH connection. Platform access is covered by separate server-side rights tests; no authenticated platform browser session is claimed.'}

    def close(self) -> None:
        # Только имена, созданные этим объектом; никакие рабочие контейнеры не выбираются.
        if self.created:
            command(['docker', 'rm', '-f', *reversed(self.created)], cwd=self.root, timeout=8)
        if self.network_created:
            command(['docker', 'network', 'rm', self.prefix], cwd=self.root, timeout=5)
