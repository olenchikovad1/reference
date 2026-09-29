"""Согласование: статусы и чей ход (план 075, US-0510).

Статус — у референса: черновик → на согласовании → на доработке →
согласован → окончательно принят. Переход делает только положенная роль в
согласовании (решение 0016): отправляет исполнитель, возвращает и принимает
редактор или главный редактор, окончательно принимает главный редактор.

Чей ход — вычисляется из статуса и ролей, отдельным полем не хранится (И-8):
на согласовании — у всех редакторов, кто первым решил — тот и решил, у
остальных задача уходит сама, потому что сменился статус; на доработке — у
исполнителя; согласованный — у главных редакторов.
"""

import asyncio
import hashlib
import logging
from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from reference_api import broker
from reference_api.db import session_factory
from reference_api.repositories import assets as asset_repo
from reference_api.repositories import people as people_repo
from reference_api.repositories import references as cards
from reference_api.repositories import review as repo
from reference_api.services import bell

STATUS_NAMES = {
    "draft": "черновик",
    "review": "на согласовании",
    "rework": "на доработке",
    "approved": "согласован",
    "final": "окончательно принят",
    "rejected": "забракован",
}

#: Переход: из каких статусов, в какой, какой роли. «executor» — исполнитель
#: этого референса, остальное — роль в таблице ролей. Решения владельца
#: 29.09 (план 094): забраковать — редактор и главный; забракованный —
#: конечный, вернуть в работу может только главный.
STEPS = {
    "submit": ({"draft", "rework"}, "review", {"executor"}),
    # Отозвать отправленное, пока никто не решил: не та версия ушла.
    "recall": ({"review"}, "draft", {"executor"}),
    "return": ({"review"}, "rework", {"editor", "chief"}),
    # Понравилось как есть — согласовать, не дожидаясь отправки (план 095).
    "approve": ({"draft", "review", "rework"}, "approved", {"editor", "chief"}),
    # Согласовали по ошибке — обратно на согласование, с причиной.
    "unapprove": ({"approved"}, "review", {"editor", "chief"}),
    # Главный принимает окончательно сразу, из любого живого состояния.
    "approve-final": ({"draft", "review", "rework", "approved"}, "final", {"chief"}),
    "reject": ({"draft", "review", "rework", "approved"}, "rejected", {"editor", "chief"}),
    "revive": ({"rejected"}, "draft", {"chief"}),
}

#: Шаги, у которых причина обязательна, — и как о ней спросить.
NEEDS_COMMENT = {
    "return": "вернуть на доработку можно только с замечанием",
    "unapprove": "отменить согласование можно только с причиной",
    "reject": "забраковать можно только с причиной — дизайнер должен понять почему",
    "revive": "вернуть в работу можно только с причиной",
}


class WrongStatus(ValueError):
    """Из этого статуса такого перехода нет — 409."""


class NotYourStep(PermissionError):
    """Переход не для этой роли — 403."""


class NoComment(ValueError):
    """Вернуть без замечания нельзя — 422."""


class NoSuchReference(LookupError):
    pass


async def _roles(db: AsyncSession, card, who: str | None) -> set[str]:
    out = set()
    if who and who == card.executor_id:
        out.add("executor")
    person = await people_repo.app_person(db, who) if who else None
    if person:
        out.add(person.role)
    return out


async def can(db: AsyncSession, card, who: str | None) -> list[str]:
    """Что смотрящему доступно сейчас: переходы — по статусу и ролям, и
    «remark» — ставить замечания (редактор и главный, US-0511)."""
    roles = await _roles(db, card, who)
    out = [s for s, (src, _, need) in STEPS.items() if card.status in src and roles & need]
    return out + (["remark"] if roles & {"editor", "chief"} else [])


async def can_say(db: AsyncSession, card, row, who: str | None) -> list[str]:
    """Что смотрящему можно сказать в ветке этого замечания — кнопки окна."""
    roles = await _roles(db, card, who)
    reviewer = bool(roles & {"editor", "chief"}) or (who is not None and who == row.author_id)
    out = ["reply"] if roles else []
    if "executor" in roles and row.status == "open":
        out.append("fixed")
    if reviewer and row.status == "fixed":
        out += ["accepted", "rejected"]
    return out


