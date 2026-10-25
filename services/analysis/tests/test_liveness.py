from app.config import get_settings
from app.document import decode_image
from app.liveness import InvalidVideo, check_liveness, sample_frames
from tests.fixtures import face, still_video

SELFIE = "collins-portrait.jpg"


def run(analyzer, video: bytes):
    settings = get_settings()
    selfie = decode_image(face(SELFIE))
    embedding = analyzer.faces.embed(selfie, analyzer.faces.largest(selfie))
    try:
        frames = sample_frames(video, settings.liveness_frames)
    except InvalidVideo:
        frames = []
    return check_liveness(frames, embedding, analyzer.faces, analyzer.spoof, match_threshold=settings.face_match_threshold,
                          threshold=settings.liveness_threshold, min_frames=settings.liveness_min_frames,
                          min_motion=settings.liveness_min_motion)


def test_samples_about_eight_frames():
    assert len(sample_frames(still_video(face(SELFIE), frames=45), 8)) == 8
    assert len(sample_frames(still_video(face(SELFIE), frames=3), 8)) == 3


def test_a_still_image_fails_liveness(analyzer):
    check = run(analyzer, still_video(face(SELFIE)))
    # The face is there and is the selfie's person, but nothing moves.
    assert check.frames_with_face == check.frames_sampled == 8
    assert not check.passed
    assert "liveness-no-motion" in check.failures
    assert "liveness-identity-mismatch" not in check.failures


def test_a_photo_uploaded_as_video_fails(analyzer):
    check = run(analyzer, face(SELFIE))
    assert not check.passed
    assert "liveness-too-few-frames" in check.failures


def test_someone_else_in_the_video_fails(analyzer):
    check = run(analyzer, still_video(face("ride-portrait.jpg")))
    assert not check.passed
    assert "liveness-identity-mismatch" in check.failures
