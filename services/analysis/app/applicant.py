"""
The applicant data the customer's backend sent with the session, compared with what the document says.

A valid zone and the printed page are both sources; a field matches when either agrees, so one misread line does not
fail it. Names are compared on their letters, folded as in the MRZ, in both German (Ü as UE) and plain (Ü as U)
transliteration.
"""

from __future__ import annotations

import re
import unicodedata

from .ocr import fold
from .schema import Applicant, ApplicantCheck, ApplicantFieldCheck, Mrz

# Characters the name field holds after the document code and issuing state: TD1 has its own 30-character line.
NAME_CAPACITY = {"TD1": 30, "TD2": 31, "TD3": 39}


def _words(text: str, german: bool = True) -> list[str]:
    folded = fold(text) if german else "".join(char for char in unicodedata.normalize("NFKD", text.upper()) if not unicodedata.combining(char))
    return re.findall(r"[A-Z]+", folded)


def _truncated(mrz: Mrz) -> bool:
    """The zone cuts names that do not fit; then a document name only has to start the expected one."""
    used = len(mrz.fields.surname.replace(" ", "<")) + 2 + len(mrz.fields.givenNames.replace(" ", "<"))
    return used >= NAME_CAPACITY[mrz.format]


def _same_name(field: str, expected: str, document: str, truncated: bool) -> bool:
    theirs = _words(document)
    for ours in (_words(expected), _words(expected, german=False)):
        if "".join(ours) == "".join(theirs) or (truncated and theirs and "".join(ours).startswith("".join(theirs))):
            return True
        # Backends often hold only the first given name: "Anna" matches ANNA MARIA.
        if field == "givenNames" and ours and all(word in theirs for word in ours):
            return True
    return False


def check_applicant(applicant: Applicant, mrz: Mrz | None, printed: dict[str, str]) -> ApplicantCheck:
    zone = mrz.fields.model_dump() if mrz is not None and mrz.valid else {}
    truncated = mrz is not None and mrz.valid and _truncated(mrz)
    fields: dict[str, ApplicantFieldCheck] = {}
    for field, expected in applicant.model_dump(exclude_none=True).items():
        sources = [(source, value) for source, value in (("mrz", zone.get(field)), ("printed", printed.get(field))) if value]
        shown = expected if field == "birthDate" else " ".join(_words(expected))
        if not sources:
            fields[field] = ApplicantFieldCheck(expected=shown, document=None, source=None, result="not-read")
            continue
        same = lambda source, value: value == expected if field == "birthDate" else _same_name(field, expected, value, truncated and source == "mrz")  # noqa: E731
        source, value = next(((source, value) for source, value in sources if same(source, value)), sources[0])
        fields[field] = ApplicantFieldCheck(expected=shown, document=value, source=source,
                                            result="match" if same(source, value) else "mismatch")
    results = {check.result for check in fields.values()}
    overall = "mismatch" if "mismatch" in results else "incomplete" if "not-read" in results else "match"
    return ApplicantCheck(result=overall, fields=fields)
