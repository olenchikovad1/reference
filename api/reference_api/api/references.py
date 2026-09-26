"""Собранный принт: вход по HTTP."""

from fastapi import APIRouter, Depends, HTTPException, Request
from platform_client import Action, requires, requires_function
from sqlalchemy.ext.asyncio import AsyncSession

from reference_api.db import session
from reference_api.schemas.library import ReasonIn
from reference_api.schemas.references import (
    CardOut,
    DraftIn,
    DraftOut,
    OrderIn,
    TrashedOut,
    FoundReferenceOut,
    HiddenTagIn,
    TagIn,
    TagsOut,
    ForkOut,
    FoundOut,
    ReferenceMatchOut,
    ReferenceOut,
    SavedOut,
    SaveIn,
    AutoVersionIn,
    VersionMetaOut,
    VersionOut,
)
from reference_api.services import drops, people
from reference_api.services import references as service

router = APIRouter(prefix="/references", tags=["references"])


def _author(request: Request) -> str | None:
    # Субъекта кладёт посредник платформы (app.py); нет токена или он не
    # принят — None: отказ без права делает объявление на маршруте (US-0487).
    subject = getattr(request.state, "subject", None)
    return subject.id if subject else None


def _saved(saved: service.Saved) -> SavedOut:
    return SavedOut(
        id=saved.reference_id,
        number=saved.number,
        matches=[
            ReferenceMatchOut(
                by=m.by,
                reference_id=m.reference_id,
                name=m.name,
                similarity=m.similarity,
                level=m.level,
                text=m.text,
            )
            for m in saved.matches
        ],
    )


@router.post("", response_model=SavedOut, dependencies=[requires("references", Action.WRITE)])
async def create(body: SaveIn, request: Request, db: AsyncSession = Depends(session)) -> SavedOut:
    """Новый референс с первой версией — и сразу что узналось. С
    ``forked_from`` — «Сохранить как»."""
    if body.colour_model_id is not None:
        # Цветомодель без кадров — работу на ней не начать, и причина названа.
        try:
            await drops.colour_model_for_work(db, body.colour_model_id)
        except drops.CannotWork as refusal:
            raise HTTPException(status_code=422, detail=str(refusal)) from None
    try:
        saved = await service.create(
            db, body.name, body.sheet_digest, body.image_digests, body.texts, body.work,
            author_id=_author(request), colour_model_id=body.colour_model_id,
            forked_from=(body.forked_from.reference_id, body.forked_from.number) if body.forked_from else None,
            views=body.views,
        )
    except service.NoSuchReference as missing:
        raise HTTPException(status_code=422, detail=str(missing)) from None
    except service.DefectInWork as refusal:
        raise HTTPException(status_code=422, detail=str(refusal)) from None
    return _saved(saved)


@router.post(
    "/{reference_id}/versions", response_model=SavedOut, dependencies=[requires("references", Action.WRITE)]
)
async def add_version(
    reference_id: int, body: AutoVersionIn, request: Request, db: AsyncSession = Depends(session)
) -> SavedOut:
    """«Сохранить»: новая версия поверх последней; прежние не меняются (И-6)."""
    try:
        saved = await service.add_version(
            db, reference_id, body.name, body.sheet_digest, body.image_digests, body.texts, body.work,
            author_id=_author(request), views=body.views, auto_reason=body.auto_reason,
        )
    except service.NoSuchReference as missing:
        raise HTTPException(status_code=404, detail=str(missing)) from None
    except service.DefectInWork as refusal:
        raise HTTPException(status_code=422, detail=str(refusal)) from None
    return _saved(saved)


def _tags(t: service.Tags) -> TagsOut:
    return TagsOut(own=t.own, hidden=[HiddenTagIn(code=c, name=n) for c, n in t.hidden])


@router.get("/find", response_model=list[FoundReferenceOut])
async def find(q: str, db: AsyncSession = Depends(session)) -> list[FoundReferenceOut]:
    """Поиск на витрине: свои теги первыми, затем надпись дословно, затем
    картинки по смыслу. Скрытый у референса автотег его больше не находит."""
    return [
        FoundReferenceOut(id=f.reference_id, name=f.name, by=f.by, rank=round(f.rank, 3), what=f.what,
                          reasons=list(f.reasons))
        for f in await service.find(db, q)
    ]


