"""Deep learning adapters: MLP, RNN, LSTM, GRU, Transformer (real PyTorch training).

Every epoch is a real pass over the training windows; the recorded train /
validation losses come from the actual optimisation loop.  No synthetic curves.
"""

from __future__ import annotations

import io
import math
import time
from typing import Any

import numpy as np

from app.forecast.base import (
    Adapter,
    CancelCallback,
    CancelledError,
    FitResult,
    ProgressCallback,
    RegionContext,
    WindowBatch,
    never_cancel,
    noop_progress,
)


def _torch():
    import torch

    return torch


def build_network(kind: str, L: int, H: int, params: dict[str, Any]):
    torch = _torch()
    import torch.nn as nn

    class MLP(nn.Module):
        def __init__(self) -> None:
            super().__init__()
            layers: list[nn.Module] = []
            in_features = L
            for _ in range(int(params.get("hidden_layers", 2))):
                layers.append(nn.Linear(in_features, int(params.get("hidden_units", 128))))
                activation = params.get("activation", "relu")
                layers.append(
                    {"relu": nn.ReLU, "tanh": nn.Tanh, "gelu": nn.GELU, "sigmoid": nn.Sigmoid}[activation]()
                )
                if float(params.get("dropout", 0.0)) > 0:
                    layers.append(nn.Dropout(float(params["dropout"])))
                in_features = int(params.get("hidden_units", 128))
            layers.append(nn.Linear(in_features, H))
            self.net = nn.Sequential(*layers)

        def forward(self, x):
            return self.net(x)

    class Recurrent(nn.Module):
        def __init__(self, cell: str) -> None:
            super().__init__()
            hidden = int(params.get("hidden_size", 128))
            layers = int(params.get("num_layers", 2))
            dropout = float(params.get("dropout", 0.0)) if layers > 1 else 0.0
            cls = {"rnn": nn.RNN, "lstm": nn.LSTM, "gru": nn.GRU}[cell]
            kwargs: dict[str, Any] = {
                "input_size": 1,
                "hidden_size": hidden,
                "num_layers": layers,
                "batch_first": True,
                "dropout": dropout,
            }
            if cell == "rnn":
                kwargs["nonlinearity"] = params.get("nonlinearity", "tanh")
            self.rnn = cls(**kwargs)
            self.bidirectional = bool(params.get("bidirectional", False)) if cell == "lstm" else False
            if self.bidirectional:
                self.rnn = nn.LSTM(
                    input_size=1, hidden_size=hidden, num_layers=layers, batch_first=True,
                    dropout=dropout, bidirectional=True,
                )
            factor = 2 if self.bidirectional else 1
            self.head = nn.Sequential(nn.Linear(hidden * factor, hidden), nn.ReLU(), nn.Linear(hidden, H))

        def forward(self, x):
            out, _ = self.rnn(x)
            return self.head(out[:, -1, :])

    class TransformerNet(nn.Module):
        def __init__(self) -> None:
            super().__init__()
            d_model = int(params.get("d_model", 128))
            heads = int(params.get("n_heads", 8))
            layers = int(params.get("encoder_layers", 3))
            dropout = float(params.get("dropout", 0.1))
            self.input_projection = nn.Linear(1, d_model)
            self.positional = params.get("positional_encoding", "sinusoidal")
            if self.positional == "learned":
                self.position_embedding = nn.Parameter(torch.zeros(1, L, d_model))
            else:
                self.register_buffer("position_encoding", _sinusoidal(L, d_model))
            encoder_layer = nn.TransformerEncoderLayer(
                d_model=d_model,
                nhead=heads,
                dim_feedforward=int(params.get("dim_feedforward", 256)),
                dropout=dropout,
                batch_first=True,
                activation="gelu",
            )
            self.encoder = nn.TransformerEncoder(encoder_layer, num_layers=layers)
            self.head = nn.Linear(d_model, H)

        def forward(self, x):
            h = self.input_projection(x)
            if self.positional == "learned":
                h = h + self.position_embedding
            else:
                h = h + self.position_encoding
            h = self.encoder(h)
            return self.head(h[:, -1, :])

    if kind == "mlp":
        return MLP()
    if kind in ("rnn", "lstm", "gru"):
        return Recurrent(kind)
    return TransformerNet()


