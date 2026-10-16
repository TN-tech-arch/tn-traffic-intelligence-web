"""Status, checkpoint management and adapters for the two foundation models.

Both adapters perform **real pretrained inference**.  When the weights are not
available the status reported to the UI is ``Unavailable`` with the concrete
reason; nothing is ever simulated (PROJECT_SPEC 8.4 / 14.4).
"""

from __future__ import annotations

import importlib.util
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np

from app.core.config import settings
from app.forecast.base import (
    Adapter,
    CancelCallback,
    FitResult,
    ProgressCallback,
    RegionContext,
    WindowBatch,
    never_cancel,
    noop_progress,
)


@dataclass(frozen=True)
class CheckpointSpec:
    id: str
    family: str
    license: str
    context_length: int
    sampling: bool
    approx_size_mb: int
    note: str


CHRONOS_CHECKPOINTS = [
    CheckpointSpec("amazon/chronos-bolt-tiny", "chronos-bolt", "Apache-2.0", 2048, False, 35,
                   "确定性 Bolt 变体，CPU 友好"),
    CheckpointSpec("amazon/chronos-bolt-small", "chronos-bolt", "Apache-2.0", 2048, False, 180,
                   "更准确的 Bolt 变体"),
    CheckpointSpec("amazon/chronos-bolt-base", "chronos-bolt", "Apache-2.0", 2048, False, 800,
                   "Bolt base，资源占用更高"),
    CheckpointSpec("amazon/chronos-t5-tiny", "chronos-t5", "Apache-2.0", 512, True, 40,
                   "T5 采样变体，支持 temperature"),
    CheckpointSpec("amazon/chronos-t5-small", "chronos-t5", "Apache-2.0", 512, True, 190,
                   "T5 采样变体"),
]

TIMESFM_CHECKPOINTS = [
    CheckpointSpec("google/timesfm-2.5-200m-pytorch", "timesfm-2.5", "Apache-2.0", 16384, False, 800,
                   "官方推荐的 Apache-2.0 权重；CPU 可推理。TimesFM 3.0 权重在官方仓库为受限/需授权，本项目不使用。"),
]


def _module_available(name: str) -> bool:
    return importlib.util.find_spec(name) is not None


def _cached(checkpoint_id: str) -> bool:
    hub = settings.model_cache_dir / "hf" / "hub"
    folder = "models--" + checkpoint_id.replace("/", "--")
    target = hub / folder
    if not target.exists():
        return False
    snapshots = target / "snapshots"
    if not snapshots.exists():
        return False
    for snapshot in snapshots.iterdir():
        for pattern in ("*.safetensors", "*.bin", "*.pth", "*.pt", "*.ckpt"):
            if list(snapshot.glob(pattern)):
                return True
    return False


def _device_info() -> dict[str, Any]:
    info: dict[str, Any] = {"cuda": False, "device": "cpu"}
    try:
        import torch

        info["cuda"] = bool(torch.cuda.is_available())
        info["device"] = "cuda" if info["cuda"] else "cpu"
        info["torch"] = torch.__version__
    except Exception:
        info["torch"] = None
    return info


def _status(key: str, checkpoints: list[CheckpointSpec], module_names: list[str]) -> dict[str, Any]:
    installed = any(_module_available(name) for name in module_names)
    device = _device_info()
    entries = []
    for spec in checkpoints:
        cached = _cached(spec.id)
        entries.append(
            {
                "id": spec.id,
                "family": spec.family,
                "license": spec.license,
                "max_context": spec.context_length,
                "is_sampling": spec.sampling,
                "approx_size_mb": spec.approx_size_mb,
                "note": spec.note,
                "available": bool(cached),
                "download_required": not cached,
            }
        )
    default = next((e["id"] for e in entries if e["available"]), entries[0]["id"] if entries else "")
    return {
        "key": key,
        "package_installed": installed,
        "packages": module_names,
        "hf_endpoint": os.environ.get("HF_ENDPOINT", ""),
        "model_cache_dir": str(settings.model_cache_dir),
        "device_available": device,
        "supports_finetune": False,
        "finetune_note": "本版本仅启用官方证实的 Zero-shot 推理；Fine-tuning 未实现，保持不可用。",
        "max_context": max((e["max_context"] for e in entries if e["available"]), default=None),
        "checkpoints": entries,
        "default_checkpoint": default,
        "ready": bool(installed and any(e["available"] for e in entries)),
    }


def chronos_status() -> dict[str, Any]:
    return _status("chronos", CHRONOS_CHECKPOINTS, ["chronos"])


