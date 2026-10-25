"""Helpers that turn the synthetic fixtures into image bytes."""

from __future__ import annotations

import base64
import gzip
import io
import json
from pathlib import Path

import numpy as np
from PIL import Image

FIXTURES = Path(__file__).parent / "fixtures"


def mrz_fixture(name: str) -> dict:
    """A photographed ICAO specimen from the SDK (gzip+base64 grayscale) with its expected lines and corners."""
    data = json.loads((FIXTURES / f"{name}.json").read_text(encoding="utf-8"))
    gray = np.frombuffer(gzip.decompress(base64.b64decode(data["gray"])), dtype=np.uint8)
    data["image"] = Image.fromarray(gray.reshape(data["height"], data["width"]), "L")
    return data


def encode(image: Image.Image, format: str = "PNG") -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, format=format)
    return buffer.getvalue()


def face(name: str) -> bytes:
    return (FIXTURES / name).read_bytes()


def passport_photo(portrait: str = "astronaut.png") -> bytes:
    """The TD3 specimen photo with a public-domain portrait pasted into its empty right half, as JPEG."""
    page = mrz_fixture("mrz-td3")["image"].convert("RGB")
    with Image.open(FIXTURES / portrait) as source:
        face = source.convert("L").crop((130, 10, 320, 240)).resize((210, 254), Image.LANCZOS).convert("RGB")
    page.paste(face, (730, 270))
    return encode(page, "JPEG")


def still_video(image: bytes, frames: int = 30, codec: str = "mpeg4") -> bytes:
    """A video that shows one photo for one second: a replayed still image."""
    import av

    with Image.open(io.BytesIO(image)) as source:
        picture = np.asarray(source.convert("RGB").resize((320, 320)))
    buffer = io.BytesIO()
    with av.open(buffer, mode="w", format="mp4") as container:
        stream = container.add_stream(codec, rate=30)
        stream.width, stream.height, stream.pix_fmt = 320, 320, "yuv420p"
        for _ in range(frames):
            for packet in stream.encode(av.VideoFrame.from_ndarray(picture, format="rgb24")):
                container.mux(packet)
        for packet in stream.encode():
            container.mux(packet)
    return buffer.getvalue()
