from dataclasses import replace
from datetime import date

from app.config import get_settings
from app.pipeline import Uploads
from app.schema import Metadata
from tests.fixtures import face, passport_photo

METADATA = Metadata.model_validate({"document": {"type": "passport"}})
BEFORE_EXPIRY = date(2011, 1, 1)  # The ICAO specimen expires on 2012-04-15.


def uploads(selfie="collins-portrait.jpg"):
    return Uploads(passport_photo(), face(selfie), METADATA)


def test_approves_a_valid_unexpired_passport_with_a_matching_face(analyzer):
    result = analyzer.analyze(uploads(), replace(get_settings(), require_liveness=False), today=BEFORE_EXPIRY)
    assert (result.status, result.reasons) == ("approved", [])


def test_sends_a_missing_video_to_review(analyzer):
    result = analyzer.analyze(uploads(), get_settings(), today=BEFORE_EXPIRY)
    assert (result.status, result.reasons, result.liveness) == ("review", ["liveness-missing"], None)


def test_rejects_an_expired_document(analyzer):
    result = analyzer.analyze(uploads(), replace(get_settings(), require_liveness=False), today=date(2026, 10, 25))
    assert (result.status, result.reasons) == ("rejected", ["document-expired"])


def test_thresholds_come_from_the_environment(analyzer, monkeypatch):
    monkeypatch.setenv("FACE_MATCH_THRESHOLD", "0.99")
    monkeypatch.setenv("REQUIRE_LIVENESS", "false")
    result = analyzer.analyze(uploads(), get_settings(), today=BEFORE_EXPIRY)
    assert result.faceMatch.threshold == 0.99
    assert (result.status, result.reasons) == ("rejected", ["face-mismatch"])


def test_compares_the_document_portrait_with_the_live_face_in_the_video(analyzer):
    from tests.fixtures import still_video

    same = analyzer.analyze(Uploads(passport_photo(), face("collins-portrait.jpg"), METADATA,
                                    face_video=still_video(face("collins-portrait.jpg"))), get_settings(), today=BEFORE_EXPIRY)
    assert same.liveFaceMatch.decision == "match"
    assert same.liveFaceMatch.framesCompared == same.liveFaceMatch.framesMatched == 8
    assert "live-face-mismatch" not in same.reasons

    # Someone else in front of the camera: the selfie still matches the document, the video does not.
    other = analyzer.analyze(Uploads(passport_photo(), face("collins-portrait.jpg"), METADATA,
                                     face_video=still_video(face("ride-portrait.jpg"))), get_settings(), today=BEFORE_EXPIRY)
    assert other.faceMatch.decision == "match"
    assert other.liveFaceMatch.decision == "no-match" and other.liveFaceMatch.framesMatched == 0
    assert other.status == "rejected" and "live-face-mismatch" in other.reasons


def test_no_live_face_match_without_a_video(analyzer):
    assert analyzer.analyze(uploads(), get_settings(), today=BEFORE_EXPIRY).liveFaceMatch is None
