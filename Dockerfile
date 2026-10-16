# Container image for the TN Traffic Intelligence backend + worker.
# The frontend must already be built (npm run build) so frontend/dist is served
# by FastAPI; see docs/DEPLOYMENT.md.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    HF_HOME=/models/hf

WORKDIR /app

COPY requirements-core.txt requirements-ml.txt requirements-models.txt ./
RUN pip install --no-cache-dir -r requirements-core.txt -r requirements-ml.txt
# torch CPU wheels keep the image smaller; replace with a CUDA index for GPU hosts.
RUN pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu torch \
 && pip install --no-cache-dir chronos-forecasting timesfm prophet

COPY backend ./backend
COPY frontend/dist ./frontend/dist
COPY data/raw ./data/raw
COPY scripts ./scripts

ENV PYTHONPATH=/app/backend
EXPOSE 8077
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8077"]
