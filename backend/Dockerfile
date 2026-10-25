# Sentiora backend image (API, RQ worker, and migrations share it).
# Multi-stage: dependencies are built in a throwaway stage; the runtime image
# runs as a non-root user and contains no tests or dev tooling.

FROM python:3.12-slim AS builder

ENV PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /build
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

COPY pyproject.toml ./
COPY app ./app
RUN pip install .


FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/opt/venv/bin:$PATH"

RUN groupadd --system --gid 10001 sentiora \
    && useradd --system --uid 10001 --gid sentiora --home-dir /app --shell /usr/sbin/nologin sentiora

WORKDIR /app/backend
COPY --from=builder /opt/venv /opt/venv
COPY --chown=sentiora:sentiora app ./app
COPY --chown=sentiora:sentiora alembic ./alembic
COPY --chown=sentiora:sentiora alembic.ini ./alembic.ini

USER sentiora
EXPOSE 8000

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=4).status == 200 else 1)"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
