# Third-party models and components

The analysis service's own code is MIT-licensed like the rest of kyc-lens. The models it runs keep their own
licences. `scripts/fetch_models.py` downloads each one at image build, checks it against a pinned SHA-256 and
copies the full licence texts to `/usr/share/licenses/kyc-lens-analysis/` in the image. Every model is licensed
for commercial use. InsightFace models are licensed for non-commercial research only and are not used.

| Model | Purpose | Licence | Source |
| --- | --- | --- | --- |
| `face_detection_yunet_2023mar.onnx` | Face detection (YuNet) | MIT | [OpenCV Zoo](https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet) |
| `face_recognition_sface_2021dec.onnx` | Face embeddings (SFace) | Apache-2.0 | [OpenCV Zoo](https://github.com/opencv/opencv_zoo/tree/main/models/face_recognition_sface) |
| `MiniFASNetV2.onnx`, `MiniFASNetV1SE.onnx` | Passive anti-spoofing | Apache-2.0 | Weights by [minivision-ai/Silent-Face-Anti-Spoofing](https://github.com/minivision-ai/Silent-Face-Anti-Spoofing/tree/b6d5f04ad78778917853b25c778acef6d5626d15/resources/anti_spoof_models); ONNX export from [yakhyo/face-anti-spoofing](https://github.com/yakhyo/face-anti-spoofing/releases/tag/weights) (Apache-2.0) |
| PP-OCRv4 detection and recognition | Printed text and MRZ | Apache-2.0 | [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR), bundled in [RapidOCR](https://github.com/RapidAI/RapidOCR) `rapidocr-onnxruntime` 1.4.4 (Apache-2.0) |

YuNet and SFace use the same URLs, sizes and hashes as the SDK's `scripts/matching-assets.mjs`. The provenance of
SFace's training data is discussed in [opencv_zoo#313](https://github.com/opencv/opencv_zoo/issues/313).

The anti-spoofing ONNX files are third-party exports. Before they were adopted they were checked against
minivision's original PyTorch weights (`2.7_80x80_MiniFASNetV2.pth`, SHA-256 `a5eb02e1…bec0`, and
`4_0_0_80x80_MiniFASNetV1SE.pth`, SHA-256 `84ee1d37…5990`, at commit `b6d5f04`): on random 80 × 80 inputs the
softmax outputs agree within 2 × 10⁻⁷. The ONNX files return logits; preprocessing follows minivision's `test.py`
(BGR, 0–255, no normalisation, class 1 = real face).

Runtime libraries: FastAPI and Starlette (MIT), Uvicorn (BSD-3-Clause), Pydantic (MIT), python-multipart (Apache-2.0),
Pillow (MIT-CMU), NumPy (BSD-3-Clause), OpenCV `opencv-python-headless` (Apache-2.0; the wheel bundles FFmpeg under
LGPL), PyAV (BSD-3-Clause; the wheel bundles FFmpeg under LGPL), ONNX Runtime (MIT).
