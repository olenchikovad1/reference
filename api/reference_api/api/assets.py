"""Файлы: вход по HTTP."""

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, UploadFile
from platform_client import Action, requires, requires_function
from sqlalchemy.ext.asyncio import AsyncSession

from reference_api.db import session
from reference_api.schemas.assets import AssetOut, DerivativeOut
from reference_api.schemas.library import (
    FileTagsOut,
    FoundCardOut,
    FoundOut,
    AudienceLinkOut,
    DefectOut,
    ReasonIn,
    DropLinkOut,
    LibraryItemOut,
    MatchOut,
    NameOut,
    RecognisedOut,
    TagOut,
)
from reference_api.services import assets as service
from reference_api.services import library, people
from reference_api.services import names as naming
from reference_api.services import tags as tagging

router = APIRouter(prefix="/assets", tags=["assets"])


# Загрузка кладёт файл в библиотеку — это запись в «Принтах».
@router.post("", response_model=list[AssetOut], dependencies=[requires("prints", Action.WRITE)])
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


@router.get("/search", response_model=list[FoundOut])
async def search(
    q: str = Query(min_length=1, max_length=200), db: AsyncSession = Depends(session)
) -> list[FoundOut]:
    """Картинки по смыслу слова, по весу, с карточками, где они стоят.

    Слово любое и в любой форме — не обязано быть тегом. Пустая выдача значит
    «ничего не нашлось», а не ошибку.
    """
    query = q.strip()
    if not query:
        raise HTTPException(status_code=422, detail="пустой запрос")
    found = await library.search(db, query)
    return [
        FoundOut(digest=f.digest, name=f.name, similarity=round(f.similarity, 4), weight=round(f.weight, 2),
                 references=[FoundCardOut(id=c.id, name=c.name) for c in f.references])
        for f in found
    ]


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
    # Имя — хеш содержимого: по этому адресу другое содержимое не появится
    # никогда, браузеру незачем спрашивать второй раз.
    return Response(content, media_type=content_type,
                    headers={"Cache-Control": "public, max-age=31536000, immutable"})


# Узнавание запоминает векторы, теги и названия файлов — тоже запись.
@router.post("/recognise", response_model=list[RecognisedOut], dependencies=[requires("prints", Action.WRITE)])
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
        found = await library.put_tags(db, digest, emb.vector)
        named = await naming.name_of(db, digest, seen)
        # Забракованная — сразу видно: эта же или та же в другом файле (US-0499).
        defect = (await library.defect_of(db, [digest])).get(digest)
        names = await people.names_of(db, [defect.marked_by] if defect and defect.marked_by else [])
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
                defect=_defect_out(defect, names),
            )
        )
    return out


def _name_out(n: naming.Name | None) -> NameOut | None:
    return None if n is None else NameOut(name=n.name, source=n.source, from_digest=n.from_digest)


# POST только ради списка хешей в теле: данные не меняются — нужен просмотр.
@router.post("/tags", response_model=list[FileTagsOut], dependencies=[requires("prints", Action.VIEW)])
async def file_tags(digests: list[str], db: AsyncSession = Depends(session)) -> list[FileTagsOut]:
    """Теги файлов. Нет — досчитываются по уже лежащему вектору; нет и
    вектора — у файла пусто, пока его не узнавали."""
    return [
        FileTagsOut(digest=f.digest, tags=[_tag_out(x) for x in f.tags], name=_name_out(f.name))
        for f in await library.tags_of_files(db, digests)
    ]


def _tag_out(x: library.TagView) -> TagOut:
    return TagOut(code=x.code, name=x.name, score=x.score, strong=x.strong, model=x.model)


def _defect_out(d: library.Defect | None, names: dict[str, str]) -> DefectOut | None:
    return None if d is None else DefectOut(digest=d.digest, reason=d.reason, marked_by=d.marked_by,
                                            marked_by_name=names.get(d.marked_by or ""), marked_at=d.marked_at)


@router.post("/{digest}/defect", status_code=204, dependencies=[requires_function("prints", "mark-defect")])
async def mark_defect(digest: str, body: ReasonIn, request: Request, db: AsyncSession = Depends(session)) -> None:
    """Пометить картинку браком с причиной (US-0499): в выдаче и дропах её
    больше нет, в референс она не кладётся, при повторной загрузке узнаётся."""
    subject = getattr(request.state, "subject", None)
    try:
        await library.mark_defect(db, digest, body.reason, subject.id if subject else None)
    except library.BadDecision as refusal:
        raise HTTPException(422, str(refusal)) from None


@router.delete("/{digest}/defect", status_code=204, dependencies=[requires_function("prints", "mark-defect")])
async def unmark_defect(digest: str, db: AsyncSession = Depends(session)) -> None:
    """Снять брак — тем же правом, что ставят."""
    await library.unmark_defect(db, digest)


@router.get("/library", response_model=list[LibraryItemOut])
async def catalogue(defects: bool = False, db: AsyncSession = Depends(session)) -> list[LibraryItemOut]:
    """Библиотека для страницы «Принты»: картинки, свежие первыми, с тегами,
    названием и «где использован». defects=true — только забракованные."""
    items = await library.catalogue(db, defects)
    names = await people.names_of(db, [i.defect.marked_by for i in items if i.defect and i.defect.marked_by])
    return [
        LibraryItemOut(
            digest=i.digest, file_name=i.file_name, tags=[_tag_out(x) for x in i.tags.tags],
            name=_name_out(i.tags.name), references=[FoundCardOut(id=c.id, name=c.name) for c in i.references],
            drops=[DropLinkOut(id=d.id, name=d.name, retired=d.retired, via=d.via, status=d.status, reason=d.reason) for d in i.links.drops.values()],
            audiences=[AudienceLinkOut(code=a, via=v) for a, v in i.links.audiences.items()],
            categories=sorted(i.links.categories),
            defect=_defect_out(i.defect, names),
        )
        for i in items
    ]
