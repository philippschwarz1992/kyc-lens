"""Printed text and the machine-readable zone, read with RapidOCR (PP-OCRv4 ONNX models, Apache-2.0)."""

from __future__ import annotations

import re
import threading
import unicodedata
from dataclasses import dataclass
from typing import Iterable

import cv2
import numpy as np

from .mrz import DecodedMrz, read_mrz_lines
from .schema import DocumentType

_engine = None
_lock = threading.Lock()


def engine():
    global _engine
    with _lock:
        if _engine is None:
            from rapidocr_onnxruntime import RapidOCR
            _engine = RapidOCR()
        return _engine


@dataclass(frozen=True)
class OcrLine:
    text: str
    score: float
    # Axis-aligned bounds of the detected text box, in pixels of the image that was read.
    x0: float
    y0: float
    x1: float
    y1: float

    @property
    def height(self) -> float:
        return max(1.0, self.y1 - self.y0)


def read_boxes(image: np.ndarray) -> list[OcrLine]:
    """Text lines top to bottom, with the recognizer's confidence and where they are."""
    result, _ = engine()(image, use_cls=False)
    lines = []
    for box, text, score in result or []:
        xs, ys = [point[0] for point in box], [point[1] for point in box]
        lines.append(OcrLine(text, float(score), min(xs), min(ys), max(xs), max(ys)))
    return sorted(lines, key=lambda line: ((line.y0 + line.y1) / 2, line.x0))


def read_lines(image: np.ndarray) -> list[tuple[str, float]]:
    """Text lines top to bottom, with the recognizer's confidence."""
    return [(line.text, line.score) for line in read_boxes(image)]


def _width(image: np.ndarray, width: int) -> np.ndarray:
    return cv2.resize(image, (width, max(1, round(image.shape[0] * width / image.shape[1]))), interpolation=cv2.INTER_AREA
                      if image.shape[1] > width else cv2.INTER_CUBIC)


def _sharpen(image: np.ndarray) -> np.ndarray:
    return cv2.addWeighted(image, 2.5, cv2.GaussianBlur(image, (0, 0), 2), -1.5, 0)


def _better(a: DecodedMrz | None, b: DecodedMrz | None) -> DecodedMrz | None:
    if a is None or b is None:
        return a or b
    return a if (a.summary.valid, a.confidence) >= (b.summary.valid, b.confidence) else b


def read_mrz(document: np.ndarray, full_text: Iterable[tuple[str, float]] = ()) -> DecodedMrz | None:
    """
    The zone sits in the bottom third of a passport photo page or the back of an identity card. The band is
    sharpened (photographed OCR-B is usually soft) and read on its own; the full-page read and an upside-down
    band are fallbacks. The first fully valid read wins.
    """
    best = read_mrz_lines(list(full_text))
    if best is not None and best.summary.valid:
        return best
    page = _width(document, 1000)
    height = page.shape[0]
    for view in (page, cv2.rotate(page, cv2.ROTATE_180)):
        band = view[int(height * 0.55):]
        for variant in (_sharpen(band), band):
            best = _better(best, read_mrz_lines(read_lines(variant)))
            if best is not None and best.summary.valid:
                return best
    return best


def fold(text: str) -> str:
    """Upper case without diacritics, transliterated as in the MRZ: FÜHRERSCHEIN becomes FUEHRERSCHEIN."""
    text = text.upper().replace("Ü", "UE").replace("Ä", "AE").replace("Ö", "OE").replace("ß", "SS").replace("ẞ", "SS")
    return "".join(char for char in unicodedata.normalize("NFKD", text) if not unicodedata.combining(char))


_KEYWORDS: list[tuple[DocumentType, re.Pattern[str]]] = [
    ("passport", re.compile(r"PASSPORT|REISEPASS|PASSEPORT|PASAPORTE|PASSAPORTO")),
    ("drivers-license", re.compile(r"F(UE|U)?HRERSCHEIN|DRIVING\s*LICEN[CS]E|DRIVER'?S?\s*LICEN[CS]E|PERMIS\s*DE\s*CONDUIRE")),
    ("id-card", re.compile(r"PERSONALAUSWEIS|IDENTITY\s*CARD|CARTE\s*D'?\s*IDENTITE|IDENTITEITSKAART|DOCUMENTO\s*DE\s*IDENTIDAD")),
]


def type_from_text(text: str) -> DocumentType | None:
    """The document type from printed keywords; the earliest keyword on the page wins."""
    folded = fold(text)
    hits = [(match.start(), kind) for kind, pattern in _KEYWORDS if (match := pattern.search(folded))]
    return min(hits)[1] if hits else None