def _sinusoidal(length: int, d_model: int):
    torch = _torch()
    position = torch.arange(length, dtype=torch.float32).unsqueeze(1)
    div = torch.exp(torch.arange(0, d_model, 2, dtype=torch.float32) * (-math.log(10000.0) / d_model))
    pe = torch.zeros(length, d_model)
    pe[:, 0::2] = torch.sin(position * div)
    pe[:, 1::2] = torch.cos(position * div)
    return pe.unsqueeze(0)


class DeepLearningAdapter(Adapter):
    operates_in = "scaled"
    has_epoch_progress = True
    stage_names = ("Train", "Validation", "Ready")

    def _device(self):
        torch = _torch()
        requested = str(self.params.get("device", "auto") or "auto")
        if requested == "cuda" and torch.cuda.is_available():
            return torch.device("cuda")
        return torch.device("cpu")

    def _needs_sequence(self) -> bool:
        return self.algorithm_key != "mlp"

    def fit(self, *, region, train, validation, progress=noop_progress, cancel=never_cancel) -> FitResult:
        torch = _torch()
        import torch.nn as nn

        torch.manual_seed(int(self.params.get("random_seed", 42)))
        np.random.seed(int(self.params.get("random_seed", 42)))
        device = self._device()
        L, H = int(region.L), int(region.H)
        net = build_network(self.algorithm_key, L, H, self.params).to(device)
        epochs = int(self.params.get("epochs", 100))
        batch_size = max(1, int(self.params.get("batch_size", 64)))
        lr = float(self.params.get("learning_rate", 0.001))
        weight_decay = float(self.params.get("weight_decay", 0.0) or 0.0)
        optimizer_name = str(self.params.get("optimizer", "adam")).lower()
        if optimizer_name == "adamw" or self.algorithm_key == "transformer":
            optimizer = torch.optim.AdamW(net.parameters(), lr=lr, weight_decay=weight_decay)
        elif optimizer_name == "sgd":
            optimizer = torch.optim.SGD(net.parameters(), lr=lr, momentum=0.9, weight_decay=weight_decay)
        else:
            optimizer = torch.optim.Adam(net.parameters(), lr=lr, weight_decay=weight_decay)
        criterion = nn.MSELoss()

        X = np.asarray(train.X_scaled, dtype="float32")
        Y = np.asarray(train.Y_scaled, dtype="float32")
        if X.size == 0:
            raise ValueError("训练集没有可用窗口")
        X_tensor = torch.tensor(X)
        Y_tensor = torch.tensor(Y)
        if self._needs_sequence():
            X_tensor = X_tensor.unsqueeze(-1)
        validation_ready = validation is not None and validation.size > 0
        if validation_ready:
            Xv = torch.tensor(np.asarray(validation.X_scaled, dtype="float32"))
            Yv = torch.tensor(np.asarray(validation.Y_scaled, dtype="float32"))
            if self._needs_sequence():
                Xv = Xv.unsqueeze(-1)

        history = {"epoch": [], "train_loss": [], "validation_loss": [], "learning_rate": []}
        best_state = None
        best_loss = float("inf")
        patience = int(self.params.get("patience", 10) or 10)
        early_stopping = bool(self.params.get("early_stopping", True))
        epochs_without_improvement = 0
        started = time.time()
        n_samples = X_tensor.shape[0]
        steps_per_epoch = max(1, math.ceil(n_samples / batch_size))
        total_steps = epochs * steps_per_epoch
        warmup = int(self.params.get("warmup", 0) or 0)
        step_counter = 0

        for epoch in range(1, epochs + 1):
            net.train()
            permutation = torch.randperm(n_samples)
            epoch_loss = 0.0
            seen = 0
            for offset in range(0, n_samples, batch_size):
                self.check_cancel(cancel)
                idx = permutation[offset: offset + batch_size]
                batch_x = X_tensor[idx].to(device)
                batch_y = Y_tensor[idx].to(device)
                if warmup and step_counter < warmup:
                    scale = (step_counter + 1) / warmup
                    for group in optimizer.param_groups:
                        group["lr"] = lr * scale
                optimizer.zero_grad(set_to_none=True)
                output = net(batch_x)
                loss = criterion(output, batch_y)
                loss.backward()
                clip = float(self.params.get("gradient_clip", 0) or 0)
                if clip > 0:
                    torch.nn.utils.clip_grad_norm_(net.parameters(), clip)
                optimizer.step()
                if warmup and step_counter < warmup:
                    for group in optimizer.param_groups:
                        group["lr"] = lr
                step_counter += 1
                epoch_loss += float(loss.item()) * idx.shape[0]
                seen += int(idx.shape[0])
            train_loss = epoch_loss / max(1, seen)
            net.eval()
            with torch.no_grad():
                if validation_ready:
                    val_loss = float(criterion(net(Xv.to(device)), Yv.to(device)).item())
                else:
                    val_loss = float("nan")
            history["epoch"].append(epoch)
            history["train_loss"].append(train_loss)
            history["validation_loss"].append(None if math.isnan(val_loss) else val_loss)
            history["learning_rate"].append(float(optimizer.param_groups[0]["lr"]))
            monitored = val_loss if validation_ready else train_loss
            if monitored < best_loss - 1e-9:
                best_loss = monitored
                best_state = {k: v.detach().cpu().clone() for k, v in net.state_dict().items()}
                epochs_without_improvement = 0
            else:
                epochs_without_improvement += 1
            progress(
                "Train",
                100.0 * (epoch / epochs),
                f"epoch {epoch}/{epochs} train_loss={train_loss:.6f}"
                + (f" val_loss={val_loss:.6f}" if validation_ready else ""),
                {
                    "epoch": epoch,
                    "epochs": epochs,
                    "train_loss": train_loss,
                    "validation_loss": None if math.isnan(val_loss) else val_loss,
                    "stage": "Train",
                },
            )
            if early_stopping and epochs_without_improvement >= patience:
                history["stopped_early_at"] = epoch
                break
        if best_state is not None:
            net.load_state_dict(best_state)
        buffer = io.BytesIO()
        torch.save(net.state_dict(), buffer)
        duration = time.time() - started
        summary = {
            "type": "epochs",
            "epochs_completed": len(history["epoch"]),
            "epochs_requested": epochs,
            "best_loss": None if best_loss == float("inf") else best_loss,
            "monitor": "validation_loss" if validation_ready else "train_loss",
            "parameters": int(sum(p.numel() for p in net.parameters())),
            "device": str(device),
            "duration_seconds": round(duration, 3),
            "batch_size": batch_size,
        }
        progress("Validation", 100.0, f"训练完成，共 {summary['epochs_completed']} 个 epoch，用时 {duration:.1f}s")
        state = {
            "model_bytes": buffer.getvalue(),
            "kind": self.algorithm_key,
            "L": L,
            "H": H,
            "params": dict(self.params),
            "summary": summary,
        }
        return FitResult(
            state=state,
            history={**history, **summary},
            notes=[
                f"PyTorch {self.algorithm_key.upper()} 在 {device} 上真实训练 {summary['epochs_completed']} 个 epoch。",
                "损失为真实 MSE，验证损失使用验证集窗口（不参与梯度更新）。",
            ],
        )

    def predict(self, *, region, state, batch, progress=noop_progress, cancel=never_cancel) -> np.ndarray:
        torch = _torch()
        if batch.size == 0:
            return np.empty((0, int(region.H)), dtype="float64")
        net = build_network(self.algorithm_key, int(region.L), int(region.H), state.get("params") or self.params)
        net.load_state_dict(torch.load(io.BytesIO(state["model_bytes"]), map_location="cpu"))
        net.eval()
        X = torch.tensor(np.asarray(batch.X_scaled, dtype="float32"))
        if self._needs_sequence():
            X = X.unsqueeze(-1)
        outputs = []
        with torch.no_grad():
            for offset in range(0, X.shape[0], 256):
                self.check_cancel(cancel)
                chunk = X[offset: offset + 256]
                outputs.append(net(chunk).cpu().numpy())
        return np.concatenate(outputs, axis=0).astype("float64")
