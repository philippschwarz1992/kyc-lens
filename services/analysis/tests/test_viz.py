from dataclasses import replace
from datetime import date

import pytest

from app.config import get_settings
from app.document import decode_image, rectify
from app.mrz import mrz_fields
from app.ocr import OcrLine, read_boxes
from app.pipeline import Uploads
from app.schema import Metadata
from app.viz import mismatches, parse_date, read_printed_fields
from tests.fixtures import SPECIMEN_PRINTED, face, licence_photo, passport_photo

SPECIMEN = {"surname": "ERIKSSON", "givenNames": "ANNA MARIA", "documentNumber": "L898902C3", "nationality": "UTOPIAN",
            "birthDate": "1974-08-12", "placeOfBirth": "ZENITH", "sex": "F", "issueDate": "2007-04-16",
            "expiryDate": "2012-04-15"}
TD3 = ["P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<", "L898902C36UTO7408122F1204159ZE184226B<<<<<10"]
NO_LIVENESS = replace(get_settings(), require_liveness=False)


def line(text, x, y, height=20):
    return OcrLine(text, 0.99, x, y, x + 12 * len(text), y + height)


def letters(value):
    return value.replace(" ", "")


def test_reads_the_printed_data_page():
    document, _ = rectify(decode_image(passport_photo()))
    fields = read_printed_fields(read_boxes(document))
    assert fields.keys() == SPECIMEN.keys()
    # OCR may drop the space between given names; everything else is exact.
    assert {key: letters(value) for key, value in fields.items()} == {key: letters(value) for key, value in SPECIMEN.items()}


def test_reads_a_driving_licence_by_field_number():
    document, _ = rectify(decode_image(licence_photo()))
    assert read_printed_fields(read_boxes(document), licence=True) == {
        "surname": "MUSTERMANN", "givenNames": "ERIKA", "birthDate": "1964-08-12", "placeOfBirth": "BERLIN",
        "issueDate": "2013-01-20", "expiryDate": "2028-01-19", "documentNumber": "B072RRE2955",
    }


def test_reads_inline_and_beside_values_and_folds_umlauts():
    lines = [line("Name/Surname/Nom MÜLLER", 0, 0), line("Vornamen/Given names", 0, 40), line("JÖRG", 0, 62),
             line("Geburtstag", 0, 100), line("01.02.1990", 200, 100), line("Gültig bis 31.12.2031", 0, 150)]
    assert read_printed_fields(lines) == {"surname": "MUELLER", "givenNames": "JOERG", "birthDate": "1990-02-01",
                                          "expiryDate": "2031-12-31"}


def test_a_label_without_a_value_stays_empty():
    lines = [line("Date of birth", 0, 0), line("Sex", 0, 40), line("F", 0, 62)]
    assert read_printed_fields(lines) == {"sex": "F"}


@pytest.mark.parametrize("text, kind, expected", [
    ("12 AUG/AOUT 1974", "birth", "1974-08-12"),
    ("12 AUG 74", "birth", "1974-08-12"),
    ("15.04.2012", "expiry", "2012-04-15"),
    ("15/04/12", "expiry", "2012-04-15"),
    ("2031-12-31", "expiry", "2031-12-31"),
    ("03 MÄR 2001", "birth", "2001-03-03"),
    ("31.02.2001", "birth", None),
    ("no date", "birth", None),
])
def test_parses_printed_dates(text, kind, expected):
    assert parse_date(text, kind) == expected


def test_compares_printed_data_with_the_zone():
    mrz = mrz_fields(TD3, "TD3")
    assert mismatches(SPECIMEN, mrz) == []
    # The MRZ truncates long names; a printed name that continues is still the same.
    assert mismatches({"givenNames": "ANNA MARIA LOUISE"}, {"givenNames": "ANNA MARIA"}) == []
    assert mismatches(SPECIMEN | {"birthDate": "1974-08-13", "documentNumber": "L898902C4"}, mrz) == ["documentNumber", "birthDate"]


def test_the_result_carries_the_printed_data(analyzer):
    result = analyzer.analyze(Uploads(passport_photo(), face("collins-portrait.jpg"), Metadata()), NO_LIVENESS,
                              today=date(2011, 1, 1))
    assert result.document.printedFields.model_dump() == SPECIMEN
    assert result.document.printedFields.birthDate == "1974-08-12"
    assert result.document.fieldMismatches == []
    assert result.status == "approved"


def test_printed_data_that_contradicts_the_zone_goes_to_review(analyzer):
    altered = [(x, y, label, "12 AUG 1975" if label.startswith("Date of birth") else value) for x, y, label, value in SPECIMEN_PRINTED]
    result = analyzer.analyze(Uploads(passport_photo(printed=altered), face("collins-portrait.jpg"), Metadata()), NO_LIVENESS,
                              today=date(2011, 1, 1))
    assert result.document.fieldMismatches == ["birthDate"]
    assert (result.status, result.reasons) == ("review", ["printed-data-mismatch"])


def test_a_licence_without_a_zone_uses_the_printed_expiry(analyzer):
    metadata = Metadata.model_validate({"document": {"type": "drivers-license"}})
    current = analyzer.analyze(Uploads(licence_photo(), face("collins-portrait.jpg"), metadata), NO_LIVENESS, today=date(2026, 10, 25))
    assert current.document.type == "drivers-license" and current.document.mrz is None
    assert current.document.printedFields.surname == "MUSTERMANN"
    assert (current.status, current.reasons) == ("approved", [])
    expired = analyzer.analyze(Uploads(licence_photo(), face("collins-portrait.jpg"), metadata), NO_LIVENESS, today=date(2028, 6, 1))
    assert (expired.status, expired.reasons) == ("review", ["printed-expiry-passed"])
