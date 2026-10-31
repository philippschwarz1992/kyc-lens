from dataclasses import replace
from datetime import date

from app.applicant import check_applicant
from app.config import get_settings
from app.pipeline import Uploads
from app.schema import Applicant, Metadata, Mrz, MrzFields
from tests.fixtures import face, passport_photo

ZONE = Mrz(format="TD3", kind="passport", valid=True, fields=MrzFields(
    documentCode="P", issuingState="D", documentNumber="C01X00T47", surname="MUELLER", givenNames="ANNA MARIA",
    nationality="D", birthDate="1974-08-12", sex="F", expiryDate="2031-04-15", optionalData=None))


def results(check):
    return {field: (entry.result, entry.source) for field, entry in check.fields.items()}


def test_matches_folded_names_and_the_birth_date_against_a_valid_zone():
    check = check_applicant(Applicant(givenNames="Anna-Maria", surname="Müller", birthDate="1974-08-12"), ZONE, {})
    assert check.result == "match"
    assert results(check) == {"givenNames": ("match", "mrz"), "surname": ("match", "mrz"), "birthDate": ("match", "mrz")}
    assert check.fields["surname"].expected == "MUELLER"


def test_accepts_plain_transliteration_and_a_first_given_name_only():
    zone = ZONE.model_copy(update={"fields": ZONE.fields.model_copy(update={"surname": "MULLER"})})
    check = check_applicant(Applicant(givenNames="anna", surname="Müller"), zone, {})
    assert check.result == "match"


def test_reports_a_mismatch_with_the_document_value():
    check = check_applicant(Applicant(surname="Schmidt", birthDate="1975-08-12"), ZONE, {})
    assert check.result == "mismatch"
    assert check.fields["surname"].document == "MUELLER"
    assert results(check) == {"surname": ("mismatch", "mrz"), "birthDate": ("mismatch", "mrz")}


def test_falls_back_to_the_printed_page_and_says_what_was_not_read():
    invalid = ZONE.model_copy(update={"valid": False})
    check = check_applicant(Applicant(surname="Müller", birthDate="1974-08-12"), invalid, {"surname": "MUELLER"})
    assert check.result == "incomplete"
    assert results(check) == {"surname": ("match", "printed"), "birthDate": ("not-read", None)}


def test_either_source_may_match():
    check = check_applicant(Applicant(surname="Müller"), ZONE, {"surname": "MUELIER"})
    assert results(check) == {"surname": ("match", "mrz")}


def test_a_truncated_zone_name_only_has_to_start_the_expected_one():
    long = ZONE.model_copy(update={"fields": ZONE.fields.model_copy(update={"surname": "WOLFESCHLEGELSTEINHAUSE", "givenNames": "HUBERTO BLAINE"})})
    assert check_applicant(Applicant(surname="Wolfeschlegelsteinhausen"), long, {}).result == "match"
    assert check_applicant(Applicant(surname="Muellerson"), ZONE, {}).result == "mismatch"


def test_applicant_data_reaches_the_decision(analyzer):
    settings = replace(get_settings(), require_liveness=False)
    metadata = Metadata.model_validate({"document": {"type": "passport"}})
    analyze = lambda applicant: analyzer.analyze(Uploads(passport_photo(), face("collins-portrait.jpg"), metadata, applicant=applicant),  # noqa: E731
                                                 settings, today=date(2011, 1, 1))
    same = analyze(Applicant(givenNames="Anna Maria", surname="Eriksson", birthDate="1974-08-12"))
    assert (same.status, same.reasons, same.applicantCheck.result) == ("approved", [], "match")
    other = analyze(Applicant(surname="Eriksson", birthDate="1980-01-01"))
    assert (other.status, other.reasons) == ("review", ["applicant-data-mismatch"])
    assert other.applicantCheck.fields["birthDate"].document == "1974-08-12"
    assert analyze(None).applicantCheck is None
