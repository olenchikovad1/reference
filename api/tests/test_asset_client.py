"""Первый поток миниатюр не должен создавать отдельный S3-клиент на картинку."""

from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
import time

from reference_api.repositories import assets


def test_cold_parallel_reads_share_one_storage_client(monkeypatch):
    monkeypatch.setattr(assets, "_client", None)
    started = Barrier(8)
    created = []

    def create_client(*args, **kwargs):
        # Окно гонки воспроизводится без настоящего S3 или сетевой задержки.
        time.sleep(0.05)
        result = object()
        created.append(result)
        return result

    monkeypatch.setattr(assets.boto3, "client", create_client)

    def read(_):
        started.wait(timeout=2)
        return assets.client()

    with ThreadPoolExecutor(max_workers=8) as workers:
        clients = list(workers.map(read, range(8)))
    assert len(created) == 1, "холодные запросы одновременно создают клиентов S3"
    assert all(client is clients[0] for client in clients)
