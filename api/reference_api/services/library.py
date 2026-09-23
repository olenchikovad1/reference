"""Библиотека: правила узнавания.

Окно показывается ТОЛЬКО если нашлось. Не нашлось — не показывается ничего:
окно «совпадений нет» превращает подсказку в помеху, и его перестают читать.
"""

from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from reference_api.config import settings
from reference_api.repositories import library as repo
from reference_api.services import embeddings


@dataclass(frozen=True)
class Match:
    digest: str
    name: str
    similarity: float
    #: same — та же картинка; close — похожая по теме.
    level: str


async def remember(db: AsyncSession, digest: str, name: str, content: bytes) -> list[Match]:
    """Считает вектор, ищет похожее и запоминает.

    Порядок важен: сначала ищем, потом запоминаем. Иначе файл найдёт сам себя.
    """
    emb = embeddings.embed(content)
    found = await repo.nearest(db, emb.model, emb.vector, exclude=digest)
    await repo.put(db, digest, name, emb.model, emb.vector)

    cfg = settings()
    out: list[Match] = []
    for d, n, s in found:
        if s >= cfg.similarity_same:
            out.append(Match(d, n, s, "same"))
        elif s >= cfg.similarity_close:
            out.append(Match(d, n, s, "close"))
    return out


async def put_vector(
    db: AsyncSession, digest: str, name: str, emb: embeddings.Embedding, kind: str
) -> None:
    """Кладёт готовый вектор нужного вида. Считать заново незачем."""
    await repo.put(db, digest, name, emb.model, emb.vector, kind=kind)


async def same_as(db: AsyncSession, digest: str, kind: str) -> list[str]:
    """Файлы, которые это же изображение, но другой файл.

    Тот же файл сюда не входит: его ловит хеш, и вторая сеть нужна ровно для
    того, что первая пропускает.
    """
    content = None
    from reference_api.services import assets

    content = assets.original(digest)
    if content is None:
        return []
    emb = embeddings.embed(content)
    found = await repo.nearest(db, emb.model, emb.vector, exclude=digest, kind=kind)
    cfg = settings()
    return [d for d, _, s in found if s >= cfg.similarity_same]
