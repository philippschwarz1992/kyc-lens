import json

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.schema import VerificationResult
from tests.fixtures import face, passport_photo, still_video

SECRET = "test-secret"
HEADERS = {"X-Analysis-Secret": SECRET}
METADATA = {"challenges": [{"challenge": "turn-left", "completedAt": 1}], "capturedAt": "2026-10-25T10:00:00.000Z",
            "mode": "document-and-face", "document": {"type": "passport", "mrz": {"format": "TD3", "kind": "passport", "valid": True}}}


@pytest.fixture(scope="module")
def client(models):
    with pytest.MonkeyPatch.context() as patch:
        patch.setenv("ANALYSIS_SECRET", SECRET)
        with TestClient(app) as client:
            yield client


def files(selfie="collins-portrait.jpg", video=True):
    parts = {
        "documentFront": ("document-front.jpg", passport_photo(), "image/jpeg"),
        "selfie": ("selfie.jpg", face(selfie), "image/jpeg"),
        "metadata": (None, json.dumps(METADATA)),
    }
    if video:
        parts["faceVideo"] = ("face-video.mp4", still_video(face(selfie)), "video/mp4")
    return parts


def test_health(client):
    assert client.get("/health").json() == {"status": "ok", "ready": True}


@pytest.mark.parametrize("headers", [{}, {"X-Analysis-Secret": "wrong"}])
def test_requires_the_shared_secret(client, headers):
    response = client.post("/analyze", files=files(video=False), headers=headers)
    assert response.status_code == 401
    assert "error" in response.json()


def test_refuses_when_no_secret_is_configured(client, monkeypatch):
    monkeypatch.delenv("ANALYSIS_SECRET")
    assert client.post("/analyze", files=files(video=False), headers={"X-Analysis-Secret": ""}).status_code == 503


def test_rejects_missing_fields_and_bad_uploads(client):
    parts = files(video=False)
    del parts["selfie"]
    assert client.post("/analyze", files=parts, headers=HEADERS).status_code == 400
    assert client.post("/analyze", files=files(video=False) | {"metadata": (None, "{")}, headers=HEADERS).status_code == 400
    broken = files(video=False) | {"documentFront": ("document-front.jpg", b"not an image", "image/jpeg")}
    assert client.post("/analyze", files=broken, headers=HEADERS).status_code == 422


def test_rejects_oversized_uploads(client, monkeypatch):
    monkeypatch.setenv("MAX_UPLOAD_BYTES", "1000")
    assert client.post("/analyze", files=files(video=False), headers=HEADERS).status_code == 413


def test_returns_a_verification_result(client):
    response = client.post("/analyze", files=files(), headers=HEADERS)
    assert response.status_code == 200
    result = VerificationResult.model_validate(response.json())
    assert result.document.type == "passport"
    assert result.document.mrz.valid and result.document.mrz.fields.documentNumber == "L898902C3"
    assert result.faceMatch.decision == "match"
    assert result.liveFaceMatch.decision == "match"
    assert result.liveness.decision == "fail"
    # The ICAO specimen expired in 2012 and the video is a still image.
    assert result.status == "rejected"
    assert {"document-expired", "liveness-failed", "liveness-no-motion"} <= set(result.reasons)


def test_a_different_person_is_rejected(client):
    result = client.post("/analyze", files=files(selfie="ride-portrait.jpg", video=False), headers=HEADERS).json()
    assert result["faceMatch"]["decision"] == "no-match"
    assert "face-mismatch" in result["reasons"]
    assert result["status"] == "rejected"
