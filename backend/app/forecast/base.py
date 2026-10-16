"""Adapter contract shared by all 12 algorithms (PROJECT_SPEC 8.3 / 12.4)."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable

import numpy as np


class CancelledError(Exception):
    """Raised cooperatively when a job was asked to stop."""


ProgressCallback = Callable[[str, float, str, dict[str, Any] | None], None]
CancelCallback = Callable[[], bool]


def noop_progress(stage: str, percent: float, message: str, extra: dict[str, Any] | None = None) -> None:
    return None


def never_cancel() -> bool:
    return False


@dataclass
class WindowBatch:
    """Sliding windows for one region and one split."""

    starts: np.ndarray  # int64 [N] index of v[t]
    X_scaled: np.ndarray  # float32 [N, L]
    Y_scaled: np.ndarray  # float32 [N, H]
    X_raw: np.ndarray  # float32 [N, L]
    Y_raw: np.ndarray  # float32 [N, H]
    target_index: np.ndarray  # int64 [N, H] absolute indices of the targets
    target_timestamps: np.ndarray  # datetime64[s] [N, H] target time anchors

    @property
    def size(self) -> int:
        return int(self.starts.size)


@dataclass
class RegionContext:
    """Everything the adapters need to know about one region of one dataset."""

    source_key: str
    region_id: str
    timestamps: np.ndarray  # int64 epoch seconds of the dataset time axis
    series_full: np.ndarray  # float64 raw (filled) values of the region
    observed: np.ndarray  # bool [T]
    imputed_end: np.ndarray  # int32 [T]
    L: int
    H: int
    S: int
    scaler: dict[str, Any]
    split_boundaries: list[list[int]]
    unit_label: str = ""

    @property
    def train_end_index(self) -> int:
        return int(self.split_boundaries[0][1]) - 1

    @property
    def train_end_at(self) -> str:
        import pandas as pd

        return pd.Timestamp(int(self.timestamps[self.train_end_index]), unit="s").isoformat(sep=" ")

    def timestamps_for(self, indices: np.ndarray) -> np.ndarray:
        return self.timestamps[np.asarray(indices, dtype="int64")]


@dataclass
class FitResult:
    state: dict[str, Any]
    history: dict[str, Any] = field(default_factory=dict)
    notes: list[str] = field(default_factory=list)
    validation_metrics: dict[str, Any] = field(default_factory=dict)


class Adapter:
    """Base class for real algorithm implementations.

    ``operates_in`` declares whether the adapter consumes/produces scaled values
    (training type models) or raw source-unit values (statistical models and
    domain foundation models, which bring their own scaling).
    """

    algorithm_key: str = ""
    operates_in: str = "scaled"
    has_epoch_progress: bool = False
    stage_names: tuple[str, ...] = ()

    def __init__(self, params: dict[str, Any], mode: str, context: dict[str, Any] | None = None) -> None:
        self.params = params or {}
        self.mode = mode
        self.context = context or {}

    # -- subclasses implement these -------------------------------------
    def fit(
        self,
        *,
        region: "RegionContext",
        train: WindowBatch,
        validation: WindowBatch | None,
        progress: ProgressCallback = noop_progress,
        cancel: CancelCallback = never_cancel,
    ) -> FitResult:  # pragma: no cover - abstract
        raise NotImplementedError

    def predict(
        self,
        *,
        region: "RegionContext",
        state: dict[str, Any],
        batch: WindowBatch,
        progress: ProgressCallback = noop_progress,
        cancel: CancelCallback = never_cancel,
    ) -> np.ndarray:  # pragma: no cover - abstract
        raise NotImplementedError

    # -- helpers --------------------------------------------------------
    @staticmethod
    def check_cancel(cancel: CancelCallback) -> None:
        if cancel():
            raise CancelledError("任务已按用户请求停止")

    def describe(self) -> dict[str, Any]:
        return {
            "algorithm_key": self.algorithm_key,
            "mode": self.mode,
            "operates_in": self.operates_in,
            "has_epoch_progress": self.has_epoch_progress,
        }


def finite_or_raise(prediction: np.ndarray, expected_shape: tuple[int, int]) -> np.ndarray:
    array = np.asarray(prediction, dtype="float64")
    if array.shape != expected_shape:
        raise ValueError(f"模型输出形状 {array.shape} 与期望 {expected_shape} 不一致")
    if not np.isfinite(array).all():
        raise ValueError("模型输出包含非有限值（NaN/Inf），按失败处理")
    return array
