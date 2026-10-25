"""Helpers that turn the synthetic fixtures into image bytes."""

from __future__ import annotations

import base64
import gzip
import io
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

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


# The printed data of the ICAO 9303 specimen passport, laid out as label above value: (x, y, label, value).
SPECIMEN_PRINTED = [
    (150, 280, "Surname/Name", "ERIKSSON"), (450, 280, "Passport No./Pass-Nr.", "L898902C3"),
    (150, 335, "Given names/Vornamen", "ANNA MARIA"),
    (150, 390, "Nationality/Staatsangehörigkeit", "UTOPIAN"),
    (150, 445, "Date of birth/Geburtstag", "12 AUG 1974"), (450, 445, "Sex/Geschlecht", "F"),
    (150, 500, "Place of birth/Geburtsort", "ZENITH"),
    (150, 555, "Date of issue", "16 APR 2007"), (450, 555, "Date of expiry/Gültig bis", "15 APR 2012"),
]


def passport_photo(portrait: str = "astronaut.png", printed: list[tuple[int, int, str, str]] | None = None) -> bytes:
    """
    The TD3 specimen photo as a passport data page, as JPEG: the printed data (SPECIMEN_PRINTED unless given) in
    place of the photo's filler text, and a public-domain portrait in its empty right half.
    """
    page = mrz_fixture("mrz-td3")["image"].convert("RGB")
    draw = ImageDraw.Draw(page)
    draw.rectangle((140, 265, 720, 615), fill=(214, 214, 214))
    small, large = ImageFont.load_default(size=15), ImageFont.load_default(size=22)
    for x, y, label, value in SPECIMEN_PRINTED if printed is None else printed:
        draw.text((x, y), label, fill=(90, 90, 90), font=small)
        draw.text((x, y + 19), value, fill=(25, 25, 25), font=large)
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


# EU driving licence front (numbered fields), without a machine-readable zone.
LICENCE_PRINTED = ["1. MUSTERMANN", "2. ERIKA", "3. 12.08.1964 BERLIN", "4a. 20.01.2013", "4b. 19.01.2028", "4c. STADT KOELN",
                   "5. B072RRE2955"]


def licence_photo(portrait: str = "astronaut.png") -> bytes:
    """A driving licence card photographed on a dark table, as JPEG."""
    photo = Image.new("RGB", (1200, 850), (45, 45, 48))
    draw = ImageDraw.Draw(photo)
    draw.rectangle((100, 100, 1100, 730), fill=(222, 226, 222))
    title, field = ImageFont.load_default(size=30), ImageFont.load_default(size=26)
    draw.text((420, 130), "FÜHRERSCHEIN", fill=(30, 60, 120), font=title)
    for index, line in enumerate(LICENCE_PRINTED):
        draw.text((440, 220 + index * 62), line, fill=(25, 25, 25), font=field)
    with Image.open(FIXTURES / portrait) as source:
        face = source.convert("RGB").crop((130, 10, 320, 240)).resize((250, 303), Image.LANCZOS)
    photo.paste(face, (140, 240))
    return encode(photo, "JPEG")