@router.get("/tag-names", response_model=list[str])
async def tag_names(prefix: str = "", db: AsyncSession = Depends(session)) -> list[str]:
    """Подсказка при вводе своего тега — уже заведённые, частые первыми."""
    return await service.tag_names(db, prefix)


@router.post(
    "/{reference_id}/tags", response_model=TagsOut, dependencies=[requires("references", Action.WRITE)]
)
async def add_tag(reference_id: int, body: TagIn, request: Request, db: AsyncSession = Depends(session)) -> TagsOut:
    """Свой тег — важнее любого автотега в поиске."""
    try:
        return _tags(await service.add_tag(db, reference_id, body.name, _author(request)))
    except service.NoSuchReference as missing:
        raise HTTPException(404, str(missing)) from None


@router.delete(
    "/{reference_id}/tags", response_model=TagsOut, dependencies=[requires("references", Action.WRITE)]
)
async def remove_tag(reference_id: int, name: str, db: AsyncSession = Depends(session)) -> TagsOut:
    return _tags(await service.remove_tag(db, reference_id, name))


@router.post(
    "/{reference_id}/hidden-tags", response_model=TagsOut, dependencies=[requires("references", Action.WRITE)]
)
async def hide_tag(reference_id: int, body: HiddenTagIn, db: AsyncSession = Depends(session)) -> TagsOut:
    """Неверный автотег скрыт у этого референса и больше его не находит."""
    try:
        return _tags(await service.hide_tag(db, reference_id, body.code, body.name))
    except service.NoSuchReference as missing:
        raise HTTPException(404, str(missing)) from None


@router.delete(
    "/{reference_id}/hidden-tags", response_model=TagsOut, dependencies=[requires("references", Action.WRITE)]
)
async def unhide_tag(reference_id: int, code: str, db: AsyncSession = Depends(session)) -> TagsOut:
    return _tags(await service.unhide_tag(db, reference_id, code))


@router.get("/search", response_model=list[FoundOut])
async def search(q: str, db: AsyncSession = Depends(session)) -> list[FoundOut]:
    """Точный поиск по надписи.

    Именно точный: «где мы писали ЛЕТО 2025» — это совпадение слов, а не
    «что-то про лето». Вектор здесь вернул бы похожее, и человек решил бы, что
    поиск сломан.
    """
    return [FoundOut(id=i, name=n) for i, n in await service.search(db, q)]


@router.get("", response_model=list[CardOut])
async def latest(request: Request, db: AsyncSession = Depends(session)) -> list[CardOut]:
    """Референсы, свежие по последней версии первыми."""
    return await _cards(db, await service.latest(db), _author(request))


async def _cards(db: AsyncSession, rows, viewer: str | None = None) -> list[CardOut]:
    drafting = await service.drafters(db, [c.id for c, _ in rows])
    placed = await service.positions(db, viewer, [c.id for c, _ in rows]) if viewer else {}
    names = await people.names_of(
        db, [v.author_id for _, v in rows if v.author_id] + [a for authors in drafting.values() for a in authors]
    )
    models = await drops.colour_models_of(db, [c.colour_model_id for c, _ in rows if c.colour_model_id])
    origins = await service.origins(db, [c for c, _ in rows])
    out = []
    for c, v in rows:
        cm = models.get(c.colour_model_id) if c.colour_model_id else None
        out.append(CardOut(
            id=c.id, name=c.name, number=v.number, saved_at=v.created_at, author_id=v.author_id,
            author_name=names.get(v.author_id or ""), views=v.views or {},
            colour_code=cm.colour_code if cm else None, drops=cm.drops if cm else [],
            forked_from_id=origins.get(c.id),
            drop_ids=[d.id for d in cm.drop_refs] if cm else [],
            audience=cm.audience if cm else None, category=cm.category if cm else None,
            my_draft=viewer in drafting.get(c.id, []),
            others_drafts=[names.get(a, a) for a in drafting.get(c.id, []) if a != viewer],
            my_position=placed.get(c.id),
        ))
    return out