async def step(db: AsyncSession, reference_id: int, action: str, who: str | None, comment: str | None = None) -> None:
    card = await cards.get(db, reference_id)
    if card is None:
        raise NoSuchReference("референса с таким номером нет")
    src, to, need = STEPS[action]
    if card.status not in src:
        raise WrongStatus(f"из статуса «{STATUS_NAMES[card.status]}» так нельзя")
    if not (await _roles(db, card, who)) & need:
        raise NotYourStep("этот шаг — не для вашей роли в согласовании")
    text = " ".join((comment or "").split()) or None
    if action in NEEDS_COMMENT and not text:
        raise NoComment(NEEDS_COMMENT[action])
    number = await repo.last_number(db, reference_id)
    await repo.move(db, reference_id, to, number, who, text)
    await _ring(db, card, action, number, who, text)


async def _ring(db: AsyncSession, card, action: str, number: int, who: str | None, comment: str | None) -> None:
    """Колокол платформы (US-0513): пришло на согласование — редакторам,
    вернули — исполнителю. Себе не звонят."""
    link = f"/reference/references/{card.id}"
    if action == "submit":
        editors = [p.subject_id for p in await people_repo.app_people(db) if p.role in {"editor", "chief"}]
        bell.ring([p for p in editors if p != who], f"reference:{card.id}:review:v{number}",
                  f"Референс №{card.id} ждёт согласования", card.name, link)
    elif action == "return" and card.executor_id and card.executor_id != who:
        bell.ring([card.executor_id], f"reference:{card.id}:rework:v{number}",
                  f"Референс №{card.id} вернули на доработку", comment or "", link)
    elif action == "reject" and card.executor_id and card.executor_id != who:
        bell.ring([card.executor_id], f"reference:{card.id}:rejected:v{number}",
                  f"Референс №{card.id} забракован", comment or "", link)


async def after_new_version(db: AsyncSession, reference_id: int, number: int, who: str | None) -> None:
    """Правка согласованного — новая версия, и статус уходит в черновик:
    утверждено было одно, правится другое."""
    card = await cards.get(db, reference_id)
    if card is not None and card.status in {"approved", "final"}:
        await repo.move(db, reference_id, "draft", number, who, "правка согласованного")


@dataclass(frozen=True)
class Task:
    id: int
    name: str
    status: str
    reason: str


async def tasks(db: AsyncSession, who: str | None) -> tuple[list[Task], list[Task]]:
    """«Мои задачи» — вычислением из статусов и ролей (И-8): что ждёт именно
    меня, и что я отдал и жду от других."""
    person = await people_repo.app_person(db, who) if who else None
    role = person.role if person else None
    live = await repo.in_statuses(db, ["review", "rework", "approved"])
    returns = await repo.last_returns(db, [c.id for c in live if c.status == "rework"])
    open_remarks = await repo.open_counts(db, [c.id for c in live if c.status == "rework"])
    mine, waiting = [], []
    for c in live:
        if c.status == "review" and role in {"editor", "chief"}:
            mine.append(Task(c.id, c.name, c.status, "на согласовании"))
        elif c.status == "rework" and c.executor_id == who:
            e, n = returns.get(c.id), open_remarks.get(c.id, 0)
            head = f"вернули с {n} {_remarks_word(n)}" if n else "вернули"
            mine.append(Task(c.id, c.name, c.status, f"{head}: «{e.comment}»" if e and e.comment else head))
        elif c.status == "approved" and role == "chief":
            mine.append(Task(c.id, c.name, c.status, "согласован — ждёт окончательного принятия"))
        elif c.executor_id == who and c.status in {"review", "approved"}:
            waiting.append(Task(c.id, c.name, c.status,
                                "ждёт согласования" if c.status == "review" else "ждёт окончательного принятия"))
    return mine, waiting


async def events(db: AsyncSession, reference_id: int):
    return await repo.events(db, reference_id)


def _remarks_word(n: int) -> str:
    """«с 1 замечанием», «с 2 замечаниями» — творительный падеж."""
    return "замечанием" if n % 10 == 1 and n % 100 != 11 else "замечаниями"


# --- Замечания (US-0511) -------------------------------------------------

#: Открытые первыми: редактор видит их сразу, даже если референс отправили
#: с открытыми.
_ORDER = {"open": 0, "fixed": 1, "accepted": 2}


class BadRemark(ValueError):
    """Пустой текст, точка вне кадра, неизвестный вид сообщения — 422."""


