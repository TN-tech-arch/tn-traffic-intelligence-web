#!/bin/sh
set -eu

export PYTHONPATH=/app/backend
export TN_WEB_MODE=1
export TN_HOST=0.0.0.0
export TN_PORT="${PORT:-7860}"
export TN_SESSIONS_DIR="${TN_SESSIONS_DIR:-/tmp/tn-sessions}"
export TN_DATA_DIR="${TN_DATA_DIR:-/tmp/tn-sessions/base/data}"
export TN_DB_PATH="${TN_DB_PATH:-/tmp/tn-sessions/base/data/tn_traffic.db}"
export TN_RAW_DIR="${TN_RAW_DIR:-/app/data/raw}"
export TN_MODEL_CACHE="${TN_MODEL_CACHE:-/tmp/tn-model-cache}"
export HF_HOME="${HF_HOME:-/tmp/tn-model-cache/hf}"
export HF_ENDPOINT="${HF_ENDPOINT:-https://huggingface.co}"

mkdir -p "$TN_SESSIONS_DIR" "$TN_MODEL_CACHE"

if [ "${TN_PRELOAD_FOUNDATION:-1}" = "1" ]; then
  python scripts/prefetch_web_models.py >> /tmp/tn-model-prefetch.log 2>&1 &
fi

exec python -m uvicorn app.main:app --host 0.0.0.0 --port "$TN_PORT"
