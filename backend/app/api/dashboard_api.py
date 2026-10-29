from __future__ import annotations

from fastapi import APIRouter

from app.db.connection import query_all, query_one
from app.forecast.registry import MODELS, public_registry
from app.services.ingest import sources_summary
from app.services.validation import environment_report

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


@router.get("")
def dashboard() -> dict:
    sources = sources_summary()
    valid_regions = sum(s["series_region_count"] for s in sources)
    gis_regions = sum(s["gis_region_count"] for s in sources)
    recent: list[dict] = []
    for row in query_all(
        """
        SELECT dataset_id AS id, 'Dataset' AS kind, label AS title, status, created_at, source_id AS meta
        FROM dataset_versions ORDER BY created_at DESC LIMIT 8
        """
    ):
        recent.append(dict(row))
    for row in query_all(
        """
        SELECT experiment_id AS id, 'Experiment' AS kind,
               algorithm_label || ' · ' || mode AS title, status, created_at,
               dataset_id AS meta
        FROM experiments ORDER BY created_at DESC LIMIT 8
        """
    ):
        recent.append(dict(row))
    for row in query_all(
        """
        SELECT evaluation_id AS id, 'Evaluation' AS kind,
               scope || ' evaluation' AS title, status, created_at, dataset_id AS meta
        FROM evaluations ORDER BY created_at DESC LIMIT 8
        """
    ):
        recent.append(dict(row))
    for row in query_all(
        """
        SELECT batch_id AS id, 'Batch' AS kind,
               'All Models · ' || algorithm_count || ' algorithms' AS title, status, created_at,
               dataset_id AS meta
        FROM batches ORDER BY created_at DESC LIMIT 8
        """
    ):
        recent.append(dict(row))
    recent.sort(key=lambda item: item["created_at"], reverse=True)
    counts = {
        "data_sources": len(sources),
        "valid_regions": valid_regions,
        "gis_regions": gis_regions,
        "no_data_regions": gis_regions - valid_regions,
        "algorithms": len(MODELS),
        "modules": 5,
        "datasets": query_one("SELECT COUNT(*) AS n FROM dataset_versions WHERE status='Built'")["n"],
        "datasets_archived": query_one("SELECT COUNT(*) AS n FROM dataset_versions WHERE status='Archived'")["n"],
        "experiments": query_one("SELECT COUNT(*) AS n FROM experiments")["n"],
        "experiments_completed": query_one(
            "SELECT COUNT(*) AS n FROM experiments WHERE status='Completed'"
        )["n"],
        "batches": query_one("SELECT COUNT(*) AS n FROM batches")["n"],
        "evaluations": query_one("SELECT COUNT(*) AS n FROM evaluations")["n"],
        "cluster_runs": query_one("SELECT COUNT(*) AS n FROM clusters")["n"],
    }
    workflow = [
        {"step": 1, "module": "Module 1", "title": "Exploratory Traffic Analysis", "route": "/exploration",
         "description_zh": "时空、空间与跨地点模式探索"},
        {"step": 2, "module": "Module 2", "title": "Functional Zone Clustering", "route": "/clustering",
         "description_zh": "四种聚类算法与功能区模式分析"},
        {"step": 3, "module": "Module 3", "title": "Forecasting Dataset Construction", "route": "/dataset",
         "description_zh": "滑窗、无泄漏切分与 Dataset ID"},
        {"step": 4, "module": "Module 4", "title": "Model Training", "route": "/training",
         "description_zh": f"{len(MODELS)} 种算法与 All Models 批量执行"},
        {"step": 5, "module": "Module 5", "title": "Prediction & Evaluation", "route": "/evaluation",
         "description_zh": "held-out Test 公平评价"},
    ]
    return {
        "sources": sources,
        "counts": counts,
        "recent_activity": recent[:12],
        "workflow": workflow,
        "algorithms": [
            {
                "key": m["key"],
                "label": m["label"],
                "category": m["category"],
                "category_label_zh": m["category_label_zh"],
                "default_mode": m["default_mode"],
            }
            for m in public_registry()
        ],
        "environment": environment_report(),
        "disclaimer_zh": [
            "Milano / Trentino 的物理单位未证实，ZTE 为 4G 下行流量；不同来源的绝对值不可直接比较。",
            "所有统计、训练指标与预测都由真实数据与真实计算得出。",
        ],
    }