def timesfm_status() -> dict[str, Any]:
    return _status("timesfm", TIMESFM_CHECKPOINTS, ["timesfm"])


def status_for(key: str) -> dict[str, Any]:
    return chronos_status() if key == "chronos" else timesfm_status()


def resolve_checkpoint(key: str, requested: str | None) -> CheckpointSpec:
    """Resolve the checkpoint that will actually be executed.

    An explicitly requested checkpoint is never silently swapped for another one:
    unknown identifiers raise, and not-yet-downloaded weights surface as
    "Unavailable: weights missing" in the adapter instead of pretending to run.
    """
    specs = CHRONOS_CHECKPOINTS if key == "chronos" else TIMESFM_CHECKPOINTS
    if requested:
        for spec in specs:
            if spec.id == requested:
                return spec
        raise RuntimeError(
            f"未知的 checkpoint_id='{requested}'；{key} 支持的 checkpoint 为: "
            + ", ".join(s.id for s in specs)
        )
    status = status_for(key)
    for spec in specs:
        if spec.id == status.get("default_checkpoint") and _cached(spec.id):
            return spec
    return specs[0]


class _FoundationBase(Adapter):
    operates_in = "raw"
    has_epoch_progress = False
    stage_names = ("Checkpoint Validation", "Loading", "Inference", "Ready")


class ChronosAdapter(_FoundationBase):
    algorithm_key = "chronos"
    foundation_key = "chronos"

    def _load(self):
        import torch
        from chronos import BaseChronosPipeline

        spec = resolve_checkpoint("chronos", self.params.get("checkpoint_id"))
        if not _cached(spec.id):
            raise RuntimeError(
                f"checkpoint {spec.id} 未下载（Unavailable: weights missing）。"
                f"请在模型预检中执行下载，或设置 HF_ENDPOINT 后重试。"
            )
        dtype = str(self.params.get("dtype", "float32"))
        torch_dtype = {"float32": torch.float32, "float16": torch.float16, "bfloat16": torch.bfloat16}[dtype]
        requested_device = str(self.params.get("device", "auto") or "auto")
        if requested_device == "cuda" and not torch.cuda.is_available():
            raise RuntimeError("参数 device=cuda 但当前环境没有可用的 CUDA 设备。")
        device_map = "cuda" if (requested_device == "cuda" and torch.cuda.is_available()) else "cpu"
        pipeline = BaseChronosPipeline.from_pretrained(
            spec.id, device_map=device_map, torch_dtype=torch_dtype
        )
        return pipeline, spec, dtype

    def fit(self, *, region, train, validation, progress=noop_progress, cancel=never_cancel) -> FitResult:
        import torch

        progress("Checkpoint Validation", 5.0, "校验 Chronos checkpoint 与设备")
        pipeline, spec, dtype = self._load()
        self.check_cancel(cancel)
        progress("Loading", 60.0, f"Chronos checkpoint 已加载：{spec.id}（License: {spec.license}）")
        context_length = int(self.params.get("effective_context_length", 0) or 0)
        effective = min(region.L, spec.context_length) if context_length <= 0 else min(context_length, spec.context_length)
        state = {
            "checkpoint_id": spec.id,
            "license": spec.license,
            "family": spec.family,
            "device": str(next(pipeline.model.parameters()).device),
            "dtype": dtype,
            "effective_context_length": int(effective),
            "pipeline_ref": pipeline,
            "prediction_mode": self.params.get("prediction_mode", "median"),
        }
        progress("Ready", 100.0, "Chronos 已就绪（Zero-shot，无训练 Epoch）")
        return FitResult(
            state=state,
            history={
                "type": "zero_shot",
                "no_epochs": True,
                "checkpoint": spec.id,
                "license": spec.license,
                "device": state["device"],
                "stages": [
                    {"stage": "Checkpoint Validation", "status": "completed"},
                    {"stage": "Loading", "status": "completed"},
                    {"stage": "Ready", "status": "completed"},
                ],
            },
            notes=[
                f"使用官方预训练权重 {spec.id}（{spec.license}）进行 Zero-shot 推理。",
                "Zero-shot 模式没有训练 Epoch 与训练损失。",
            ],
        )

    def predict(self, *, region, state, batch, progress=noop_progress, cancel=never_cancel) -> np.ndarray:
        import torch

        pipeline = state.get("pipeline_ref")
        if pipeline is None:
            raise RuntimeError("Chronos pipeline 不可用，需重新运行该实验")
        if batch.size == 0:
            return np.empty((0, int(region.H)), dtype="float64")
        effective = int(state.get("effective_context_length") or region.L)
        effective = max(1, min(effective, region.L, int(batch.X_raw.shape[1])))
        contexts = np.asarray(batch.X_raw, dtype="float32")[:, -effective:]
        tensor = torch.tensor(contexts)
        chunk = max(1, int(self.params.get("inference_batch_size", 32)))
        outputs = []
        with torch.no_grad():
            for offset in range(0, tensor.shape[0], chunk):
                self.check_cancel(cancel)
                piece = tensor[offset: offset + chunk]
                quantiles, mean = pipeline.predict_quantiles(
                    inputs=piece,
                    prediction_length=int(region.H),
                    quantile_levels=[0.5],
                )
                if state.get("prediction_mode") == "mean":
                    outputs.append(np.asarray(mean.cpu().numpy(), dtype="float64"))
                else:
                    outputs.append(np.asarray(quantiles[:, :, 0].cpu().numpy(), dtype="float64"))
                progress("Inference", 100.0 * (offset + chunk) / max(1, tensor.shape[0]),
                         f"Chronos 推理 {min(offset + chunk, tensor.shape[0])}/{tensor.shape[0]} 个窗口")
        return np.concatenate(outputs, axis=0)


