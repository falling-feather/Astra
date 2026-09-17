"""Small local FastEmbed worker for AI-025.

Input and output are one JSON document so the TypeScript port can run this
without adding Python or ONNX dependencies to the monorepo lockfile.
"""

from __future__ import annotations

import json
import os
import sys
from contextlib import redirect_stdout
from pathlib import Path
from typing import Any


def main() -> None:
    payload = json.loads(sys.stdin.buffer.read().decode("utf-8"))
    model_version = str(payload.get("modelVersion") or "BAAI/bge-small-zh-v1.5")
    cache_dir = Path(str(payload.get("cacheDir") or os.environ.get("RONGGANG_AI025_MODEL_DIR", ".local/ai025-models")))
    texts = payload.get("texts")
    if not isinstance(texts, list) or not all(isinstance(text, str) for text in texts):
        raise ValueError("texts must be an array of strings")
    batch_size = int(os.environ.get("RONGGANG_AI025_BATCH_SIZE", "8"))
    if batch_size < 1:
        raise ValueError("RONGGANG_AI025_BATCH_SIZE must be positive")
    from fastembed import TextEmbedding

    with redirect_stdout(sys.stderr):
        model = TextEmbedding(model_name=model_version, cache_dir=str(cache_dir), threads=1)
        vectors = [list(map(float, vector)) for vector in model.embed(texts, batch_size=batch_size)]
    dimension = len(vectors[0]) if vectors else 0
    if any(len(vector) != dimension for vector in vectors):
        raise ValueError("embedding vectors have inconsistent dimensions")
    print(json.dumps({
        "ok": True,
        "modelVersion": model_version,
        "dimension": dimension,
        "vectors": vectors,
    }, ensure_ascii=True, separators=(",", ":")))


try:
    main()
except Exception as error:  # pragma: no cover - surfaced to the TypeScript port
    print(json.dumps({
        "ok": False,
        "error": {"code": "embedding_worker_failed", "message": str(error)},
    }, ensure_ascii=True, separators=(",", ":")))
    raise SystemExit(1)
