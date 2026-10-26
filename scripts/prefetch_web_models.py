"""Best-effort background download of the two optional foundation models."""

from __future__ import annotations

import os
import time

from huggingface_hub import snapshot_download


MODELS = (
    "amazon/chronos-bolt-tiny",
    "google/timesfm-2.5-200m-pytorch",
)


def main() -> None:
    os.environ.setdefault("HF_ENDPOINT", "https://huggingface.co")
    for model in MODELS:
        for attempt in range(3):
            try:
                print(f"[prefetch] downloading {model} (attempt {attempt + 1})", flush=True)
                snapshot_download(model)
                print(f"[prefetch] ready: {model}", flush=True)
                break
            except Exception as exc:
                print(f"[prefetch] failed: {model}: {type(exc).__name__}: {exc}", flush=True)
                if attempt == 2:
                    raise
                time.sleep(5 * (attempt + 1))


if __name__ == "__main__":
    main()
