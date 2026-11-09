"""Контракт приватного сокета CLIP без загрузки модели."""

import numpy as np
import pytest
from fastapi.testclient import TestClient

from reference_api.api.image_encoder import app
from reference_api.services import embeddings


def test_encoder_accepts_the_fixed_tensor_and_returns_a_unit_vector(monkeypatch: pytest.MonkeyPatch) -> None:
    class Encoder:
        def run(self, _outputs: object, inputs: dict[str, np.ndarray]) -> list[np.ndarray]:
            assert inputs["pixel_values"].shape == embeddings.INPUT_SHAPE
            assert inputs["pixel_values"].dtype == np.float32
            return [np.ones(embeddings.DIM, dtype=np.float32)]

    monkeypatch.setattr(app.state, "encoder", Encoder(), raising=False)
    client = TestClient(app)
    headers = {"Content-Type": "application/octet-stream"}
    response = client.post(embeddings.ENCODE_PATH, content=bytes(embeddings.INPUT_BYTES), headers=headers)

    assert response.status_code == 200
    payload = response.json()
    assert payload["model"] == embeddings.MODEL_NAME
    assert len(payload["vector"]) == embeddings.DIM
    np.testing.assert_allclose(np.linalg.norm(payload["vector"]), 1.0, atol=1e-6)

    assert client.post(embeddings.ENCODE_PATH, content=b"x", headers=headers).status_code == 400
    assert client.post(embeddings.ENCODE_PATH, content=bytes(embeddings.INPUT_BYTES + 1),
                       headers=headers).status_code == 413
