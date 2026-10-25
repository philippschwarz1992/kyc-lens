# Stateless analysis container for Cloudflare Containers. Build from services/analysis:
#   docker build -t kyc-lens-analysis .
FROM python:3.12-slim

COPY --from=ghcr.io/astral-sh/uv:0.13.5 /uv /usr/local/bin/uv

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    PATH=/opt/venv/bin:$PATH \
    MODELS_DIR=/app/models

WORKDIR /app

COPY pyproject.toml uv.lock .python-version ./
RUN uv sync --frozen --no-dev --no-install-project --python /usr/local/bin/python3.12

# Models are fetched at build time and checked against pinned SHA-256 hashes; the container never downloads at runtime.
COPY scripts/fetch_models.py scripts/
RUN python scripts/fetch_models.py /app/models \
    && mkdir -p /usr/share/licenses/kyc-lens-analysis \
    && cp /app/models/licenses/* /app/models/manifest.json /usr/share/licenses/kyc-lens-analysis/

COPY app app
COPY NOTICE.md /usr/share/licenses/kyc-lens-analysis/

# No writable state is needed: run as an unprivileged user.
RUN useradd --uid 10001 --no-create-home --shell /usr/sbin/nologin analysis
USER analysis

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/health', timeout=4)"
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080", "--no-server-header"]
