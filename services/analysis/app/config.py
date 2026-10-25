"""Settings from environment variables. Read per request, so a restart is not needed in tests."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

DEFAULT_MODELS_DIR = Path(__file__).resolve().parent.parent / "models"


def _float(name: str, default: float) -> float:
    value = os.environ.get(name)
    return float(value) if value not in (None, "") else default


def _int(name: str, default: int) -> int:
    value = os.environ.get(name)
    return int(value) if value not in (None, "") else default


def _bool(name: str, default: bool) -> bool:
    value = os.environ.get(name)
    return default if value in (None, "") else value.strip().lower() in ("1", "true", "yes", "on")


@dataclass(frozen=True)
class Settings:
    secret: str
    models_dir: Path
    max_upload_bytes: int
    # Cosine similarity of SFace embeddings; 0.363 is the OpenCV Zoo operating point.
    face_match_threshold: float
    # Mean MiniFASNet real-face probability over the sampled frames.
    liveness_threshold: float
    liveness_frames: int
    liveness_min_frames: int
    # Mean absolute grey-level change between sampled frames; a replayed still image stays near zero.
    liveness_min_motion: float
    require_liveness: bool
    # Variance of the Laplacian of the rectified document at 1000 px width.
    quality_min_sharpness: float
    # Share of near-white pixels.
    quality_max_glare: float
    quality_min_brightness: float
    quality_max_brightness: float


def get_settings() -> Settings:
    return Settings(
        secret=os.environ.get("ANALYSIS_SECRET", ""),
        models_dir=Path(os.environ.get("MODELS_DIR") or DEFAULT_MODELS_DIR),
        max_upload_bytes=_int("MAX_UPLOAD_BYTES", 40 * 1024 * 1024),
        face_match_threshold=_float("FACE_MATCH_THRESHOLD", 0.363),
        liveness_threshold=_float("LIVENESS_THRESHOLD", 0.6),
        liveness_frames=_int("LIVENESS_FRAMES", 8),
        liveness_min_frames=_int("LIVENESS_MIN_FRAMES", 4),
        liveness_min_motion=_float("LIVENESS_MIN_MOTION", 1.0),
        require_liveness=_bool("REQUIRE_LIVENESS", True),
        quality_min_sharpness=_float("QUALITY_MIN_SHARPNESS", 40.0),
        quality_max_glare=_float("QUALITY_MAX_GLARE", 0.05),
        quality_min_brightness=_float("QUALITY_MIN_BRIGHTNESS", 60.0),
        quality_max_brightness=_float("QUALITY_MAX_BRIGHTNESS", 230.0),
    )
