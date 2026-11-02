"""Витрина читает метаданные, документ работы нужен только открытой карточке."""
import pytest
from sqlalchemy import inspect
import reference_api.models.drops  # noqa: F401 — регистрирует таблицы внешних ключей без запуска приложения

from reference_api.db import engine, session_factory
from reference_api.models.references import Reference, ReferenceVersion
from reference_api.repositories import references as repo
from reference_api.services import references as service


@pytest.mark.asyncio
async def test_showcase_does_not_load_editing_documents():
    assert engine.url.database.endswith("_test"), "проверка допустима только в тестовой базе"
    async with session_factory() as db:
        card = Reference(name="list payload boundary")
        db.add(card)
        await db.flush()
        version = ReferenceVersion(reference_id=card.id, number=1, sheet_digest="a" * 64,
                                   image_digests=[], views={"front": "b" * 64}, work={"large": "x" * 100000})
        db.add(version)
        await db.flush()
        card_id = card.id
        db.expunge_all()
        rows = await service.latest(db)
        listed = next(v for c, v in rows if c.id == card_id)
        assert "work" in inspect(listed).unloaded, "список загрузил полный документ редактирования"
        assert "texts" in inspect(listed).unloaded
        assert listed.views == {"front": "b" * 64}
        db.expunge_all()
        full = await repo.version(db, card_id, 1)
        assert full.work == {"large": "x" * 100000}, "открытие карточки потеряло работу"
        await db.rollback()
    await engine.dispose()
