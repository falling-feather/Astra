"""Offline content extraction worker for BE-007.

The worker never fetches URLs and never turns missing OCR/ASR dependencies into
successful recognition. It emits one JSON result and is intentionally driven by
the TypeScript ingestion service through a subprocess boundary.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path
from typing import Any


def emit(payload: dict[str, Any]) -> None:
    print(json.dumps(payload, ensure_ascii=True, separators=(",", ":")))


def failure(code: str, message: str, retryable: bool = False, **details: Any) -> None:
    emit({
        "ok": False,
        "error": {"code": code, "message": message, "retryable": retryable, **details},
    })


def merge_pdf_blocks(blocks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Keep adjacent lines of one paragraph together while retaining page coordinates."""
    merged: list[dict[str, Any]] = []
    for block in blocks:
        current = merged[-1] if merged else None
        left = current["locator"].get("bbox") if current else None
        right = block["locator"].get("bbox")
        begins_article = bool(re.match(r"^第[一二三四五六七八九十百零〇0-9]+条", block["text"]))
        same_paragraph = current and left and right and not begins_article and (
            len(current["text"]) + len(block["text"]) < 1000
            and not current["text"].rstrip().endswith(("。", "！", "？", ".", "!", "?"))
            and abs(left["x"] - right["x"]) < 45
            and -2 <= right["y"] - (left["y"] + left["height"]) < 45
        )
        if same_paragraph:
            current["text"] += "\n" + block["text"]
            x, y = min(left["x"], right["x"]), min(left["y"], right["y"])
            current["locator"]["bbox"] = {"x": x, "y": y, "width": max(left["x"] + left["width"], right["x"] + right["width"]) - x, "height": max(left["y"] + left["height"], right["y"] + right["height"]) - y}
            current["metadata"]["mergedBlockCount"] = current["metadata"].get("mergedBlockCount", 1) + 1
        else:
            merged.append(block)
    return merged


def pdf_fragments(path: Path) -> dict[str, Any]:
    try:
        try:
            import pymupdf as fitz  # PyMuPDF 1.28+
        except ImportError:
            import fitz  # type: ignore[no-redef]

        document = fitz.open(path)
        fragments: list[dict[str, Any]] = []
        for page_index in range(len(document)):
            page_start = len(fragments)
            page = document[page_index]
            blocks = page.get_text("blocks", sort=True)
            page_fragments = 0
            for block in blocks:
                text = str(block[4]).strip()
                if not text:
                    continue
                bbox = {
                    "x": float(block[0]),
                    "y": float(block[1]),
                    "width": float(block[2] - block[0]),
                    "height": float(block[3] - block[1]),
                }
                fragments.append({
                    "ordinal": len(fragments),
                    "text": text,
                    "locator": {
                        "page": page_index + 1,
                        "bbox": bbox,
                        "label": f"第 {page_index + 1} 页",
                    },
                    "metadata": {
                        "engine": "pymupdf",
                        "representation": "extracted-source",
                    },
                })
                page_fragments += 1
            if page_fragments == 0:
                text = str(page.get_text("text")).strip()
                if text:
                    fragments.append({
                        "ordinal": len(fragments),
                        "text": text,
                        "locator": {"page": page_index + 1, "label": f"第 {page_index + 1} 页"},
                        "metadata": {
                            "engine": "pymupdf",
                            "representation": "extracted-source",
                        },
                    })
            fragments[page_start:] = merge_pdf_blocks(fragments[page_start:])
            for ordinal in range(page_start, len(fragments)):
                fragments[ordinal]["ordinal"] = ordinal
        metadata = {
            "engine": "pymupdf",
            "pageCount": len(document),
            "representation": "extracted-source",
        }
        document.close()
        return {
            "fragments": fragments,
            "metadata": metadata,
            "capabilities": [] if fragments else [{
                "code": "ocr_required_for_scanned_pdf",
                "message": "PDF 没有可提取文字，需要 OCR 才能形成正文片段",
            }],
        }
    except ImportError:
        pass
    except Exception as error:  # pragma: no cover - exact parser errors vary by PDF
        failure("pdf_parse_failed", str(error), retryable=False, engine="pymupdf")
        raise SystemExit(0)

    try:
        from pypdf import PdfReader

        reader = PdfReader(str(path))
        fragments = []
        for page_index, page in enumerate(reader.pages):
            text = (page.extract_text() or "").strip()
            if text:
                fragments.append({
                    "ordinal": len(fragments),
                    "text": text,
                    "locator": {"page": page_index + 1, "label": f"第 {page_index + 1} 页"},
                    "metadata": {
                        "engine": "pypdf",
                        "representation": "extracted-source",
                    },
                })
        return {
            "fragments": fragments,
            "metadata": {
                "engine": "pypdf",
                "pageCount": len(reader.pages),
                "representation": "extracted-source",
            },
            "capabilities": [] if fragments else [{
                "code": "ocr_required_for_scanned_pdf",
                "message": "PDF 没有可提取文字，需要 OCR 才能形成正文片段",
            }],
        }
    except ImportError:
        failure("pdf_parser_missing", "pypdf and PyMuPDF are not installed", retryable=False)
        raise SystemExit(0)
    except Exception as error:  # pragma: no cover
        failure("pdf_parse_failed", str(error), retryable=False, engine="pypdf")
        raise SystemExit(0)


