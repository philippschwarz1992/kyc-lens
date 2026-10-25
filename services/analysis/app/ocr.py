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
    The zone of an upright document: at the bottom of a passport data page (also of an open booklet held
    upright, whose data page is its lower half) or of an identity card's back. The full-page read comes first; then
    the bottom band is sharpened (photographed OCR-B is usually soft) and read on its own. The first fully valid
    read wins. read_side finds which way up the document is.
    """
    best = read_mrz_lines(list(full_text))
    if best is not None and best.summary.valid:
        return best
    page = _width(document, 1000)
    band = page[int(page.shape[0] * 0.55):]
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


@dataclass(frozen=True)
class SideRead:
    """One document photo turned upright, with its text lines and machine-readable zone."""
    image: np.ndarray
    lines: list[OcrLine]
    mrz: DecodedMrz | None


def _horizontal(lines: list[OcrLine]) -> bool:
    """Most lines of five or more characters are wider than tall."""
    words = [line for line in lines if len(line.text) >= 5]
    return bool(words) and sum(line.x1 - line.x0 > line.y1 - line.y0 for line in words) > len(words) / 2


# As photographed first, then upside down, then sideways.
_ROTATIONS = (None, cv2.ROTATE_180, cv2.ROTATE_90_CLOCKWISE, cv2.ROTATE_90_COUNTERCLOCKWISE)


def read_side(document: np.ndarray, expect_mrz: bool = True) -> SideRead:
    """
    Reads a document photo in the orientation where it is upright. The shape cannot tell: a card is landscape,
    but an open passport held upright is portrait. So the four rotations are read in turn until one shows a
    valid zone or, for documents without one (`expect_mrz` false), a document-type keyword. Otherwise the best
    zone read wins, then the rotation with the most confidently read text.
    """
    best: SideRead | None = None
    best_key: tuple = ()
    for rotation in _ROTATIONS:
        image = document if rotation is None else cv2.rotate(document, rotation)
        lines = read_boxes(image)
        read = SideRead(image, lines, read_mrz(image, [(line.text, line.score) for line in lines]))
        # RapidOCR turns tall text boxes before reading them, so sideways text reads well: only a view whose
        # text runs horizontally is upright.
        upright = _horizontal(lines)
        if upright and read.mrz is not None and read.mrz.summary.valid:
            return read
        if upright and not expect_mrz and type_from_text(" ".join(line.text for line in lines)):
            return read
        key = (upright, read.mrz is not None, read.mrz.confidence if read.mrz else 0.0,
               sum(line.score * len(line.text) for line in lines if line.score >= 0.8))
        if best is None or key > best_key:
            best, best_key = read, key
    return best
