"""Face detection (YuNet) and recognition (SFace) with OpenCV's DNN module."""

from __future__ import annotations

import threading
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

YUNET = "face_detection_yunet_2023mar.onnx"
SFACE = "face_recognition_sface_2021dec.onnx"
DETECT_SIDE = 640


@dataclass(frozen=True)
class Face:
    # YuNet row: x, y, w, h, five landmarks (x, y), score; in the coordinates of the image it was found in.
    row: np.ndarray

    @property
    def box(self) -> tuple[float, float, float, float]:
        x, y, w, h = self.row[:4]
        return float(x), float(y), float(w), float(h)

    @property
    def score(self) -> float:
        return float(self.row[14])


class FaceModels:
    """OpenCV DNN objects are not thread-safe, so calls are serialised."""

    def __init__(self, models_dir: Path):
        self._detector = cv2.FaceDetectorYN.create(str(models_dir / YUNET), "", (320, 320), 0.7, 0.3, 50)
        self._recognizer = cv2.FaceRecognizerSF.create(str(models_dir / SFACE), "")
        self._lock = threading.Lock()

    def detect(self, image: np.ndarray, min_score: float = 0.7) -> list[Face]:
        """Faces largest first. Large photos are searched at DETECT_SIDE pixels and mapped back."""
        scale = min(1.0, DETECT_SIDE / max(image.shape[:2]))
        work = cv2.resize(image, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA) if scale < 1 else image
        with self._lock:
            self._detector.setScoreThreshold(min_score)
            self._detector.setInputSize((work.shape[1], work.shape[0]))
            _, rows = self._detector.detect(work)
        if rows is None:
            return []
        faces = []
        for row in rows:
            row = row.copy()
            row[:14] /= scale
            faces.append(Face(row))
        return sorted(faces, key=lambda face: face.box[2] * face.box[3], reverse=True)

    def largest(self, image: np.ndarray, min_score: float = 0.7) -> Face | None:
        faces = self.detect(image, min_score)
        return faces[0] if faces else None

    def embed(self, image: np.ndarray, face: Face) -> np.ndarray:
        with self._lock:
            aligned = self._recognizer.alignCrop(image, face.row)
            return self._recognizer.feature(aligned).copy()

    def similarity(self, a: np.ndarray, b: np.ndarray) -> float:
        with self._lock:
            return float(self._recognizer.match(a, b, cv2.FaceRecognizerSF_FR_COSINE))

    def document_portrait(self, document: np.ndarray) -> tuple[np.ndarray, Face] | None:
        """
        The portrait on a document is small, so it is cut out with a margin, upscaled to at least 400 pixels
        and detected again for precise landmarks before alignment.
        """
        face = self.largest(document, min_score=0.6)
        if face is None:
            return None
        x, y, w, h = face.box
        margin = 0.6 * max(w, h)
        x0, y0 = max(0, int(x - margin)), max(0, int(y - margin))
        x1, y1 = min(document.shape[1], int(x + w + margin)), min(document.shape[0], int(y + h + margin))
        crop = document[y0:y1, x0:x1]
        factor = max(1.0, 400 / max(crop.shape[:2]))
        if factor > 1:
            crop = cv2.resize(crop, None, fx=factor, fy=factor, interpolation=cv2.INTER_CUBIC)
        refined = self.largest(crop, min_score=0.6)
        return (crop, refined) if refined is not None else None
