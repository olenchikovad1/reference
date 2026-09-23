"""Файлы: вход по HTTP."""

from fastapi import APIRouter, HTTPException, Response, UploadFile

from reference_api.schemas.assets import AssetOut, DerivativeOut
from reference_api.services import assets as service

router = APIRouter(prefix="/assets", tags=["assets"])


@router.post("", response_model=list[AssetOut])
async def upload(files: list[UploadFile]) -> list[AssetOut]:
    """Несколько файлов одной операцией.

    По одному — та же работа, ради устранения которой всё затевалось: перебрать
    десяток заготовок должно стоить одного перетаскивания.
    """
    out: list[AssetOut] = []
    for f in files:
        content = await f.read()
        try:
            stored = service.store(content, f.filename or "без имени")
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
