"""FastAPI application entry point."""

from __future__ import annotations

import traceback
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from app import __version__
from app.api import (
    analysis_api,
    batches_api,
    clusters_api,
    dashboard_api,
    data_api,
    datasets_api,
    evaluations_api,
    experiments_api,
    health,
    models_api,
    validation_api,
)
from app.core.config import PROJECT_ROOT, settings
from app.core.errors import Conflict, NotFound, RequestRejected
from app.db.history_ids import migrate_readable_history_ids
from app.db.maintenance import purge_all_region_history, purge_legacy_dbscan_history
from app.db.migrate import run_migrations
from app.runtime_paths import (
    current_artifacts_dir,
    current_data_dir,
    current_model_cache_dir,
    current_processed_dir,
    current_raw_dir,
)
from app.services.ingest import SOURCE_DEFINITIONS, import_all, sources_summary
from app.web_sessions import (
    SecurityHeadersMiddleware,
    SessionIsolationMiddleware,
    initialize_session_manager,
    shutdown_session_manager,
)


def bootstrap() -> dict:
    for path in (
        current_data_dir(),
        current_processed_dir(),
        current_artifacts_dir(),
        current_model_cache_dir(),
        current_data_dir() / "logs",
        current_data_dir() / "backups",
    ):
        path.mkdir(parents=True, exist_ok=True)
    applied = run_migrations()
    history_ids = migrate_readable_history_ids()
    all_region_cleanup = purge_all_region_history()
    cluster_maintenance = purge_legacy_dbscan_history()
    imported: list[str] = []
    missing: list[str] = []
    if not sources_summary():
        for definition in SOURCE_DEFINITIONS:
            csv_path = current_raw_dir() / definition["csv"]
            if not csv_path.exists():
                missing.append(str(csv_path))
        if not missing:
            results = import_all(write_cache=True)
            imported = list(results.keys())
    return {
        "migrations": applied,
        "history_id_migration": history_ids,
        "all_region_cleanup": all_region_cleanup,
        "imported": imported,
        "missing_files": missing,
        "cluster_maintenance": cluster_maintenance,
    }


@asynccontextmanager
async def lifespan(app: FastAPI):
    if settings.web_mode:
        initialize_session_manager(bootstrap)
    else:
        bootstrap()
    try:
        yield
    finally:
        if settings.web_mode:
            shutdown_session_manager()


app = FastAPI(
    title="TN Traffic Intelligence API",
    version=__version__,
    description="智能流量分析与预测平台后端（真实数据、真实算法、真实评价）",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:4173",
                   "http://127.0.0.1:4173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(SessionIsolationMiddleware)
app.add_middleware(SecurityHeadersMiddleware)


@app.exception_handler(RequestRejected)
async def rejected_handler(request: Request, exc: RequestRejected):
    request_id = str(uuid.uuid4())
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "valid": False,
            "message": exc.message,
            "issues": exc.issues,
            "error_count": sum(1 for i in exc.issues if i.get("severity") == "error"),
            "warning_count": sum(1 for i in exc.issues if i.get("severity") == "warning"),
            "request_id": request_id,
        },
        headers={"X-Request-Id": request_id},
    )


@app.exception_handler(NotFound)
async def not_found_handler(request: Request, exc: NotFound):
    request_id = str(uuid.uuid4())
    return JSONResponse(
        status_code=404,
        content={"message": exc.message, "code": exc.code, "request_id": request_id},
    )


@app.exception_handler(Conflict)
async def conflict_handler(request: Request, exc: Conflict):
    request_id = str(uuid.uuid4())
    issues = exc.issues or [
        {
            "path": "conflict",
            "code": exc.code,
            "severity": "error",
            "message": exc.message,
            "suggestion": "请根据提示调整后重试。",
            "received_value": None,
        }
    ]
    return JSONResponse(
        status_code=409,
        content={
            "valid": False,
            "code": exc.code,
            "message": exc.message,
            "issues": issues,
            "request_id": request_id,
        },
    )


@app.exception_handler(RequestValidationError)
async def pydantic_handler(request: Request, exc: RequestValidationError):
    request_id = str(uuid.uuid4())
    issues = []
    for error in exc.errors():
        path = ".".join(str(part) for part in error.get("loc", [])) or "body"
        issues.append(
            {
                "path": path,
                "code": "SCHEMA_INVALID",
                "severity": "error",
                "message": error.get("msg", "请求体格式不正确"),
                "suggestion": "请检查字段类型与名称是否与 API 契约一致。",
                "received_value": error.get("input"),
            }
        )
    return JSONResponse(status_code=422, content={"valid": False, "issues": issues, "request_id": request_id})


@app.exception_handler(Exception)
async def generic_handler(request: Request, exc: Exception):
    request_id = str(uuid.uuid4())
    return JSONResponse(
        status_code=500,
        content={
            "message": "服务器内部错误，任务未被创建。",
            "code": type(exc).__name__,
            "detail": str(exc),
            "trace_id": request_id,
            "suggestion": "请复制 trace_id 供排查；如有正在进行的外部资源异常，任务会被标记为 Failed。",
        },
        headers={"X-Request-Id": request_id},
    )


app.include_router(health.router)
app.include_router(validation_api.router)
app.include_router(dashboard_api.router)
app.include_router(data_api.router)
app.include_router(analysis_api.router)
app.include_router(clusters_api.router)
app.include_router(datasets_api.router)
app.include_router(models_api.router)
app.include_router(experiments_api.router)
app.include_router(batches_api.router)
app.include_router(evaluations_api.router)


FRONTEND_DIST = PROJECT_ROOT / "frontend" / "dist"
if FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa(full_path: str):
        candidate = FRONTEND_DIST / full_path
        if candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(FRONTEND_DIST / "index.html")
