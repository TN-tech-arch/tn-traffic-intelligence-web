FROM node:24-bookworm-slim AS frontend

WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend ./
RUN npm run build


FROM python:3.12-slim AS runtime

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONPATH=/app/backend \
    TN_WEB_MODE=1 \
    TN_HOST=0.0.0.0 \
    TN_PORT=7860 \
    TN_SESSIONS_DIR=/tmp/tn-sessions \
    TN_DATA_DIR=/tmp/tn-sessions/base/data \
    TN_DB_PATH=/tmp/tn-sessions/base/data/tn_traffic.db \
    TN_RAW_DIR=/app/data/raw \
    TN_MODEL_CACHE=/tmp/tn-model-cache \
    HF_HOME=/tmp/tn-model-cache/hf \
    HF_ENDPOINT=https://huggingface.co \
    TN_COOKIE_SECURE=1

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl libgomp1 \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --index-url https://download.pytorch.org/whl/cpu torch==2.14.1
COPY requirements-web.txt ./
RUN pip install -r requirements-web.txt

COPY backend ./backend
COPY scripts ./scripts
COPY data/raw ./data/raw
COPY --from=frontend /frontend/dist ./frontend/dist
COPY start_hf.sh ./

RUN chmod +x /app/start_hf.sh \
    && mkdir -p /tmp/tn-sessions /tmp/tn-model-cache

EXPOSE 7860
CMD ["/app/start_hf.sh"]