@router.get("/trash", response_model=list[TrashedOut])
async def trash_list(db: AsyncSession = Depends(session)) -> list[TrashedOut]:
    """Корзина: удалённые, свежие первыми, с датой, когда сотрутся сами."""
    rows = await service.trashed(db)
    cards = await _cards(db, rows)
    return [
        TrashedOut(**card.model_dump(), deleted_at=c.deleted_at, purge_at=service.purge_date(c.deleted_at))
        for card, (c, _) in zip(cards, rows, strict=True)
    ]


@router.post("/{reference_id}/copy", response_model=SavedOut, dependencies=[requires("references", Action.WRITE)])
async def copy(
    reference_id: int, request: Request, drop_id: int | None = None, db: AsyncSession = Depends(session)
) -> SavedOut:
    """Копия последней версии без открытия, с отметкой, от какого пошла.
    С `drop_id` — «скопировать в дроп» (US-0501)."""
    try:
        return _saved(await service.copy(db, reference_id, _author(request), drop_id))
    except service.NoSuchReference as missing:
        raise HTTPException(404, str(missing)) from None
    except service.NotInDrop as refusal:
        raise HTTPException(422, str(refusal)) from None


@router.post("/{reference_id}/drop", status_code=204, dependencies=[requires("references", Action.WRITE)])
async def move_to_drop(reference_id: int, drop_id: int, db: AsyncSession = Depends(session)) -> None:
    """«Назначить дроп» (US-0501): референс переходит на цветомодель той же
    модели в ассортименте дропа; нет модели там — отказ с причиной."""
    try:
        await service.move_to_drop(db, reference_id, drop_id)
    except service.NoSuchReference as missing:
        raise HTTPException(404, str(missing)) from None
    except service.NotInDrop as refusal:
        raise HTTPException(422, str(refusal)) from None


@router.post("/{reference_id}/trash", status_code=204, dependencies=[requires("references", Action.DELETE)])
async def to_trash(reference_id: int, request: Request, db: AsyncSession = Depends(session)) -> None:
    """В корзину: пропадает с витрины и из поиска, 30 дней возвращается."""
    try:
        await service.trash(db, reference_id, _author(request))
    except service.NoSuchReference as missing:
        raise HTTPException(404, str(missing)) from None


@router.post("/{reference_id}/restore", status_code=204, dependencies=[requires("references", Action.DELETE)])
async def restore(reference_id: int, db: AsyncSession = Depends(session)) -> None:
    """Из корзины обратно — целиком, с историей."""
    try:
        await service.restore(db, reference_id)
    except service.NoSuchReference as missing:
        raise HTTPException(404, str(missing)) from None


@router.post(
    "/{reference_id}/erase-forever", status_code=204, dependencies=[requires_function("references", "delete-forever")]
)
async def erase_forever(reference_id: int, body: ReasonIn, request: Request, db: AsyncSession = Depends(session)) -> None:
    """«Удалить насовсем сразу» (US-0499): зашквар, замеченный и после
    согласования, — мимо корзины, отдельным правом и с причиной."""
    try:
        await service.erase_forever(db, reference_id, body.reason, _author(request))
    except service.NoReason as refusal:
        raise HTTPException(422, str(refusal)) from None
    except service.NoSuchReference as missing:
        raise HTTPException(404, str(missing)) from None


@router.delete(
    "/{reference_id}", status_code=204, dependencies=[requires_function("references", "purge-trash")]
)
async def erase(reference_id: int, db: AsyncSession = Depends(session)) -> None:
    """Удалить насовсем — только из корзины и только с функцией очистки
    корзины (решение 0014). Картинки остаются в библиотеке."""
    try:
        await service.erase(db, reference_id)
    except service.NoSuchReference as missing:
        raise HTTPException(404, str(missing)) from None
    except service.NotInTrash as refusal:
        raise HTTPException(409, str(refusal)) from None


def _draft(d) -> DraftOut | None:
    return DraftOut(work=d.work, base_number=d.base_number, updated_at=d.updated_at) if d else None


def _drafter(request: Request) -> str:
    author = _author(request)
    if author is None:
        # Черновик — чей-то; без субъекта записать его некому.
        raise HTTPException(403, "черновик пишется от имени человека — войдите")
    return author


