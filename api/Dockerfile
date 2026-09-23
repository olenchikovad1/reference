# Основа зафиксирована: подвижный ярлык означает разное сегодня и через месяц.
FROM python:3.13-slim

# uv ставится из своего образа, а не скачивается скриптом: скачивание в сборке
# делает образ невоспроизводимым и требует сети на каждой пересборке.
COPY --from=ghcr.io/astral-sh/uv:0.5.11 /uv /usr/local/bin/uv

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

# Зависимости ставятся до копирования кода: правка модуля не должна пересобирать
# слой с пакетами.
COPY pyproject.toml ./
# Инструменты прогона ставятся в тот же образ. Стенд целиком в докере, и второе,
# локальное окружение ради pytest означало бы второй способ всё запускать.
RUN uv pip install --system --no-cache -r pyproject.toml && \
    uv pip install --system --no-cache pytest pytest-asyncio httpx

COPY alembic.ini ./
COPY alembic ./alembic
COPY reference_api ./reference_api

# Процесс работает не от суперпользователя.
RUN useradd --create-home --uid 10001 app && chown -R app:app /app
USER app

EXPOSE 8000
CMD ["uvicorn", "reference_api.app:app", "--host", "0.0.0.0", "--port", "8000"]