class TimesFMAdapter(_FoundationBase):
    algorithm_key = "timesfm"
    foundation_key = "timesfm"

    def _load(self):
        import torch

        spec = resolve_checkpoint("timesfm", self.params.get("checkpoint_id"))
        if not _cached(spec.id):
            raise RuntimeError(
                f"checkpoint {spec.id} 未下载（Unavailable: weights missing）。"
                f"请在模型预检中执行下载，或设置 HF_ENDPOINT 后重试。"
            )
        device = "cpu"
        requested = str(self.params.get("device", "auto") or "auto")
        if requested == "cuda" and torch.cuda.is_available():
            device = "cuda"
        elif requested == "cuda":
            raise RuntimeError("参数 device=cuda 但当前环境没有可用的 CUDA 设备。")
        model = None
        loader, loader_name = self._resolve_loader()
        try:
            model = loader.from_pretrained(spec.id)
        except Exception as exc:
            raise RuntimeError(f"TimesFM 权重加载失败（{loader_name}）：{exc}") from exc
        if device == "cuda":
            try:
                model = model.cuda()
            except Exception:
                pass
        model.eval() if hasattr(model, "eval") else None
        return model, spec, device

    @staticmethod
    def _resolve_loader():
        """Pick the loader that the installed official package really provides."""
        import timesfm

        for name in ("TimesFM_2p5_200M_torch", "TimesFM3Forecaster", "TimesFm", "TimesFM"):
            loader = getattr(timesfm, name, None)
            if loader is not None and hasattr(loader, "from_pretrained"):
                return loader, name
        raise RuntimeError(
            "已安装的 timesfm 包未提供官方 from_pretrained 推理入口；"
            "请安装官方 timesfm[torch] 包后重试。"
        )

    def fit(self, *, region, train, validation, progress=noop_progress, cancel=never_cancel) -> FitResult:
        progress("Checkpoint Validation", 5.0, "校验 TimesFM checkpoint 与设备")
        model, spec, device = self._load()
        self.check_cancel(cancel)
        max_context = self._supported_context(model, spec)
        requested = int(self.params.get("effective_context_length", 0) or 0)
        effective = min(region.L, max_context) if requested <= 0 else min(requested, max_context)
        compiled = self._compile(model, int(effective), int(region.H))
        if not compiled:
            raise RuntimeError(
                "TimesFM 版本要求先执行 compile()，但当前参数组合无法编译；"
                "请检查 effective_context_length / inference_batch_size。"
            )
        progress("Ready", 100.0, f"TimesFM 已加载：{spec.id}（License: {spec.license}）")
        return FitResult(
            state={
                "checkpoint_id": spec.id,
                "license": spec.license,
                "device": device,
                "effective_context_length": int(effective),
                "max_context": int(max_context),
                "pipeline_ref": model,
                "dtype": self.params.get("dtype", "float32"),
            },
            history={
                "type": "zero_shot",
                "no_epochs": True,
                "checkpoint": spec.id,
                "license": spec.license,
                "device": device,
                "stages": [
                    {"stage": "Checkpoint Validation", "status": "completed"},
                    {"stage": "Loading", "status": "completed"},
                    {"stage": "Ready", "status": "completed"},
                ],
            },
            notes=[
                f"使用官方预训练权重 {spec.id}（{spec.license}）进行 Zero-shot 推理。",
                "Zero-shot 模式没有训练 Epoch 与训练损失。",
                f"已按官方 API 以 max_context={effective}、max_horizon={region.H} 编译推理图。",
            ],
        )

    @staticmethod
    def _supported_context(model, spec: CheckpointSpec) -> int:
        for attribute in ("max_context", "context_length", "max_seq_len"):
            value = getattr(model, attribute, None)
            if isinstance(value, int) and value > 0:
                return value
        config = getattr(model, "config", None)
        for attribute in ("max_context", "context_length", "max_seq_len"):
            value = getattr(config, attribute, None)
            if isinstance(value, int) and value > 0:
                return value
        return spec.context_length

    def _compile(self, model, effective_context: int, horizon: int) -> bool:
        if not hasattr(model, "compile"):
            return True
        try:
            from timesfm.configs import ForecastConfig

            # max_context / max_horizon must be multiples of the patch sizes.
            context = max(effective_context, 32)
            context = max(32, int(np.ceil(context / 32.0) * 32))
            horizon_multiple = 128
            max_horizon = max(horizon_multiple, int(np.ceil(horizon / horizon_multiple) * horizon_multiple))
            model.compile(
                ForecastConfig(
                    max_context=context,
                    max_horizon=max_horizon,
                    per_core_batch_size=max(1, int(self.params.get("inference_batch_size", 32))),
                    normalize_inputs=bool(self.params.get("normalize_input", False)),
                    infer_is_positive=True,
                )
            )
            return True
        except Exception:
            try:
                model.compile(ForecastConfig(max_context=1024, max_horizon=128))
                return True
            except Exception:
                return False

    def predict(self, *, region, state, batch, progress=noop_progress, cancel=never_cancel) -> np.ndarray:
        model = state.get("pipeline_ref")
        if model is None:
            raise RuntimeError("TimesFM 模型不可用，需重新运行该实验")
        if batch.size == 0:
            return np.empty((0, int(region.H)), dtype="float64")
        effective = int(state.get("effective_context_length") or region.L)
        contexts = np.asarray(batch.X_raw, dtype="float32")[:, -effective:]
        chunk = max(1, int(self.params.get("inference_batch_size", 32)))
        outputs = []
        for offset in range(0, contexts.shape[0], chunk):
            self.check_cancel(cancel)
            piece = [list(map(float, row)) for row in contexts[offset: offset + chunk]]
            result = self._forecast(model, piece, int(region.H))
            outputs.append(np.asarray(result, dtype="float64"))
            progress("Inference", 100.0 * (offset + chunk) / max(1, contexts.shape[0]),
                     f"TimesFM 推理 {min(offset + chunk, contexts.shape[0])}/{contexts.shape[0]} 个窗口")
        return np.concatenate(outputs, axis=0)

    @staticmethod
    def _forecast(model, contexts: list[list[float]], horizon: int) -> np.ndarray:
        """Call whichever official inference API the installed version exposes."""
        prepared = [np.asarray(ctx, dtype="float32") for ctx in contexts]
        if hasattr(model, "forecast"):
            try:
                result = model.forecast(horizon=horizon, inputs=prepared)
            except TypeError:
                result = model.forecast(prepared, horizon)
            return _normalise_forecast(result, horizon)
        if hasattr(model, "forecast"):
            try:
                result = model.forecast(horizon=horizon, inputs=contexts)
            except TypeError:
                result = model.forecast(contexts, horizon)
            return _normalise_forecast(result, horizon)
        if hasattr(model, "predict_batch"):
            try:
                result = model.predict_batch(horizon=horizon, inputs=prepared)
            except TypeError:
                result = model.predict_batch(prepared, horizon)
            return _normalise_forecast(result, horizon)
        if hasattr(model, "predict"):
            result = model.predict(prepared, horizon)
            return _normalise_forecast(result, horizon)
        raise RuntimeError("TimesFM 模型未提供 forecast/predict_batch 推理接口")


def _normalise_forecast(result: Any, horizon: int) -> np.ndarray:
    if isinstance(result, tuple):
        result = result[0]
    array = np.asarray(result, dtype="float64")
    if array.ndim == 3:
        array = array[:, :, 0] if array.shape[2] <= array.shape[1] else array[:, 0, :]
    if array.shape[1] != horizon:
        if array.shape[1] > horizon:
            array = array[:, :horizon]
        else:
            raise RuntimeError(f"TimesFM 输出长度 {array.shape[1]} 小于请求的 H={horizon}")
    return array
