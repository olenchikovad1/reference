"""Замер: насколько запрос близок по смыслу к дропу (US-0498).

Отвечает на вопрос «с какого косинуса дроп считать найденным по смыслу». Запросы
и ожидания — из fixtures/reference_search.yaml, записанного до замера;
сокращения раскрываются словарём services/abbreviations.yaml, как в поиске.
Дроп описывается тем же текстом, что в поиске: название, тема, «как его ещё
называют». Печатает косинус каждого запроса к каждому дропу и для каждого
порога — сколько ожидаемых дропов проходит и сколько лишних.

    docker compose -f infra/compose.yaml exec -T api python -m scripts.embeddings.measure_drop_meaning [--centered]
"""

import asyncio
import pathlib

import numpy as np
import yaml

from reference_api.db import session_factory
from reference_api.services import drops as drops_service
from reference_api.services import words

FIX = pathlib.Path("/srv/reference/fixtures")


async def main() -> None:
    queries = yaml.safe_load((FIX / "reference_search.yaml").read_text(encoding="utf-8"))["queries"]
    async with session_factory() as db:
        drops = await drops_service.drops(db)
    names = [d.name for d in drops]
    docs = [drops_service.drop_text(d) for d in drops]
    dv = words.embed(docs)
    dv = dv / np.linalg.norm(dv, axis=1, keepdims=True)
    asked = [drops_service.expand(str(q["q"])) for q in queries]
    qv = words.embed(asked)
    qv = qv / np.linalg.norm(qv, axis=1, keepdims=True)
    # Центровка: пространство модели смещено — все тексты близки друг к другу
    # (0.8–0.97). Вычитаем среднее словаря существительных, как в
    # probe_words_centering, и мерим косинус остатков.
    _, vocab = words.vocabulary(2000, "{}")
    mean = vocab.mean(0)
    norm = lambda x: x / np.linalg.norm(x, axis=-1, keepdims=True)  # noqa: E731
    if "--centered" in __import__("sys").argv:
        dv, qv = norm(dv - mean), norm(qv - mean)
    cos = qv @ dv.T

    print("запрос → косинус к дропам (ожидаемые помечены *)")
    for i, q in enumerate(queries):
        want = set(q["expect_drops"])
        row = sorted(zip(names, cos[i]), key=lambda x: -x[1])
        print(f"  {q['q']!s:12} [{asked[i]}]: " + ", ".join(
            f"{'*' if n in want else ''}{n} {c:.3f}" for n, c in row[:4]))

    print("\nпорог → ожидаемых найдено / лишних")
    for t in np.arange(0.10, 0.71, 0.05):
        hit = miss = extra = 0
        for i, q in enumerate(queries):
            want = set(q["expect_drops"])
            got = {n for n, c in zip(names, cos[i]) if c >= t}
            hit += len(want & got)
            miss += len(want - got)
            extra += len(got - want)
        print(f"  {t:.2f}: найдено {hit}, пропущено {miss}, лишних {extra}")


if __name__ == "__main__":
    asyncio.run(main())
