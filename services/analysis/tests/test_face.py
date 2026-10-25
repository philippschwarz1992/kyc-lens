from app.config import get_settings
from app.document import decode_image
from tests.fixtures import encode, face, mrz_fixture, passport_photo

# Public-domain NASA photographs (see tests/fixtures/NOTICE.md): two different photos of Eileen Collins and one of Sally Ride.
SAME_A, SAME_B, OTHER = "astronaut.png", "collins-portrait.jpg", "ride-portrait.jpg"


def embedding(analyzer, name):
    image = decode_image(face(name))
    found = analyzer.faces.largest(image)
    assert found is not None
    return analyzer.faces.embed(image, found)


def test_same_person_matches_and_a_different_person_does_not(analyzer):
    threshold = get_settings().face_match_threshold
    same = analyzer.faces.similarity(embedding(analyzer, SAME_A), embedding(analyzer, SAME_B))
    other = analyzer.faces.similarity(embedding(analyzer, SAME_A), embedding(analyzer, OTHER))
    assert same >= threshold > other
    assert same - other > 0.3


def test_matches_the_upscaled_document_portrait(analyzer):
    portrait = analyzer.faces.document_portrait(decode_image(passport_photo()))
    assert portrait is not None and max(portrait[0].shape[:2]) >= 400
    document = analyzer.faces.embed(*portrait)
    threshold = get_settings().face_match_threshold
    assert analyzer.faces.similarity(document, embedding(analyzer, SAME_B)) >= threshold
    assert analyzer.faces.similarity(document, embedding(analyzer, OTHER)) < threshold


def test_finds_no_portrait_on_a_document_without_one(analyzer):
    assert analyzer.faces.document_portrait(decode_image(encode(mrz_fixture("mrz-td1")["image"]))) is None
