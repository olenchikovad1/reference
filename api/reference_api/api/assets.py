"""Файлы: вход по HTTP."""

from fastapi import APIRouter, Depends, HTTPException, Response, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from reference_api.db import session
from reference_api.schemas.assets import AssetOut, DerivativeOut
from reference_api.repositories import tags as tag_repo
from reference_api.schemas.library import FileTagsOut, MatchOut, NameOut, RecognisedOut, TagOut
from reference_api.services import assets as service
from reference_api.services import library
from reference_api.services import names as naming
from reference_api.services import tags as tagging

router = APIRouter(prefix="/assets", tags=["assets"])


@router.post("", response_model=list[AssetOut])
async def upload(files: list[UploadFile]) -> list[AssetOut]:
    """Несколько файлов одной операцией.

    По одному — та же работа, ради устранения которой всё затевалось: перебрать
    десяток заготовок должно стоить одного перетаскивания.
    """
    out: list[AssetOut] = []
    for f in files:
        name = f.filename or "без имени"
        try:
            # Объявленный размер проверяется до чтения, настоящий — в store:
            # объявленного может не быть, и верить ему на слово нельзя.
            service.check_size(name, f.size)
            stored = service.store(await f.read(), name)
        except service.TooLarge as e:
            # Код и форма — как у сервиса файлов платформы: страница, читающая
            # отказ, после переезда не должна заметить разницы.
            raise HTTPException(413, {"code": "file_too_large", "reason": str(e)}) from None
        except service.NotAnImage as e:
            raise HTTPException(415, f"{f.filename}: содержимое не опознано как изображение ({e})") from None
        out.append(
            AssetOut(
                digest=stored.digest,
                name=stored.name,
                content_type=stored.content_type,
                width=stored.width,
                height=stored.height,
                reused=stored.reused,
                derivatives=[
                    DerivativeOut(name=d.name, width=d.width, height=d.height, is_copy=d.is_copy)
                    for d in stored.derivatives
                ],
            )
        )
    return out


@router.get("/{digest}/{preset}")
def derivative(digest: str, preset: str) -> Response:
    """Ступень байтами.

    Оригинал через этот маршрут не отдаётся: он в браузер не уходит никогда.
    """
    try:
        content, content_type = service.fetch(digest, preset)
    except service.UnknownPreset:
        raise HTTPException(404, f"Ступени {preset} не существует") from None
    except service.AssetMissing:
        raise HTTPException(404, f"Файла {digest} нет в хранилище") from None
    return Response(content, media_type=content_type)


@router.post("/recognise", response_model=list[RecognisedOut])
async def recognise(
    digests: list[str], db: AsyncSession = Depends(session)
) -> list[RecognisedOut]:
    """Узнавание отдельным запросом, которого страница НЕ ждёт.

    Модель считает около 90 мс на картинку — на десятке файлов это почти
    секунда, и внутри загрузки она превращается в секунду, пока картинка не
    появилась на изделии. Человек бросил файлы и работает дальше, а окно
    приходит, когда придёт.

    Содержимое берётся из хранилища, а не присылается второй раз: файл уже
    лежит, и гонять его по сети дважды незачем.
    """
    out: list[RecognisedOut] = []
    for digest in digests:
        content = service.original(digest)
        if content is None:
            continue
        seen, emb = await library.remember(db, digest, service.name_of(digest), content)
        # Теги — из того же вектора: картинку уже посмотрели, второй раз
        # модель не нужна.
        found = tagging.tag(emb.vector)
        await tag_repo.replace(db, digest, tagging.model_name(), [(x.code, x.name, x.score) for x in found])
        named = await naming.name_of(db, digest, seen)
        out.append(
            RecognisedOut(
                digest=digest,
                matches=[
                    MatchOut(digest=m.digest, name=m.name, similarity=m.similarity, level=m.level)
                    for m in seen
                ],
                tags=[
                    TagOut(code=x.code, name=x.name, score=x.score, strong=x.strong, model=tagging.model_name())
                    for x in found
                ],
                name=_name_out(named),
            )
        )
    return out


def _name_out(n: naming.Name | None) -> NameOut | None:
    return None if n is None else NameOut(name=n.name, source=n.source, from_digest=n.from_digest)


@router.post("/tags", response_model=list[FileTagsOut])
async def file_tags(digests: list[str], db: AsyncSession = Depends(session)) -> list[FileTagsOut]:
    """Теги файлов. Нет — досчитываются по уже лежащему вектору; нет и
    вектора — у файла пусто, пока его не узнавали."""
    from reference_api.services.embeddings import MODEL_NAME as IMAGE_MODEL

    model = tagging.model_name()
    stored = await tag_repo.of(db, digests, model)
    named = await naming.stored(db, digests)
    out: list[FileTagsOut] = []
    for d in digests:
        rows = stored.get(d, [])
        if not rows:
            vec = await tag_repo.vector_of(db, d, IMAGE_MODEL)
            if vec is not None:
                found = tagging.tag(vec)
                await tag_repo.replace(db, d, model, [(x.code, x.name, x.score) for x in found])
                rows = (await tag_repo.of(db, [d], model))[d]
        # Хранятся веса, а не пометка «сильный»: граница считается из весов
        # тем же правилом, что при постановке, и смена доли не требует
        # пересчёта тегов.
        strong = tagging.strong_of([r.score for r in rows])
        out.append(
            FileTagsOut(
                digest=d,
                tags=[
                    TagOut(code=r.code, name=r.name, score=r.score, strong=st, model=r.model)
                    for r, st in zip(rows, strong, strict=True)
                ],
                name=_name_out(named.get(d)),
            )
        )
    return out
