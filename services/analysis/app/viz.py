"""
The printed data (visual inspection zone) of a passport, identity card or driving licence, read from OCR lines.

Fields are found by their printed labels ("Name/Surname/Nom", "Date of birth", "Gültig bis", ...) and the text
under or beside them, and on driving licences by the EU field numbers (1. surname, 2. given names, ...).
"""

from __future__ import annotations

import re
from datetime import date
from typing import Iterable, Literal, Sequence

from .mrz import mrz_date
from .ocr import OcrLine, fold

Field = Literal["surname", "givenNames", "documentNumber", "nationality", "birthDate", "placeOfBirth", "sex",
                "issueDate", "expiryDate"]
FIELDS: tuple[Field, ...] = ("surname", "givenNames", "documentNumber", "nationality", "birthDate", "placeOfBirth", "sex",
                             "issueDate", "expiryDate")

# Most specific first: a line is the label of the first field that matches it. OCR often drops spaces and
# umlauts in small print ("Gltigbis"), so both are optional.
_LABELS: list[tuple[Field, re.Pattern[str]]] = [(field, re.compile(pattern)) for field, pattern in [
    ("givenNames", r"\b(GIVEN\s*NAMES?|VORNAMEN?|PRENOMS?|FORENAMES?|NOMBRES?)\b"),
    ("placeOfBirth", r"PLACE\s*OF\s*BIRTH|GEBURTSORT|LIEU\s*DE\s*NAISSANCE|LUGAR\s*DE\s*NACIMIENTO"),
    ("birthDate", r"DATE\s*OF\s*BIRTH|BIRTH\s*DATE|GEBURTSTAG|GEBURTSDATUM|DATE\s*DE\s*NAISSANCE|FECHA\s*DE\s*NACIMIENTO"),
    ("expiryDate", r"DATE\s*OF\s*EXPIRY|EXPIRY\s*DATE|\bEXPIRES\b|VALID\s*UNTIL|G(UE|U)?LTIG\s*BIS|DATE\s*D\W?\s*EXPIRATION"),
    ("issueDate", r"DATE\s*OF\s*ISSUE|ISSUE\s*DATE|AUSSTELLUNGSDATUM|DATE\s*DE\s*DELIVRANCE"),
    ("documentNumber", r"PASSPORT\s*N(O|R|UMBER)\b|PASS\s*-?\s*NR|DOCUMENT\s*N(O|UMBER)\b|CARD\s*N(O|UMBER)\b|AUSWEIS\s*-?\s*N(R|UMMER)"
                       r"|\bN\W?\s*DU\s*PASSEPORT|LICEN[CS]E\s*N(O|UMBER)\b"),
    ("nationality", r"NATIONALIT(Y|E|AET)?|STAATSANGEH(OE|O)?RIGKEIT|NACIONALIDAD"),
    ("sex", r"\b(SEX|SEXE|GESCHLECHT|SEXO)\b"),
    ("surname", r"\b(SURNAME|NAME|NOM|FAMILIENNAME|APELLIDOS?|COGNOME)\b"),
]]
# EU driving licence field numbers (Directive 2006/126/EC, annex I).
_LICENCE_LABELS: list[tuple[Field, re.Pattern[str]]] = [(field, re.compile(rf"^\s*{number}[.,]\s*")) for field, number in [
    ("surname", "1"), ("givenNames", "2"), ("birthDate", "3"), ("issueDate", "4A"), ("expiryDate", "4B"), ("documentNumber", "5"),
]]
_ANY_LABEL = re.compile("|".join(f"(?:{pattern.pattern})" for _, pattern in _LABELS))

_MONTHS = {"JAN": 1, "FEB": 2, "FEV": 2, "MAR": 3, "MAER": 3, "MRZ": 3, "APR": 4, "AVR": 4, "MAY": 5, "MAI": 5, "JUN": 6,
           "JUIN": 6, "JUL": 7, "JUIL": 7, "AUG": 8, "AOUT": 8, "SEP": 9, "SEPT": 9, "OCT": 10, "OKT": 10, "NOV": 11,
           "DEC": 12, "DEZ": 12}
_NUMERIC_DATE = re.compile(r"(\d{1,2})\s*[.\-/ ]\s*(\d{1,2})\s*[.\-/ ]\s*(\d{4}|\d{2})(?!\d)")
_ISO_DATE = re.compile(r"(\d{4})-(\d{2})-(\d{2})")
_NAMED_DATE = re.compile(r"(\d{1,2})\s*([A-Z]{3,4})\.?(?:\s*/\s*[A-Z]{3,4}\.?)*\s*(\d{4}|\d{2})(?!\d)")


