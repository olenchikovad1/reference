"""Что за изделие на принте — по надёжности (US-0479).

Источников два, и порядок между ними — порядок надёжности:

  catalog   — подпись принта в каталоге набора (prints.yaml, subject);
  inherited — название той же картинки, узнанной вектором: уменьшенный,
              пересохранённый, перекрашенный файл — та же картинка, и имя у
              неё то же.

Третьего — догадки модели — нет, и это решение по замеру, а не недоделка.
Модель выбирала название из шести известных: угадан вертолёт, единственный в
наборе, и два танка из семи — на уровне случайного выбора из пяти названий.
Первые три места разделяли 0.002–0.005, то есть шум
(scripts/measure_names.py). Показанная, такая догадка выглядела бы знанием.
"""

from dataclasses import dataclass
from functools import lru_cache

from sqlalchemy.ext.asyncio import AsyncSession

from reference_api.repositories import names as repo
from reference_api.services import assets, prints
from reference_api.services.library import Match

CATALOG = "catalog"
INHERITED = "inherited"

#: Уровни узнавания, на которых картинка — та же. «Похожая по теме» имени не
#: передаёт: два разных танка похожи сильнее, чем один танк в двух видах.
SAME = ("file", "same")


@dataclass(frozen=True)
class Name:
    name: str
    source: str
    from_digest: str | None


@lru_cache
def _catalogue() -> dict[str, str]:
    """Хеш файла набора → подпись. Набор — единицы файлов, хешируются раз на
    запуск; положили новый принт в том — видно после перезапуска."""
    out: dict[str, str] = {}
    for item in prints.catalogue():
        if item["kind"] == "artwork" and item["subject"]:
            out[assets.digest(prints.content(item["path"]))] = item["subject"]
    return out


async def name_of(db: AsyncSession, digest: str, seen: list[Match]) -> Name | None:
    """Название файла: из каталога, иначе уже известное, иначе от той же
    картинки среди узнанных. Нет ни одного — названия нет, и это честнее
    догадки."""
    subject = _catalogue().get(digest)
    if subject:
        got = await repo.put(db, digest, subject, CATALOG, None)
        return Name(got.name, got.source, got.from_digest)
    stored = await repo.get(db, digest)
    if stored is not None:
        return Name(stored.name, stored.source, stored.from_digest)
    for m in sorted(seen, key=lambda m: -m.similarity):
        if m.level not in SAME:
            continue
        parent = _catalogue().get(m.digest) or getattr(await repo.get(db, m.digest), "name", None)
        if parent:
            got = await repo.put(db, digest, parent, INHERITED, m.digest)
            return Name(got.name, got.source, got.from_digest)
    return None


async def stored(db: AsyncSession, digests: list[str]) -> dict[str, Name]:
    return {d: Name(r.name, r.source, r.from_digest) for d, r in (await repo.of(db, digests)).items()}
