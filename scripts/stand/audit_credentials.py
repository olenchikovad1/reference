"""Проверка типа служебных ключей без раскрытия их значений.

В API-контейнере: python -m scripts.stand.audit_credentials.
На машине приложения: python audit_credentials.py --root /opt/reference.
Проверяется личный формат pfb_ в окружении и текстовых файлах приложения;
значения, строки совпадений и ключи в отчёт не попадают.
"""

import argparse
import asyncio
import hashlib
import json
import os
from pathlib import Path
import re


PERSONAL_KEY = re.compile(r"pfb_[A-Za-z0-9_-]{20,}")
KEY_NAMES = ("PLATFORM_CREDENTIAL", "PLM_MACHINE_KEY", "PLM_REFERENCE_MACHINE_KEY")


def audit(root: Path | None) -> dict:
    credentials = {}
    for name in KEY_NAMES:
        value = os.environ.get(name, "")
        kind = "absent"
        if value:
            kind = "personal_bot" if PERSONAL_KEY.search(value) else "application" if value.startswith("pfc_") else "machine_key"
        credentials[name] = {"kind": kind, "fingerprint": hashlib.sha256(value.encode()).hexdigest()[:16] if value else None}
    findings = [{"environment_variable": name} for name, value in os.environ.items() if PERSONAL_KEY.search(value)]
    checked = 0
    if root:
        root = root.resolve(strict=True)
        for path in root.rglob("*"):
            if not path.is_file() or path.is_symlink():
                continue
            if path.suffix.lower() not in (".env", ".yaml", ".yml", ".toml", ".json", ".sh", ".py") and path.name != ".env":
                continue
            if path.stat().st_size > 2_000_000:
                continue
            checked += 1
            if PERSONAL_KEY.search(path.read_text(encoding="utf-8", errors="replace")):
                findings.append({"file": path.relative_to(root).as_posix()})
    return {"credentials": credentials, "personal_bot_findings": findings, "text_files_checked": checked}


async def probe_access(image_key: str | None) -> dict:
    """Проверяются служебные каналы; токены и ответы с секретами не печатаются."""
    import httpx
    from reference_api.config import settings

    cfg = settings()
    result = {}
    calls = [
        ("platform_people", f"{cfg.platform_core_url}/applications/reference/people", cfg.platform_credential),
        ("plm_drops", f"{cfg.plm_base_url}/api/machine/drops", cfg.plm_machine_key),
    ]
    if image_key:
        calls.append(("plm_image", f"{cfg.plm_base_url}/api/machine/images/{image_key}/preview", cfg.plm_machine_key))
    async with httpx.AsyncClient(timeout=10) as client:
        for name, url, credential in calls:
            response = await client.get(url, headers={"Authorization": f"Bearer {credential or ''}"})
            result[name] = {"status": response.status_code}
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path)
    parser.add_argument("--probe", action="store_true")
    parser.add_argument("--image-key")
    args = parser.parse_args()
    report = audit(args.root)
    if args.probe:
        report["service_access"] = asyncio.run(probe_access(args.image_key))
    print(json.dumps(report, ensure_ascii=False, indent=2))
