"""Файлы и их ступени: правила предметной области.

Имена ступеней и правила взяты у сервиса файлов платформы буква в букву:
`thumb` 200, `preview` 1200, плюс оригинал. Это не совпадение и не вкус — когда
вход платформы появится, переезд должен быть правкой репозитория, а не
переучиванием всего, что на эти имена оперлось.

Почему пока не через платформу — решение 0009.
"""

import hashlib
import io
from dataclasses import dataclass, field

from PIL import Image

# Ступени. Имя неизвестно — отказ, а не «подберём похожее»: произвольные
# размеры засоряют кеш и делают невозможным сравнение версий по содержимому.
PRESETS: dict[str, int] = {"thumb": 200, "preview": 1200}

# Формат исходника сохраняется там, где он пригоден для показа: так прозрачность
# переживает уменьшение сама собой, без единой строки про альфа-канал. У принтов
# прозрачные поля несут геометрию, и сведённый в JPEG элемент непригоден.
KEEPS_ITS_FORMAT = {"image/png", "image/jpeg", "image/webp", "image/gif"}


class UnknownPreset(Exception):
    """Такой ступени нет. Отказ, а не подбор похожего."""


class NotAnImage(Exception):
    """Содержимое не опознано как изображение."""


@dataclass(frozen=True)
class Derivative:
    """Ступень: её содержимое и ФАКТИЧЕСКИЕ размеры.

    Размеры возвращаются измеренными, а не заявленными: при вписывании в квадрат
    длинная сторона равна пресету, а короткая — нет, и угадывать её нельзя. По
    этим числам считается перевод сантиметров в пиксели, а из него — размер
    печати на фабрику.
    """

    name: str
    content: bytes
    content_type: str
    width: int
    height: int
    #: Ступень оказалась копией оригинала, потому что он мельче.
    is_copy: bool


def digest(content: bytes) -> str:
    """Имя по содержимому: один и тот же файл не хранится дважды."""
    return hashlib.sha256(content).hexdigest()


def kind_of(content: bytes) -> str:
    """Опознание по первым байтам. Расширению верить нельзя."""
    if content[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if content[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if content[:4] == b"RIFF" and content[8:12] == b"WEBP":
        return "image/webp"
    if content[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    raise NotAnImage(content[:8].hex())


def derive(content: bytes, preset: str) -> Derivative:
    """Одна ступень исходника.

    Никакой обработки сверх вписывания: ни поворота по EXIF, ни автокропа, ни
    шарпинга и — отдельно важно — никакой обрезки прозрачных полей. По ним
    считается позиция элемента, и триммер тихо ломает размещение всех
    референсов, где элемент использован. Он же портит векторы похожести:
    ступень `preview` служит входом модели.
    """
    if preset not in PRESETS:
        raise UnknownPreset(preset)
    content_type = kind_of(content)
    side = PRESETS[preset]

    with Image.open(io.BytesIO(content)) as img:
        width, height = img.size
        # Ступень крупнее исходника не делается: растягивание портит картинку и
        # врёт о разрешении. Средняя у мелкого исходника — копия оригинала.
        if max(width, height) <= side:
            return Derivative(preset, content, content_type, width, height, True)
        img.thumbnail((side, side))
        out = io.BytesIO()
        fmt = img.format or ("PNG" if content_type == "image/png" else "JPEG")
        if content_type not in KEEPS_ITS_FORMAT:
            fmt = "PNG"
        img.save(out, format=fmt)
        return Derivative(preset, out.getvalue(), content_type, img.width, img.height, False)


class AssetMissing(Exception):
    """Такого файла в хранилище нет."""


@dataclass(frozen=True)
class Stored:
    digest: str
    name: str
    content_type: str
    width: int
    height: int
    derivatives: list[Derivative] = field(default_factory=list)
    #: Файл уже лежал и второй раз места не занял.
    reused: bool = False


def store(content: bytes, name: str) -> Stored:
    """Кладёт файл и его ступени.

    Дедупликация по содержимому: тот же файл, брошенный дважды, не занимает
    место дважды и не пересчитывает ступени. Хеш ловит ТОТ ЖЕ файл; ту же
    картинку, пересохранённую или перекрашенную, ловит вектор (US-0431) — это
    разные сети, и вторая нужна потому, что первая пропускает.
    """
    from reference_api.repositories import assets as repo

    content_type = kind_of(content)
    key = digest(content)
    with Image.open(io.BytesIO(content)) as img:
        width, height = img.size

    if repo.exists(key, "original"):
        made = []
        for preset in PRESETS:
            got = repo.get(key, preset)
            if got is None:
                continue
            _, ct, meta = got
            made.append(
                Derivative(
                    preset,
                    b"",
                    ct,
                    int(meta.get("width", 0)),
                    int(meta.get("height", 0)),
                    meta.get("is_copy") == "1",
                )
            )
        return Stored(key, name, content_type, width, height, made, reused=True)

    # Оригинал кладётся, но наружу не отдаётся: он нужен только на выгрузке
    # техпакета, а в браузер не уходит никогда.
    repo.put(key, "original", content, content_type, {"width": str(width), "height": str(height), "name": name})
    made = []
    for preset in PRESETS:
        d = derive(content, preset)
        repo.put(
            key,
            preset,
            d.content,
            d.content_type,
            {"width": str(d.width), "height": str(d.height), "is_copy": "1" if d.is_copy else "0"},
        )
        made.append(d)
    return Stored(key, name, content_type, width, height, made, reused=False)


def fetch(key: str, preset: str) -> tuple[bytes, str]:
    """Ступень из хранилища. Оригинал через этот путь не отдаётся."""
    from reference_api.repositories import assets as repo

    if preset not in PRESETS:
        raise UnknownPreset(preset)
    got = repo.get(key, preset)
    if got is None:
        raise AssetMissing(key)
    return got[0], got[1]