def parse_date(text: str, kind: Literal["birth", "expiry"]) -> str | None:
    """A printed date as ISO 8601. Two-digit years take their century like MRZ dates."""
    folded = fold(text)
    day = month = year = None
    if match := _ISO_DATE.search(folded):
        year, month, day = (int(group) for group in match.groups())
    elif match := _NUMERIC_DATE.search(folded):
        day, month, year = (int(group) for group in match.groups())
        year = year if len(match.group(3)) == 4 else -year
    elif (match := _NAMED_DATE.search(folded)) and match.group(2) in _MONTHS:
        day, month, year = int(match.group(1)), _MONTHS[match.group(2)], int(match.group(3))
        year = year if len(match.group(3)) == 4 else -year
    if day is None:
        return None
    if year < 0:  # Two digits: let the MRZ rule pick the century.
        parsed = mrz_date(f"{-year:02d}{month:02d}{day:02d}", kind)
        return parsed.isoformat() if parsed else None
    try:
        return date(year, month, day).isoformat()
    except ValueError:
        return None


def _clean(field: Field, text: str) -> str | None:
    folded = fold(text).strip(" .,:;/")
    if field in ("surname", "givenNames", "placeOfBirth", "nationality"):
        value = " ".join(re.sub(r"[^A-Z\- ]", " ", folded.replace("0", "O").replace("1", "I")).split())
        return value or None
    if field == "documentNumber":
        value = re.sub(r"[^A-Z0-9]", "", folded)
        return value if len(value) >= 5 else None
    if field == "sex":
        letter = re.search(r"\b([MFWXD])\b", folded)
        return {"M": "M", "F": "F", "W": "F", "X": "X", "D": "X"}[letter.group(1)] if letter else None
    return parse_date(folded, "expiry" if field == "expiryDate" else "birth")


def _label(line: OcrLine, licence: bool) -> tuple[Field, str] | None:
    """The field a line labels, and any value printed on the same line after the label."""
    folded = fold(line.text)
    for field, pattern in _LICENCE_LABELS if licence else []:
        if match := pattern.search(folded):
            return field, folded[match.end():].strip(" .,:;/")
    for field, pattern in _LABELS:
        if pattern.search(folded):
            # Multilingual labels ("Name/Surname/Nom") are removed as a whole; what remains is an inline value.
            return field, _ANY_LABEL.sub(" ", folded).strip(" .,:;/")
    return None


def _value_for(label: OcrLine, candidates: Sequence[OcrLine]) -> OcrLine | None:
    """The nearest unlabelled line under the label (passports, ID cards) or right of it on the same row."""
    best, best_distance = None, float("inf")
    h = label.height
    for line in candidates:
        below = 0 <= line.y0 - label.y1 + 0.3 * h <= 2.5 * h and abs(line.x0 - label.x0) <= 3 * h
        beside = abs((line.y0 + line.y1) / 2 - (label.y0 + label.y1) / 2) <= 0.6 * h and 0 <= line.x0 - label.x1 <= 8 * h
        if below or beside:
            distance = (line.y0 - label.y1) + abs(line.x0 - label.x0) * 0.2 if below else (line.x0 - label.x1) * 0.5
            if distance < best_distance:
                best, best_distance = line, distance
    return best


def read_printed_fields(lines: Iterable[OcrLine], licence: bool = False) -> dict[Field, str]:
    """
    Field values read from one side of a document. `licence` also reads EU driving licence field numbers.
    Values are folded to upper case without diacritics (as in the MRZ) and dates are ISO 8601.
    """
    lines = list(lines)
    labels = {id(line): label for line in lines if (label := _label(line, licence))}
    unlabelled = [line for line in lines if id(line) not in labels]
    fields: dict[Field, str] = {}
    for line in lines:
        if id(line) not in labels:
            continue
        field, inline = labels[id(line)]
        if field in fields:
            continue
        value = _clean(field, inline) if len(re.sub(r"[^A-Z0-9]", "", inline)) >= 1 else None
        if value is None and (target := _value_for(line, unlabelled)) is not None:
            value = _clean(field, target.text)
            if value is not None:
                unlabelled.remove(target)
        if value is not None:
            fields[field] = value
        # Licence field 3 is the birth date followed by the place of birth.
        if licence and field == "birthDate" and value and "placeOfBirth" not in fields:
            if place := _clean("placeOfBirth", re.sub(r"^[\d.\-/ ]+", "", inline)):
                fields["placeOfBirth"] = place
    return fields


def _letters(text: str) -> str:
    return re.sub(r"[^A-Z]", "", fold(text))


def respace(printed: dict[str, str], mrz: dict[str, str | None]) -> dict[str, str]:
    """OCR drops spaces in names ("ANNAMARIA"); where the letters equal the zone's, the zone's spacing is used."""
    fixed = dict(printed)
    for field in ("surname", "givenNames"):
        if fixed.get(field) and mrz.get(field) and _letters(fixed[field]) == _letters(mrz[field]):
            fixed[field] = mrz[field]
    return fixed


def mismatches(printed: dict[str, str | None], mrz: dict[str, str | None]) -> list[str]:
    """Fields that the printed data and the machine-readable zone both carry but that disagree."""
    different = []
    for field in ("documentNumber", "surname", "givenNames", "birthDate", "expiryDate", "sex"):
        ours, theirs = printed.get(field), mrz.get(field)
        if not ours or not theirs:
            continue
        if field in ("surname", "givenNames"):
            # The MRZ truncates long names, so the printed name only has to start with it.
            same = _letters(ours).startswith(_letters(theirs))
        else:
            same = ours == theirs
        if not same:
            different.append(field)
    return different