async def add_remark(db: AsyncSession, reference_id: int, who: str | None, side: str, x: float, y: float,
                     text: str, element_id: str | None = None):
    """Замечание ставит редактор или главный редактор — нажатием на слой или
    на место изделия. Принадлежит последней версии."""
    body = " ".join((text or "").split())
    if not body:
        raise BadRemark("нужен текст замечания и точка на изделии")
    number, name = await _placed(db, reference_id, who, x, y, element_id)
    return await repo.add_remark(db, reference_id=reference_id, number=number, side=side, element_id=element_id,
                                 element_name=name, x=x, y=y, text=body, author_id=who, status="open")


async def _placed(db: AsyncSession, reference_id: int, who: str | None, x: float, y: float,
                  element_id: str | None) -> tuple[int, str | None]:
    """Общее у написанного и сказанного замечания: кто вправе, где точка,
    на какой версии и на каком слое."""
    card = await cards.get(db, reference_id)
    if card is None:
        raise NoSuchReference("референса с таким номером нет")
    if not (await _roles(db, card, who)) & {"editor", "chief"}:
        raise NotYourStep("замечания ставит редактор")
    if not (0 <= x <= 1 and 0 <= y <= 1):
        raise BadRemark("нужен текст замечания и точка на изделии")
    number = await repo.last_number(db, reference_id)
    name = None
    if element_id:
        version = await cards.version(db, reference_id, number)
        work = (version.work or {}) if version else {}
        elements = (work.get("composition") or {}).get("elements") or []
        el = next((e for e in elements if e.get("id") == element_id), None)
        if el:
            name = el.get("name") or (f"«{el.get('text')}»" if el.get("text") else None)
    return number, name


async def say(db: AsyncSession, reference_id: int, remark_id: int, who: str | None, kind: str, text: str | None) -> None:
    """Сообщение в ветку. Ответить может любой с ролью; «исправлено» —
    исполнитель; «принято» и «нет, не то» — автор замечания или редактор."""
    card = await cards.get(db, reference_id)
    row = await repo.remark(db, remark_id)
    if card is None or row is None or row.reference_id != reference_id:
        raise NoSuchReference("такого замечания нет")
    roles = await _roles(db, card, who)
    body = " ".join((text or "").split()) or None
    number = await repo.last_number(db, reference_id)
    reviewer = bool(roles & {"editor", "chief"}) or (who is not None and who == row.author_id)
    if kind == "reply":
        if not roles:
            raise NotYourStep("ответить может участник согласования")
        if not body:
            raise BadRemark("пустой ответ")
        await repo.say(db, remark_id, kind, body, who, number)
    elif kind == "fixed":
        if "executor" not in roles:
            raise NotYourStep("«исправлено» отмечает исполнитель")
        if row.status != "open":
            raise WrongStatus("отметить «исправлено» можно у открытого замечания")
        await repo.say(db, remark_id, kind, body, who, number, status="fixed", fixed_in=number)
    elif kind in {"accepted", "rejected"}:
        if not reviewer:
            raise NotYourStep("принимает исправление автор замечания или редактор")
        if row.status != "fixed":
            raise WrongStatus("принять или отклонить можно исправленное")
        if kind == "accepted":
            await repo.say(db, remark_id, kind, body, who, number, status="accepted")
        else:
            await repo.say(db, remark_id, kind, body, who, number, status="open", fixed_in=None)
    else:
        raise BadRemark(f"вида сообщения «{kind}» нет")


async def remarks(db: AsyncSession, reference_id: int):
    rows = sorted(await repo.remarks_of(db, reference_id), key=lambda r: (_ORDER[r.status], r.id))
    return rows, await repo.messages_of(db, [r.id for r in rows])


async def card_of(db: AsyncSession, reference_id: int):
    return await cards.get(db, reference_id)


# --- Голос (US-0512, решение 0017) -----------------------------------------

log = logging.getLogger("reference.voice")

#: Очередь расшифровки. В сообщении — только номер замечания: состояние
#: читается в момент работы, а не берётся копией из очереди.
VOICE_QUEUE = "reference.remark-voice"
#: Попыток на сбой среды (модель, хранилище); ошибка в самой записи не
#: повторяется — от повтора она не исправится.
VOICE_ATTEMPTS = 3
#: Запись — минута-другая речи; 10 МБ webm/opus — это час.
MAX_AUDIO_BYTES = 10 * 1024 * 1024
AUDIO_TYPES = {"audio/webm", "audio/ogg", "audio/wav", "audio/x-wav", "audio/wave", "audio/mp4", "audio/mpeg"}


