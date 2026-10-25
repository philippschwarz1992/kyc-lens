"""Image decoding, document outline rectification and photo quality."""

from __future__ import annotations

import io

import cv2
import numpy as np
from PIL import Image, ImageOps

from .config import Settings
from .schema import Quality

# Refuse decompression bombs well below Pillow's default.
Image.MAX_IMAGE_PIXELS = 40_000_000
WORK_WIDTH = 1000


class InvalidImage(ValueError):
    pass


def decode_image(data: bytes, max_side: int = 2400) -> np.ndarray:
    """JPEG, PNG or WebP bytes as a BGR array, upright per EXIF and at most `max_side` pixels on its long side."""
    try:
        with Image.open(io.BytesIO(data)) as image:
            image = ImageOps.exif_transpose(image).convert("RGB")
            image.thumbnail((max_side, max_side), Image.LANCZOS)
            rgb = np.asarray(image)
    except (OSError, ValueError, Image.DecompressionBombError) as error:
        raise InvalidImage("The image could not be decoded.") from error
    return cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)


def _order(corners: np.ndarray) -> np.ndarray:
    """Top-left, top-right, bottom-right, bottom-left."""
    sums, diffs = corners.sum(1), np.diff(corners, axis=1).ravel()
    return np.float32([corners[sums.argmin()], corners[diffs.argmin()], corners[sums.argmax()], corners[diffs.argmax()]])


def find_outline(image: np.ndarray) -> np.ndarray | None:
    """The four corners of the largest convex quadrilateral that covers at least a fifth of the photo."""
    scale = 800 / max(image.shape[:2])
    small = cv2.resize(image, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA) if scale < 1 else image
    scale = min(scale, 1.0)
    gray = cv2.GaussianBlur(cv2.cvtColor(small, cv2.COLOR_BGR2GRAY), (5, 5), 0)
    edges = cv2.dilate(cv2.Canny(gray, 30, 90), np.ones((3, 3), np.uint8), iterations=2)
    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    area = gray.shape[0] * gray.shape[1]
    for contour in sorted(contours, key=cv2.contourArea, reverse=True)[:5]:
        if cv2.contourArea(contour) < area * 0.2:
            break
        hull = cv2.convexHull(contour)
        approx = cv2.approxPolyDP(hull, 0.02 * cv2.arcLength(hull, True), True)
        if len(approx) == 4:
            return _order(approx.reshape(4, 2).astype(np.float32) / scale)
    return None


def rectify(image: np.ndarray) -> tuple[np.ndarray, bool]:
    """The document flattened to its outline, or the full photo when no outline is found."""
    corners = find_outline(image)
    if corners is None:
        return image, False
    tl, tr, br, bl = corners
    width = int(max(np.linalg.norm(tr - tl), np.linalg.norm(br - bl)))
    height = int(max(np.linalg.norm(bl - tl), np.linalg.norm(br - tr)))
    if width < 100 or height < 60:
        return image, False
    target = np.float32([[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]])
    # The outline's shape does not say which way up the document is: an open passport held upright is portrait.
    # ocr.read_side turns it upright.
    return cv2.warpPerspective(image, cv2.getPerspectiveTransform(corners, target), (width, height), flags=cv2.INTER_CUBIC), True


def measure_quality(document: np.ndarray, rectified: bool, settings: Settings) -> Quality:
    gray = cv2.cvtColor(document, cv2.COLOR_BGR2GRAY)
    gray = cv2.resize(gray, (WORK_WIDTH, max(1, round(gray.shape[0] * WORK_WIDTH / gray.shape[1]))), interpolation=cv2.INTER_AREA)
    sharpness = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    glare = float((gray >= 250).mean())
    brightness = float(gray.mean())
    issues = []
    if sharpness < settings.quality_min_sharpness:
        issues.append("blurry")
    if glare > settings.quality_max_glare:
        issues.append("glare")
    if brightness < settings.quality_min_brightness:
        issues.append("too-dark")
    if brightness > settings.quality_max_brightness:
        issues.append("too-bright")
    return Quality(sharpness=round(sharpness, 1), glare=round(glare, 4), brightness=round(brightness, 1),
                   rectified=rectified, acceptable=not issues, issues=issues)
