import cv2
import numpy as np
import pytest

from app.config import get_settings
from app.document import decode_image, measure_quality, rectify
from app.mrz import summarize_mrz
from app.ocr import read_lines, read_mrz, read_side, type_from_text
from app.pipeline import Uploads
from app.schema import Metadata
from tests.fixtures import encode, face, mrz_fixture, passport_photo


@pytest.mark.parametrize("name", ["mrz-td3", "mrz-td1"])
def test_reads_the_zone_from_the_photographed_specimen(name):
    fixture = mrz_fixture(name)
    document, rectified = rectify(decode_image(encode(fixture["image"])))
    assert rectified
    decoded = read_mrz(document, read_lines(document))
    assert decoded.lines == fixture["lines"]
    assert decoded.summary == summarize_mrz(fixture["lines"])
    assert decoded.summary.valid


@pytest.mark.parametrize("rotation", [cv2.ROTATE_180, cv2.ROTATE_90_CLOCKWISE, cv2.ROTATE_90_COUNTERCLOCKWISE])
def test_turns_the_document_upright(rotation):
    fixture = mrz_fixture("mrz-td3")
    document, _ = rectify(cv2.rotate(decode_image(encode(fixture["image"])), rotation))
    read = read_side(document)
    assert read.mrz.lines == fixture["lines"]
    assert read.image.shape[1] > read.image.shape[0]  # The data page is landscape once upright.


def test_keeps_an_upright_booklet_upright():
    from tests.fixtures import booklet_photo

    document, rectified = rectify(decode_image(booklet_photo()))
    assert rectified and document.shape[0] > document.shape[1]
    read = read_side(document)
    assert read.image is document
    assert read.mrz.summary.valid


def test_finds_no_zone_on_a_blank_page():
    blank = np.full((400, 600, 3), 230, np.uint8)
    assert read_mrz(blank, read_lines(blank)) is None


def test_rectifies_the_outline_and_falls_back_to_the_full_photo():
    fixture = mrz_fixture("mrz-td1")
    corners = np.array([[point["x"], point["y"]] for point in fixture["corners"]])
    document, rectified = rectify(decode_image(encode(fixture["image"])))
    width = np.linalg.norm(corners[1] - corners[0])
    assert rectified and abs(document.shape[1] - width) < width * 0.05
    plain = np.full((300, 400, 3), 128, np.uint8)
    image, rectified = rectify(plain)
    assert image is plain and not rectified


def test_measures_blur_glare_and_brightness():
    settings = get_settings()
    sharp, _ = rectify(decode_image(encode(mrz_fixture("mrz-td3")["image"])))
    assert measure_quality(sharp, True, settings).acceptable
    assert "blurry" in measure_quality(cv2.GaussianBlur(sharp, (0, 0), 6), True, settings).issues
    glare = sharp.copy()
    glare[:, : glare.shape[1] // 3] = 255
    assert "glare" in measure_quality(glare, True, settings).issues
    assert "too-dark" in measure_quality((sharp * 0.2).astype(np.uint8), True, settings).issues


class TestTypeDetection:
    @pytest.mark.parametrize("text, expected", [
        ("BUNDESREPUBLIK DEUTSCHLAND\nREISEPASS / PASSPORT / PASSEPORT", "passport"),
        ("BUNDESREPUBLIK DEUTSCHLAND PERSONALAUSWEIS IDENTITY CARD", "id-card"),
        ("Führerschein  Permis de conduire", "drivers-license"),
        ("FUHRERSCHEIN", "drivers-license"),
        ("UNITED KINGDOM DRIVING LICENCE", "drivers-license"),
        ("Republic of Utopia identity card", "id-card"),
        ("LIBRARY CARD", None),
    ])
    def test_from_printed_keywords(self, text, expected):
        assert type_from_text(text) == expected

    def test_a_valid_zone_decides_and_a_different_declared_type_is_rejected(self, analyzer):
        result = analyzer.analyze(Uploads(passport_photo(), face("collins-portrait.jpg"),
                                          Metadata.model_validate({"document": {"type": "id-card"}})), get_settings())
        assert result.document.type == "passport"
        assert result.document.mrz.format == "TD3"
        assert "document-type-mismatch" in result.reasons
        assert result.status == "rejected"
