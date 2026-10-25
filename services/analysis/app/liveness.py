"""
Liveness from the face video: frames sampled with PyAV, each checked for a face, for the selfie's identity and
with passive anti-spoofing (Silent-Face-Anti-Spoofing MiniFASNetV2 and MiniFASNetV1SE, Apache-2.0).
"""

from __future__ import annotations

import io
import threading
from dataclasses import dataclass, field
from pathlib import Path

import av
import cv2
import numpy as np
import onnxruntime as ort

from .face import Face, FaceModels

MAX_FRAMES = 1800  # One minute at 30 fps; longer uploads are not a capture from the SDK.
# Model file, crop scale around the face box, as in minivision's test.py (both take 80 x 80 BGR, 0–255).
SPOOF_MODELS = [("MiniFASNetV2.onnx", 2.7), ("MiniFASNetV1SE.onnx", 4.0)]
REAL = 1  # Output classes: 0 print attack, 1 real face, 2 screen replay.


class InvalidVideo(ValueError):
    pass


def sample_frames(data: bytes, count: int) -> list[np.ndarray]:
    """About `count` evenly spaced BGR frames, decoded from memory."""
    try:
        with av.open(io.BytesIO(data), mode="r") as container:
            stream = container.streams.video[0]
            total = sum(1 for _ in container.decode(stream))
        if total == 0:
            raise InvalidVideo("The video has no frames.")
        if total > MAX_FRAMES:
            raise InvalidVideo("The video is too long.")
        wanted = set(np.linspace(0, total - 1, min(count, total)).round().astype(int).tolist())
        frames = []
        with av.open(io.BytesIO(data), mode="r") as container:
            for index, frame in enumerate(container.decode(container.streams.video[0])):
                if index in wanted:
                    frames.append(frame.to_ndarray(format="bgr24"))
        return frames
    except (av.FFmpegError, IndexError) as error:
        raise InvalidVideo("The video could not be decoded.") from error


def _crop(image: np.ndarray, box: tuple[float, float, float, float], scale: float) -> np.ndarray:
    """minivision's CropImage: the face box scaled about its centre, shifted to stay inside the frame."""
    src_h, src_w = image.shape[:2]
    x, y, w, h = box
    scale = min((src_h - 1) / h, (src_w - 1) / w, scale)
    new_w, new_h = w * scale, h * scale
    cx, cy = x + w / 2, y + h / 2
    left, top, right, bottom = cx - new_w / 2, cy - new_h / 2, cx + new_w / 2, cy + new_h / 2
    if left < 0:
        right, left = right - left, 0
    if top < 0:
        bottom, top = bottom - top, 0
    if right > src_w - 1:
        left, right = left - (right - src_w + 1), src_w - 1
    if bottom > src_h - 1:
        top, bottom = top - (bottom - src_h + 1), src_h - 1
    patch = image[int(top):int(bottom) + 1, int(left):int(right) + 1]
    return cv2.resize(patch, (80, 80))


class SpoofModels:
    def __init__(self, models_dir: Path):
        options = ort.SessionOptions()
        options.intra_op_num_threads = 1
        self._sessions = [(ort.InferenceSession(str(models_dir / name), options, providers=["CPUExecutionProvider"]), scale)
                          for name, scale in SPOOF_MODELS]
        self._lock = threading.Lock()

    def real_probability(self, image: np.ndarray, face: Face) -> float:
        """Mean real-face probability of the two models."""
        total = 0.0
        with self._lock:
            for session, scale in self._sessions:
                patch = _crop(image, face.box, scale).astype(np.float32).transpose(2, 0, 1)[None]
                logits = session.run(None, {session.get_inputs()[0].name: patch})[0][0]
                probabilities = np.exp(logits - logits.max())
                total += float(probabilities[REAL] / probabilities.sum())
        return total / len(self._sessions)


@dataclass
class LivenessCheck:
    score: float
    passed: bool
    frames_with_face: int
    frames_sampled: int
    failures: list[str] = field(default_factory=list)
    # SFace embeddings of the face in each frame that has one, for comparing with the document portrait.
    embeddings: list[np.ndarray] = field(default_factory=list)


def _motion(frames: list[np.ndarray]) -> float:
    """Mean absolute grey-level change between consecutive sampled frames at 160 px width."""
    small = [cv2.cvtColor(cv2.resize(frame, (160, max(1, round(frame.shape[0] * 160 / frame.shape[1])))), cv2.COLOR_BGR2GRAY)
             .astype(np.float32) for frame in frames]
    if len(small) < 2:
        return 0.0
    return float(np.mean([np.abs(a - b).mean() for a, b in zip(small, small[1:])]))


def check_liveness(frames: list[np.ndarray], selfie_embedding: np.ndarray | None, faces: FaceModels, spoof: SpoofModels, *,
                   match_threshold: float, threshold: float, min_frames: int, min_motion: float) -> LivenessCheck:
    """
    Passes when every sampled frame shows a face, every face is the selfie's person, the frames move (a replayed
    still image does not) and the mean anti-spoofing score reaches the threshold.
    """
    scores, embeddings, mismatched = [], [], 0
    for frame in frames:
        face = faces.largest(frame)
        if face is None:
            continue
        embedding = faces.embed(frame, face)
        embeddings.append(embedding)
        if selfie_embedding is not None and faces.similarity(embedding, selfie_embedding) < match_threshold:
            mismatched += 1
        scores.append(spoof.real_probability(frame, face))
    score = float(np.mean(scores)) if scores else 0.0
    with_face = len(embeddings)
    failures = []
    if len(frames) < min_frames:
        failures.append("liveness-too-few-frames")
    if with_face < len(frames) or with_face == 0:
        failures.append("liveness-face-missing")
    if selfie_embedding is None or mismatched:
        failures.append("liveness-identity-mismatch")
    if _motion(frames) < min_motion:
        failures.append("liveness-no-motion")
    if score < threshold:
        failures.append("liveness-spoof-suspected")
    return LivenessCheck(round(score, 4), not failures, with_face, len(frames), failures, embeddings)