@router.put("/order", status_code=204, dependencies=[requires("references", Action.VIEW)])
async def set_order(body: OrderIn, request: Request, db: AsyncSession = Depends(session)) -> None:
    """Личный порядок витрины (US-0601). Право — просмотр, а не запись:
    раскладка своей витрины не меняет ни одного референса."""
    try:
        await service.set_order(db, _drafter(request), body.ids)
    except service.BadOrder as refusal:
        raise HTTPException(422, str(refusal)) from None


@router.get("/drafts/new", response_model=DraftOut | None)
async def new_draft(request: Request, db: AsyncSession = Depends(session)) -> DraftOut | None:
    """Черновик новой, ещё не сохранённой работы смотрящего (US-0598)."""
    author = _author(request)
    return _draft(await service.draft(db, None, author)) if author else None


@router.put("/drafts/new", status_code=204, dependencies=[requires("references", Action.WRITE)])
async def put_new_draft(body: DraftIn, request: Request, db: AsyncSession = Depends(session)) -> None:
    await service.put_draft(db, None, _drafter(request), body.work, body.base_number)


@router.delete("/drafts/new", status_code=204, dependencies=[requires("references", Action.WRITE)])
async def drop_new_draft(request: Request, db: AsyncSession = Depends(session)) -> None:
    await service.drop_draft(db, None, _drafter(request))


@router.put("/{reference_id}/draft", status_code=204, dependencies=[requires("references", Action.WRITE)])
async def put_draft(
    reference_id: int, body: DraftIn, request: Request, db: AsyncSession = Depends(session)
) -> None:
    """Записать черновик карточки — пишется сам на каждое действие (US-0598)."""
    try:
        await service.put_draft(db, reference_id, _drafter(request), body.work, body.base_number)
    except service.NoSuchReference as missing:
        raise HTTPException(404, str(missing)) from None


@router.delete("/{reference_id}/draft", status_code=204, dependencies=[requires("references", Action.WRITE)])
async def drop_draft(reference_id: int, request: Request, db: AsyncSession = Depends(session)) -> None:
    """Отбросить черновик: на экране снова сохранённая версия."""
    await service.drop_draft(db, reference_id, _drafter(request))


# Объявлен ПОСЛЕ /search: иначе «search» разбирался бы как номер карточки и
# падал бы проверкой типа, а не находил поиск.
@router.get("/{reference_id}", response_model=ReferenceOut)
async def open_card(reference_id: int, request: Request, db: AsyncSession = Depends(session)) -> ReferenceOut:
    """Референс с версиями и работой последней — чтобы открыть его там, где
    сохранили, или на другом компьютере."""
    opened = await service.open_card(db, reference_id)
    if opened is None:
        raise HTTPException(404, "референса с таким номером нет")
    card, versions, fork = opened
    names = await people.names_of(db, [v.author_id for v in versions if v.author_id])
    last = versions[-1]
    return ReferenceOut(
        id=card.id,
        name=card.name,
        colour_model_id=card.colour_model_id,
        forked_from=ForkOut(reference_id=fork.reference_id, number=fork.number, name=fork.name) if fork else None,
        versions=[
            VersionMetaOut(number=v.number, saved_at=v.created_at, author_id=v.author_id,
                           author_name=names.get(v.author_id or ""), auto_reason=v.auto_reason)
            for v in versions
        ],
        number=last.number,
        work=last.work,
        tags=_tags(await service.tags_of(db, card.id)),
        draft=_draft(await service.draft(db, card.id, author)) if (author := _author(request)) else None,
    )


@router.get("/{reference_id}/versions/{number}", response_model=VersionOut)
async def open_version(reference_id: int, number: int, db: AsyncSession = Depends(session)) -> VersionOut:
    """Версия целиком — листание истории открывает её, а не пересказ."""
    v = await service.open_version(db, reference_id, number)
    if v is None:
        raise HTTPException(404, "такой версии у референса нет")
    names = await people.names_of(db, [v.author_id] if v.author_id else [])
    return VersionOut(number=v.number, saved_at=v.created_at, author_id=v.author_id,
                      author_name=names.get(v.author_id or ""), work=v.work)
