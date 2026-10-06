"""Тесты работают в СВОЕЙ базе, а не в базе стенда.

Две причины, и обе проявились не в теории. Векторы узнавания копятся: прогон
оставляет их в базе, следующий находит собственные прошлые следы и проходит
по чужому наследству, а не по тому, что проверяет. И обратное — прогон,
чистящий общую базу, стирает то, что человек накопил руками в браузере.

Адрес подменяется здесь, в теле conftest, а не в оснастке: pytest исполняет
этот файл до импорта тестовых модулей, а движок создаётся при импорте
``reference_api.db``. Подмена в фикстуре опоздала бы ровно на один импорт.
"""

import asyncio
import io
import os
import pathlib

import pytest_asyncio

_SUFFIX = "_test"

# Тесты по умолчанию — стенд без платформы (решение 0006): запрос без токена
# получает стендового субъекта со всеми грантами манифеста. Иначе каждый тест
# сохранения и загрузки упирался бы в «нет такого пути». Права проверяют
# отдельные тесты, собирая приложение с without_platform=False (test_rights.py).
# Ставится, а не предлагается по умолчанию: у стенда за платформой в api/.env
# WITHOUT_PLATFORM=false, контейнер наследует его, и 28.09.2026 это уронило
# 66 тестов — набор зависел от того, подключён ли стенд к платформе.
os.environ["WITHOUT_PLATFORM"] = "true"
# Задачи расшифровки тесты в брокер не ставят: у тестов своя база, а
# сообщение забрал бы живой сервис стенда. Расшифровку тест зовёт сам.
os.environ["AMQP_URL"] = ""
# И в колокол платформы тесты не звонят: звонок подменяется в test_bell.
os.environ["PLATFORM_NOTIFICATIONS_URL"] = ""


def _switch_to_test_database() -> None:
    url = os.environ["DATABASE_URL"]
    base, _, name = url.rpartition("/")
    if name.endswith(_SUFFIX):
        return
    asyncio.run(_create_if_absent(base, name + _SUFFIX))
    os.environ["DATABASE_URL"] = f"{base}/{name}{_SUFFIX}"


async def _create_if_absent(base: str, name: str) -> None:
    """Создаёт базу, если её ещё нет.

    Через asyncpg напрямую: CREATE DATABASE не выполняется внутри транзакции,
    а SQLAlchemy заворачивает в неё всё.
    """
    import asyncpg

    dsn = base.replace("postgresql+asyncpg://", "postgresql://") + "/postgres"
    conn = await asyncpg.connect(dsn)
    try:
        exists = await conn.fetchval("select 1 from pg_database where datname = $1", name)
        if not exists:
            await conn.execute(f'create database "{name}"')
    finally:
        await conn.close()


def _bring_schema_up() -> None:
    """Схему тестовой базы поднимают ТЕ ЖЕ миграции, что и боевую.

    Создавать её из метаданных было бы быстрее и проверяло бы другое: тогда
    сломанная миграция проходит все тесты и обнаруживается на выкатке.
    """
    from alembic import command
    from alembic.config import Config

    cfg = Config(str(pathlib.Path(__file__).resolve().parents[1] / "alembic.ini"))
    command.upgrade(cfg, "head")


def _switch_to_test_bucket() -> None:
    """Своя корзина хранилища, как своя база: 28.09.2026 выяснилось, что тесты
    клали и стирали файлы в корзине стенда — тест «удалить насовсем» при
    каждом прогоне уносил из хранилища стенда настоящий принт вертолёта."""
    import boto3
    from botocore.config import Config
    from botocore.exceptions import ClientError

    name = os.environ["S3_BUCKET"]
    if name.endswith(_SUFFIX.replace("_", "-")):
        return
    test = name + _SUFFIX.replace("_", "-")
    s3 = boto3.client("s3", endpoint_url=os.environ["S3_ENDPOINT"], aws_access_key_id=os.environ["S3_ACCESS_KEY"],
                      aws_secret_access_key=os.environ["S3_SECRET_KEY"], region_name=os.environ.get("S3_REGION", "us-east-1"),
                      config=Config(signature_version="s3v4"))
    try:
        s3.head_bucket(Bucket=test)
    except ClientError:
        s3.create_bucket(Bucket=test)
    os.environ["S3_BUCKET"] = test


_switch_to_test_database()
_switch_to_test_bucket()
_bring_schema_up()


# --- Набор стенда для поиска, дропов и тегов -------------------------------

PRINTS = pathlib.Path("/srv/reference/files/prints")
_FIX = pathlib.Path("/srv/reference/fixtures")


@pytest_asyncio.fixture
async def stand():
    """Клиент и библиотека из всего набора: вес картинки считается относительно
    остальных, и на трёх картинках он меряет не то же, что на тридцати.

    Разметка набора моделями — около тридцати секунд, а результат зависит
    только от файлов и модели. Поэтому она держится между тестами: в
    библиотеке оставляется ровно набор (чужие картинки других тестов
    убираются — они сдвигали бы вес), и моделями размечается только то, чего
    в ней нет. Карточки референсов чистятся каждый раз, как и раньше."""
    import hashlib

    import httpx
    import yaml
    from sqlalchemy import text

    from reference_api.app import create_app
    from reference_api.db import engine
    from reference_api.services.embeddings import MODEL_NAME

    fx = yaml.safe_load((_FIX / "prints.yaml").read_text(encoding="utf-8"))
    names = [e["name"] for e in fx["files"] + fx["tuning_set"]]
    content = {n: (PRINTS / n).read_bytes() for n in names}
    keys = sorted({hashlib.sha256(b).hexdigest() for b in content.values()})

    app = create_app()
    async with app.router.lifespan_context(app):
        async with engine.begin() as conn:
            await conn.execute(text("truncate table reference_cards cascade"))
            await conn.execute(text("delete from asset_tags where not (digest = any(:k))"), {"k": keys})
            await conn.execute(text("delete from asset_embeddings where not (digest = any(:k))"), {"k": keys})
            have = set((await conn.execute(
                text("select digest from asset_embeddings where model = :m and digest = any(:k)"),
                {"m": MODEL_NAME, "k": keys},
            )).scalars())
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://stand") as c:
            # Файлы кладутся всегда: хранилище тестов общее с другими наборами,
            # а повторная загрузка того же содержимого ничего не меняет.
            r = await c.post("/reference/api/assets", files=[
                ("files", (n, io.BytesIO(content[n]), "image/png")) for n in names])
            assert r.status_code == 200, r.text
            digests = {a["name"]: a["digest"] for a in r.json()}
            missing = [d for d in digests.values() if d not in have]
            if missing:
                rec = await c.post("/reference/api/assets/recognise", json=missing)
                assert rec.status_code == 200, rec.text
            yield c, digests
    await engine.dispose()