async def add_voice_remark(db: AsyncSession, reference_id: int, who: str | None, side: str, x: float, y: float,
                           audio: bytes, content_type: str | None, element_id: str | None = None):
    """Замечание голосом: аудио сохраняется сразу и остаётся первоисточником,
    расшифровка — в фоне. Не дошло до брокера — не беда: при старте
    недошедшие ставятся заново, аудио уже лежит."""
    number, name = await _placed(db, reference_id, who, x, y, element_id)
    kind = (content_type or "").split(";")[0].strip().lower()
    if not audio or kind not in AUDIO_TYPES:
        raise BadRemark("нужна запись голоса: webm, ogg, wav, mp4 или mp3")
    if len(audio) > MAX_AUDIO_BYTES:
        raise BadRemark("запись больше 10 МБ — наговорите замечание короче или разбейте на два")
    digest = hashlib.sha256(audio).hexdigest()
    await asyncio.to_thread(asset_repo.put, digest, "audio", audio, kind, {})
    row = await repo.add_remark(db, reference_id=reference_id, number=number, side=side, element_id=element_id,
                                element_name=name, x=x, y=y, text="", author_id=who, status="open",
                                audio_digest=digest, audio_type=kind, voice_status="pending")
    await broker.publish(VOICE_QUEUE, {"remark_id": row.id})
    return row


async def hear(remark_id: int, transcribe=None) -> tuple[str, int]:
    """Расшифровать одно замечание. Исход: done, failed, retry (сбой среды,
    попытки ещё есть) или skip (уже взято или сделано). Сам ничего не
    бросает: сообщение из очереди подтверждается после этой функции."""
    from reference_api.services import voice

    transcribe = transcribe or voice.transcribe
    async with session_factory() as db:
        claimed = await repo.claim_voice(db, remark_id)
    if claimed is None:
        return "skip", 0
    digest, attempts = claimed
    async with session_factory() as db:
        try:
            got = await asyncio.to_thread(asset_repo.get, digest, "audio")
            if got is None:
                raise voice.Unheard("записи нет в хранилище")
            text, seconds = await asyncio.to_thread(transcribe, got[0])
            if not text.strip():
                raise voice.Unheard("в записи не расслышано ни слова")
        except voice.Unheard as e:
            await repo.voice_state(db, remark_id, "failed", str(e)[:500])
            return "failed", attempts
        except Exception as e:  # сбой среды: модель, хранилище, память
            log.warning("расшифровка замечания %s, попытка %s: %s", remark_id, attempts, e)
            if attempts >= VOICE_ATTEMPTS:
                await repo.voice_state(db, remark_id, "failed", f"не удалось за {attempts} попытки: {e}"[:500])
                return "failed", attempts
            await repo.voice_state(db, remark_id, "pending", str(e)[:500])
            return "retry", attempts
        await repo.voice_done(db, remark_id, " ".join(text.split()), seconds)
    return "done", attempts


async def resume_voice() -> int:
    """При старте: недошедшие расшифровки — снова в очередь."""
    async with session_factory() as db:
        ids = await repo.voice_waiting(db)
    for i in ids:
        await broker.publish(VOICE_QUEUE, {"remark_id": i})
    if ids:
        log.info("в очередь расшифровки заново: %s", len(ids))
    return len(ids)


async def audio_of(db: AsyncSession, reference_id: int, remark_id: int) -> tuple[bytes, str]:
    row = await repo.remark(db, remark_id)
    if row is None or row.reference_id != reference_id or not row.audio_digest:
        raise NoSuchReference("записи у этого замечания нет")
    got = await asyncio.to_thread(asset_repo.get, row.audio_digest, "audio")
    if got is None:
        raise NoSuchReference("записи нет в хранилище")
    return got[0], row.audio_type or got[1]


async def edit_text(db: AsyncSession, reference_id: int, remark_id: int, who: str | None, text: str) -> None:
    """Автор правит текст своего замечания; аудио и расшифровка «как
    услышано» не меняются."""
    row = await repo.remark(db, remark_id)
    if row is None or row.reference_id != reference_id:
        raise NoSuchReference("такого замечания нет")
    if who is None or who != row.author_id:
        raise NotYourStep("текст замечания правит его автор")
    body = " ".join((text or "").split())
    if not body:
        raise BadRemark("пустой текст")
    await repo.set_text(db, remark_id, body)
