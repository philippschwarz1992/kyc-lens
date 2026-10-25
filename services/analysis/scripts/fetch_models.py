"""Download the face and liveness models and their licences, verifying every file against a pinned SHA-256.

Usage: python scripts/fetch_models.py [target-directory]   (default: $MODELS_DIR or ./models)

Files that are already present are re-verified instead of downloaded again. Every model here is licensed
for commercial use; InsightFace models are not, and must not be added.
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
import urllib.request
from pathlib import Path

ZOO = "https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models"
ZOO_COMMIT = "48b10fa505aeb51fbd127fc60a5c660040e823b7"
FAS_COMMIT = "b6d5f04ad78778917853b25c778acef6d5626d15"  # minivision-ai/Silent-Face-Anti-Spoofing
FAS_ONNX_COMMIT = "01a38903f4f2680bb59d32a994a6c7b5ae56f49b"  # yakhyo/face-anti-spoofing
FAS_ONNX = "https://github.com/yakhyo/face-anti-spoofing/releases/download/weights"

# Same URLs, sizes and hashes as scripts/matching-assets.mjs in the SDK.
MODELS = [
    {"name": "face_detection_yunet_2023mar.onnx", "url": f"{ZOO}/face_detection_yunet/face_detection_yunet_2023mar.onnx",
     "size": 232589, "sha256": "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4", "license": "MIT",
     "source": "https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet"},
    {"name": "face_recognition_sface_2021dec.onnx", "url": f"{ZOO}/face_recognition_sface/face_recognition_sface_2021dec.onnx",
     "size": 38696353, "sha256": "0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79", "license": "Apache-2.0",
     "source": "https://github.com/opencv/opencv_zoo/tree/main/models/face_recognition_sface"},
    # ONNX exports of minivision's 2.7_80x80_MiniFASNetV2.pth and 4_0_0_80x80_MiniFASNetV1SE.pth (Apache-2.0).
    # Checked against the original PyTorch weights at FAS_COMMIT: softmax outputs agree within 2e-7.
    {"name": "MiniFASNetV2.onnx", "url": f"{FAS_ONNX}/MiniFASNetV2.onnx",
     "size": 1743581, "sha256": "b32929adc2d9c34b9486f8c4c7bc97c1b69bc0ea9befefc380e4faae4e463907", "license": "Apache-2.0",
     "source": f"https://github.com/minivision-ai/Silent-Face-Anti-Spoofing/tree/{FAS_COMMIT}/resources/anti_spoof_models"},
    {"name": "MiniFASNetV1SE.onnx", "url": f"{FAS_ONNX}/MiniFASNetV1SE.onnx",
     "size": 1742335, "sha256": "ebab7f90c7833fbccd46d3a555410e78d969db5438e169b6524be444862b3676", "license": "Apache-2.0",
     "source": f"https://github.com/minivision-ai/Silent-Face-Anti-Spoofing/tree/{FAS_COMMIT}/resources/anti_spoof_models"},
]

LICENSES = [
    {"name": "face_detection_yunet-LICENSE.txt", "sha256": "c83b8120c50ccbd4c4f96edf53141bdd566ebb8f8e9227e415326aa1b1aba958",
     "url": f"https://raw.githubusercontent.com/opencv/opencv_zoo/{ZOO_COMMIT}/models/face_detection_yunet/LICENSE"},
    {"name": "face_recognition_sface-LICENSE.txt", "sha256": "cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30",
     "url": f"https://raw.githubusercontent.com/opencv/opencv_zoo/{ZOO_COMMIT}/models/face_recognition_sface/LICENSE"},
    {"name": "Silent-Face-Anti-Spoofing-LICENSE.txt", "sha256": "daf94bf1dc9cc5700fe5af2c7c0cbd1836e70d509ed78fd0bebef7432edee6fb",
     "url": f"https://raw.githubusercontent.com/minivision-ai/Silent-Face-Anti-Spoofing/{FAS_COMMIT}/LICENSE"},
    {"name": "face-anti-spoofing-onnx-LICENSE.txt", "sha256": "c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4",
     "url": f"https://raw.githubusercontent.com/yakhyo/face-anti-spoofing/{FAS_ONNX_COMMIT}/LICENSE"},
    # RapidOCR ships the PP-OCRv4 detection and recognition models inside its wheel.
    {"name": "RapidOCR-LICENSE.txt", "sha256": "3e0af25fdd06aa9586ae97adb00ea927ebe5a3805ac77d2d3a81ce5f55693333",
     "url": "https://raw.githubusercontent.com/RapidAI/RapidOCR/v1.4.4/LICENSE"},
    {"name": "PaddleOCR-LICENSE.txt", "sha256": "ff6311c56c1b22c9209c96cc8afc16da91c24ee55a15e14ebc46fe1960dbd856",
     "url": "https://raw.githubusercontent.com/PaddlePaddle/PaddleOCR/v2.7.0/LICENSE"},
]


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def fetch(destination: Path, url: str, digest: str, size: int | None = None) -> None:
    if destination.exists():
        data = destination.read_bytes()
    else:
        print(f"Downloading {destination.name}", flush=True)
        request = urllib.request.Request(url, headers={"User-Agent": "kyc-lens-analysis/fetch_models"})
        with urllib.request.urlopen(request, timeout=180) as response:
            data = response.read()
    if sha256(data) != digest or (size is not None and len(data) != size):
        raise SystemExit(f"Checksum or size mismatch: {destination.name} from {url}")
    if not destination.exists():
        destination.write_bytes(data)


def fetch_all(target: Path) -> None:
    (target / "licenses").mkdir(parents=True, exist_ok=True)
    for model in MODELS:
        fetch(target / model["name"], model["url"], model["sha256"], model["size"])
    for notice in LICENSES:
        fetch(target / "licenses" / notice["name"], notice["url"], notice["sha256"])
    manifest = {
        "models": [{key: value for key, value in model.items() if key != "url"} | {"url": model["url"]} for model in MODELS],
        "ocr": "RapidOCR PP-OCRv4 models bundled in the rapidocr-onnxruntime wheel (Apache-2.0).",
        "limitations": "Thresholds need calibration on your own data. SFace training-data provenance is discussed in "
                       "https://github.com/opencv/opencv_zoo/issues/313.",
    }
    (target / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"Models verified in {target}")


if __name__ == "__main__":
    fetch_all(Path(sys.argv[1] if len(sys.argv) > 1 else os.environ.get("MODELS_DIR") or Path(__file__).resolve().parent.parent / "models"))