def image_fragments(path: Path) -> dict[str, Any]:
    try:
        from PIL import Image

        image = Image.open(path)
        metadata: dict[str, Any] = {
            "engine": "PIL",
            "width": image.width,
            "height": image.height,
            "format": image.format,
            "mode": image.mode,
            "frameCount": getattr(image, "n_frames", 1),
        }
    except ImportError:
        failure("image_parser_missing", "Pillow is not installed", retryable=False)
        raise SystemExit(0)
    except Exception as error:  # pragma: no cover
        failure("image_parse_failed", str(error), retryable=False)
        raise SystemExit(0)

    try:
        from rapidocr_onnxruntime import RapidOCR

        result, _ = RapidOCR()(str(path))
        fragments: list[dict[str, Any]] = []
        for item in result or []:
            points = item[0]
            text = str(item[1]).strip()
            score = float(item[2])
            if not text:
                continue
            xs = [float(point[0]) for point in points]
            ys = [float(point[1]) for point in points]
            fragments.append({
                "ordinal": len(fragments),
                "text": text,
                "locator": {
                    "page": 1,
                    "bbox": {
                        "x": min(xs),
                        "y": min(ys),
                        "width": max(xs) - min(xs),
                        "height": max(ys) - min(ys),
                    },
                    "label": "图像 OCR",
                },
                "metadata": {
                    "engine": "rapidocr_onnxruntime",
                    "confidence": score,
                    "representation": "ocr",
                },
            })
        metadata.update({"ocrEngine": "rapidocr_onnxruntime", "ocrCount": len(fragments)})
        return {"fragments": fragments, "metadata": metadata, "capabilities": []}
    except ImportError:
        metadata["ocrEngine"] = None
        return {
            "fragments": [{
                "ordinal": 0,
                "text": f"图像元数据：{image.width}×{image.height}，格式 {image.format or 'unknown'}。",
                "locator": {"page": 1, "bbox": {"x": 0, "y": 0, "width": image.width, "height": image.height}, "label": "图像整体"},
                "metadata": {"engine": "PIL", "representation": "metadata-only", "ocr": "capability_missing"},
            }],
            "metadata": metadata,
            "capabilities": [{"code": "ocr_capability_missing", "message": "rapidocr_onnxruntime is not installed"}],
        }
    except Exception as error:  # pragma: no cover
        failure("ocr_failed", str(error), retryable=True)
        raise SystemExit(0)


def asr_fragments(path: Path, model_name: str, model_dir: Path, language: str) -> dict[str, Any]:
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        return {
            "fragments": [],
            "metadata": {"asrEngine": None, "representation": "metadata-only"},
            "capabilities": [{"code": "asr_capability_missing", "message": "faster-whisper is not installed"}],
        }

    try:
        model = WhisperModel(
            model_name,
            device="cpu",
            compute_type="int8",
            download_root=str(model_dir),
        )
        segments, info = model.transcribe(
            str(path),
            language=language,
            beam_size=1,
            vad_filter=True,
        )
        fragments: list[dict[str, Any]] = []
        for segment in segments:
            text = str(segment.text).strip()
            if not text:
                continue
            fragments.append({
                "ordinal": len(fragments),
                "text": text,
                "locator": {
                    "startMs": round(float(segment.start) * 1000),
                    "endMs": round(float(segment.end) * 1000),
                    "label": f"{segment.start:.2f}s—{segment.end:.2f}s",
                },
                "metadata": {
                    "engine": "faster-whisper",
                    "model": model_name,
                    "language": getattr(info, "language", language),
                    "avgLogprob": float(getattr(segment, "avg_logprob", 0.0)),
                    "representation": "asr",
                },
            })
        return {
            "fragments": fragments,
            "metadata": {
                "asrEngine": "faster-whisper",
                "model": model_name,
                "language": getattr(info, "language", language),
                "duration": float(getattr(info, "duration", 0.0)),
            },
            "capabilities": [] if fragments else [{"code": "asr_no_speech", "message": "ASR completed without speech segments"}],
        }
    except Exception as error:  # pragma: no cover - download/model/runtime errors vary
        failure("asr_failed", str(error), retryable=True, model=model_name)
        raise SystemExit(0)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--kind", required=True, choices=["pdf", "image", "asr"])
    parser.add_argument("--path", required=True)
    parser.add_argument("--model-name", default="tiny")
    parser.add_argument("--model-dir", default=os.environ.get("RONGGANG_BE007_MODEL_DIR", ".local/be007-models"))
    parser.add_argument("--language", default="zh")
    args = parser.parse_args()
    path = Path(args.path)
    if not path.is_file():
        failure("input_not_found", f"input is not a regular file: {path}", retryable=False)
        return
    if args.kind == "pdf":
        emit({"ok": True, **pdf_fragments(path)})
        return
    if args.kind == "image":
        emit({"ok": True, **image_fragments(path)})
        return
    emit({"ok": True, **asr_fragments(path, args.model_name, Path(args.model_dir), args.language)})


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as error:  # pragma: no cover
        failure("worker_failed", str(error), retryable=True)
