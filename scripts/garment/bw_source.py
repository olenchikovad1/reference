#!/usr/bin/env python3
"""Исходник Browzwear VStitcher (.bw): что внутри и как достать файл.

Устройство разобрано 23.09.2026 (решение 0001): .bw — база SQLite с таблицей
`file_tree` (имя, расширение, размер, содержимое, время) и `meta`; содержимое
большинства файлов сжато zstd. Внутри — лекала `garment.vsgx` (формат BWBI,
двоичный), аватары FBX (формат открытый), снимки симуляции `snapshot/*.geo.gcs`
(закрытый), текстуры, размерный ряд `resource/sizeset/*.ssm`.

Где: хост. Нужен zstd — модуль `compression.zstd` есть в Python 3.14, в
3.13 нужен пакет `zstandard`; без него содержимое отдаётся сжатым, и об этом
сказано. Исходник в git не лежит (решение 0002) — путь берётся из описания
изделия, файл кладётся в том руками.

    py scripts/garment/bw_source.py list [КОД_ИЗДЕЛИЯ]
    py scripts/garment/bw_source.py extract ИМЯ_ВНУТРИ ФАЙЛ_НА_ДИСКЕ [КОД_ИЗДЕЛИЯ]
"""

import pathlib
import sqlite3
import sys

import yaml

ROOT = pathlib.Path(__file__).resolve().parents[2]
ZSTD_MAGIC = b"\x28\xb5\x2f\xfd"

try:
    from compression import zstd as _zstd  # Python 3.14+

    def _unzstd(b: bytes) -> bytes:
        return _zstd.decompress(b)
except ImportError:
    try:
        import zstandard as _zs

        def _unzstd(b: bytes) -> bytes:
            return _zs.ZstdDecompressor().decompressobj().decompress(b)
    except ImportError:
        _unzstd = None


def source_path(code: str) -> pathlib.Path:
    product = yaml.safe_load((ROOT / f"infra/stand/fixtures/{code}.yaml").read_text(encoding="utf-8"))
    path = ROOT / "infra/stand/files" / product["source"]["path"]
    if not path.is_file():
        sys.exit(f"нет исходника {path}. Он вне git (решение 0002): положить файл из VStitcher по этому пути")
    return path


def connect(code: str) -> sqlite3.Connection:
    # immutable: файл только читается, и SQLite не пытается создать журнал рядом.
    return sqlite3.connect(f"file:{source_path(code).as_posix()}?mode=ro&immutable=1", uri=True)


def blob(con: sqlite3.Connection, name: str) -> bytes:
    """Содержимое файла из исходника, распакованное, если сжато и есть чем."""
    row = con.execute("select content from file_tree where filename=?", (name,)).fetchone()
    if row is None:
        sys.exit(f"внутри нет файла {name!r}; список — команда list")
    data = row[0]
    if data[:4] == ZSTD_MAGIC:
        if _unzstd is None:
            print("внимание: zstd недоступен (Python 3.14 или pip install zstandard) — отдаю сжатым", file=sys.stderr)
            return data
        return _unzstd(data)
    return data


def list_contents(con: sqlite3.Connection) -> None:
    for k, v in con.execute("select key, value from meta"):
        print(f"meta {k} = {str(v)[:200]}")
    n, total = con.execute("select count(*), sum(file_size) from file_tree").fetchone()
    print(f"файлов {n}, {total / 1e6:.0f} МБ")
    for ext, cnt, size in con.execute(
            "select ext, count(*), sum(file_size) from file_tree group by ext order by 3 desc"):
        print(f"  {str(ext):8} {cnt:5} шт  {size / 1e6:8.1f} МБ")
    print("не картинки:")
    for name, size in con.execute(
            "select filename, file_size from file_tree where ext not in ('.jpg', '.png') order by filename"):
        print(f"  {size:12}  {name}")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "list"
    if cmd == "list":
        list_contents(connect(sys.argv[2] if len(sys.argv) > 2 else "B-HDY-14"))
    elif cmd == "extract" and len(sys.argv) >= 4:
        con = connect(sys.argv[4] if len(sys.argv) > 4 else "B-HDY-14")
        pathlib.Path(sys.argv[3]).write_bytes(blob(con, sys.argv[2]))
        print(f"{sys.argv[2]} → {sys.argv[3]}")
    else:
        sys.exit(__doc__)
