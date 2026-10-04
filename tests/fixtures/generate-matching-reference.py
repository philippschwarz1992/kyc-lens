"""Development only: pinned OpenCV 4.12.0 face pipeline, never needed by consumers."""
import hashlib
import json
from pathlib import Path
import sys

root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(root / ".cache" / "opencv-reference"))
import cv2
import numpy as np

if cv2.__version__ != "4.12.0":
    raise RuntimeError("Reference requires OpenCV 4.12.0")

fixture = root / "tests" / "fixtures"
image = cv2.imread(str(fixture / "astronaut.png"))
if image is None:
    raise RuntimeError("Missing permitted fixture")
detector = cv2.FaceDetectorYN.create(str(root / "assets" / "matching" / "face_detection_yunet_2023mar.onnx"), "", (640, 640), 0.8, 0.3, 5000)
recognizer = cv2.FaceRecognizerSF.create(str(root / "assets" / "matching" / "face_recognition_sface_2021dec.onnx"), "")
pad = np.zeros((640, 640, 3), dtype=np.uint8)
pad[:image.shape[0], :image.shape[1]] = image
_, faces = detector.detect(pad)
if faces is None or len(faces) != 1:
    raise RuntimeError(f"Expected one portrait, got {faces}")
face = faces[0]
crop = recognizer.alignCrop(image, face)
feature = recognizer.feature(crop)
adjusted = np.clip(image.astype(np.float32) * 0.85 + 15, 0, 255).astype(np.uint8)
cv2.imwrite(str(fixture / "astronaut-adjusted.png"), adjusted)
adjusted_pad = np.zeros((640, 640, 3), dtype=np.uint8)
adjusted_pad[:adjusted.shape[0], :adjusted.shape[1]] = adjusted
_, adjusted_faces = detector.detect(adjusted_pad)
if adjusted_faces is None or len(adjusted_faces) != 1:
    raise RuntimeError("Expected one adjusted portrait")
adjusted_crop = recognizer.alignCrop(adjusted, adjusted_faces[0])
adjusted_feature = recognizer.feature(adjusted_crop)
rgba = cv2.cvtColor(image, cv2.COLOR_BGR2RGBA)
crop_rgba = cv2.cvtColor(crop, cv2.COLOR_BGR2RGBA)
rgba.tofile(fixture / "astronaut.rgba")
crop_rgba.tofile(fixture / "astronaut-aligned.rgba")
grey = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
reference = {
    "reference": "OpenCV 4.12.0 opencv-python-headless 4.12.0.88",
    "source": "https://github.com/opencv/opencv/blob/4.12.0/modules/objdetect/src/face_recognize.cpp",
    "imageSha256": hashlib.sha256((fixture / "astronaut.png").read_bytes()).hexdigest(),
    "width": int(image.shape[1]), "height": int(image.shape[0]),
    "face": face.tolist(),
    "embedding": feature.flatten().tolist(),
    "identicalScore": float(recognizer.match(feature.copy(), feature.copy(), cv2.FaceRecognizerSF_FR_COSINE)),
    "rgbInputFirstPixel": cv2.dnn.blobFromImage(crop, 1, (112, 112), (0, 0, 0), True, False)[0, :, 0, 0].tolist(),
    "adjusted": {
        "filename": "astronaut-adjusted.png",
        "transform": "BGR uint8 = floor(clamp(float32(original) * 0.85 + 15, 0, 255))",
        "face": adjusted_faces[0].tolist(),
        "embedding": adjusted_feature.flatten().tolist(),
        "pairScore": float(recognizer.match(feature.copy(), adjusted_feature.copy(), cv2.FaceRecognizerSF_FR_COSINE)),
    },
}
(fixture / "astronaut-reference.json").write_text(json.dumps(reference, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"reference": reference["reference"], "face": reference["face"], "identicalScore": reference["identicalScore"], "adjustedPairScore": reference["adjusted"]["pairScore"]}))
