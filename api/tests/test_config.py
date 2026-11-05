"""Стенд без платформы — только стенд (план 120, US-0882).

WITHOUT_PLATFORM даёт запросу без токена все гранты манифеста (решение 0006).
Включённый в бою, он открыл бы всё всем, мимо входа платформы. Бой узнаётся по
ядру: на стенде оно локальное (http), в бою — публичный адрес по https.
"""

import pytest
from pydantic import ValidationError

from reference_api.config import Settings

BASE = {
    "database_url": "postgresql+asyncpg://u:p@db/x", "s3_endpoint": "http://s3", "s3_bucket": "b",
    "s3_access_key": "k", "s3_secret_key": "s", "files_volume_path": "/f", "fixtures_path": "/x",
    "embedding_model_path": "/m",
}


def test_stand_mode_with_the_public_platform_refuses_to_start() -> None:
    with pytest.raises(ValidationError, match="стенд без платформы"):
        Settings(**BASE, without_platform=True,
                 platform_core_url="https://platform.toribrands.ru/platform/api/core", _env_file=None)


def test_stand_mode_with_a_local_platform_is_allowed() -> None:
    s = Settings(**BASE, without_platform=True,
                 platform_core_url="http://host.docker.internal:8100/platform/api/core", _env_file=None)
    assert s.without_platform


def test_production_without_stand_mode_starts() -> None:
    s = Settings(**BASE, without_platform=False,
                 platform_core_url="https://platform.toribrands.ru/platform/api/core", _env_file=None)
    assert not s.without_platform


@pytest.mark.parametrize("field", ["platform_credential", "plm_machine_key"])
def test_personal_bot_key_is_refused_in_production_service_settings(field: str) -> None:
    personal = "pfb_test_personal_token_never_deploy_this"
    with pytest.raises(ValidationError, match="личный MCP") as refused:
        Settings(**BASE, without_platform=False, platform_core_url="https://platform.toribrands.ru/platform/api/core",
                 **{field: personal}, _env_file=None)
    assert personal not in str(refused.value)


def test_personal_key_can_remain_in_local_environment() -> None:
    settings = Settings(**BASE, platform_core_url="http://localhost:8100/platform/api/core",
                        platform_credential="pfb_local_test_only", _env_file=None)
    assert settings.platform_credential == "pfb_local_test_only"


def test_service_credentials_are_not_in_settings_repr() -> None:
    credential = "pfc_test_application_credential_only"
    machine = "test_reference_to_plm_service_key"
    settings = Settings(**BASE, platform_credential=credential, plm_machine_key=machine, _env_file=None)
    assert credential not in repr(settings)
    assert machine not in repr(settings)
