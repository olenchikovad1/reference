"""Переразметка библиотеки в фоне (план 087, US-0629).

Новые модели (вид, аниме-разметчик) работали бы только на новых загрузках, а
вся библиотека осталась бы размеченной прежней моделью, и искать по ней было
бы по-прежнему плохо. Проход идёт по устаревшим картинкам — у которых вид
посчитан прежним маршрутизатором или теги не от тех моделей, что он назвал.

Свои теги и скрытые автотеги не трогаются по устройству: они живут у
референса (reference_tags, reference_hidden_tags), а проход меняет только
теги файла (asset_tags) и его вид.

Ход — в строке запуска (retag_runs): сколько из скольких и что не удалось, с
причиной. Прерванный — перезапуском сервиса или падением — продолжается при
старте: устаревшие считаются заново, сделанное второй раз не делается.
Модели крутятся в потоке, а не в цикле событий: окно и витрина не ждут.
"""

import asyncio
import logging
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from reference_api.config import settings
from reference_api.db import session_factory
from reference_api.models.library import RetagRun
from reference_api.repositories import library as repo
from reference_api.repositories import tags as tag_repo
from reference_api.services import anime, embeddings, kinds, library
from reference_api.services import tags as tagging

log = logging.getLogger("reference.retag")

_task: asyncio.Task | None = None


async def stale(db: AsyncSession) -> list[str]:
    """Картинки библиотеки, чья разметка не та, что дали бы нынешние модели."""
    digests = [d for d, _ in await repo.images(db, embeddings.MODEL_NAME)]
    if not digests:
        return []
    stored = await repo.kinds_of(db, digests)
    general = await tag_repo.of(db, digests, tagging.model_name())
    anime_rows = await tag_repo.of(db, digests, anime.model_name())
    out = []
    for d in digests:
        k = stored.get(d)
        if k is None or k.model != kinds.ROUTER_NAME:
            out.append(d)
            continue
        use = kinds.taggers(kinds.Verdict(k.kind, k.second, k.gap, k.manual))
        if ("anime" in use) != bool(anime_rows.get(d)) or ("general" in use) != bool(general.get(d)):
            out.append(d)
    return out


async def _strong_counts(db: AsyncSession) -> dict[str, int]:
    """Сильных тегов у каждой картинки. Только чтение хранимого: снимок не
    должен сам ничего досчитывать — иначе «было» окажется уже наполовину
    «стало», а упавшая модель уронит запуск."""
    digests = [d for d, _ in await repo.images(db, embeddings.MODEL_NAME)]
    general = await tag_repo.of(db, digests, tagging.model_name())
    anime_rows = await tag_repo.of(db, digests, anime.model_name())
    return {d: sum(tagging.strong_of([t.score for t in general.get(d, [])]))
            + min(len(anime_rows.get(d, [])), tagging.STRONG_MAX) for d in digests}


async def _by_kind(db: AsyncSession, counts: dict[str, int]) -> dict:
    """Сгруппировать по ИТОГОВОМУ виду: до прохода вида у старой картинки
    нет, и «было» по видам иначе не с чем сравнить."""
    stored = await repo.kinds_of(db, list(counts))
    per: dict[str, list[int]] = {}
    for d, n in counts.items():
        k = stored.get(d)
        per.setdefault(kinds.NAMES.get(k.manual or k.kind, k.kind) if k else "вид не определён", []).append(n)
    return {k: {"картинок": len(v), "сильных тегов в среднем": round(sum(v) / len(v), 1)} for k, v in per.items()}


async def _one(digest: str) -> None:
    async with session_factory() as db:
        vec = await tag_repo.vector_of(db, digest, embeddings.MODEL_NAME)
        if vec is None:
            raise RuntimeError("нет вектора — картинку ни разу не узнавали")
        verdict = await library.put_kind(db, digest, vec)
        await library._run_taggers(db, digest, vec, verdict)


async def _run(run_id: int, todo: list[str] | None = None) -> None:
    """`todo` — посчитанный до снимка «было»: снимок сам досчитывает
    устаревший вид, и после него устаревших оказалось бы меньше, чем в ходе."""
    async with session_factory() as db:
        todo = todo if todo is not None else await stale(db)
        names = dict(await repo.images(db, embeddings.MODEL_NAME))
    for digest in todo:
        reason = None
        try:
            await _one(digest)
        except Exception as e:  # одна картинка не должна останавливать проход
            reason = f"{type(e).__name__}: {e}"
            log.warning("переразметка %s не удалась: %s", digest[:12], reason)
        async with session_factory() as db:
            run = await db.get(RetagRun, run_id)
            run.done += 1
            if reason:
                run.failed = [*run.failed, {"digest": digest, "name": names.get(digest, digest[:12]), "reason": reason}]
            await db.commit()
        await asyncio.sleep(0)
    async with session_factory() as db:
        run = await db.get(RetagRun, run_id)
        # До конца «было» лежит по картинкам; в конце и оно, и «стало» —
        # по итоговому виду, рядом.
        before = run.before.get("по картинкам", {})
        run.after = await _by_kind(db, await _strong_counts(db))
        run.before = await _by_kind(db, {d: n for d, n in before.items()})
        run.finished_at = datetime.now(UTC)
        await db.commit()
    log.info("переразметка %d закончена: %d из %d, не удалось %d", run_id, run.done, run.total, len(run.failed))


def _spawn(run_id: int, todo: list[str] | None = None) -> None:
    global _task
    _task = asyncio.create_task(_run(run_id, todo))


async def start(db: AsyncSession, by: str | None) -> RetagRun:
    """Запустить — или вернуть идущий: два прохода разом делали бы одно и то
    же и мешали друг другу."""
    last = await current(db)
    if last is not None and last.finished_at is None:
        return last
    todo = await stale(db)
    run = RetagRun(started_by=by, total=len(todo), done=0, failed=[], before={"по картинкам": await _strong_counts(db)})
    db.add(run)
    await db.commit()
    await db.refresh(run)
    _spawn(run.id, todo)
    return run


async def current(db: AsyncSession) -> RetagRun | None:
    return await db.scalar(select(RetagRun).order_by(RetagRun.id.desc()).limit(1))


async def resume_at_start() -> None:
    """Прерванный проход продолжается при старте сервиса: сделанное считается
    заново по устаревшим — второй раз не делается.

    Сначала ждёт, потом смотрит: сразу при подъёме запрос ловил отмену в
    коротких жизнях приложения (тесты) и оставлял соединение пула на чужом
    цикле событий — следующий тест падал «attached to a different loop»
    (28.09.2026; то же у очистки корзины, schedulers/references.py)."""
    await asyncio.sleep(settings().retag_resume_delay_seconds)
    async with session_factory() as db:
        run = await current(db)
        if run is None or run.finished_at is not None:
            return
        left = len(await stale(db))
        run.total = run.done + left
        await db.commit()
    log.info("переразметка %d продолжается: осталось %d", run.id, left)
    _spawn(run.id)


def running() -> bool:
    return _task is not None and not _task.done()

