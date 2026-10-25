"""ICAO 9303 machine-readable zones: layouts, check digits, field rules and repair.

A port of the SDK's src/mrz/parse.ts, extended with field parsing and a reader for OCR text lines.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass
from datetime import date
from typing import Literal, Sequence

# The 37 characters of a machine-readable zone, in classifier output order.
MRZ_ALPHABET = "<0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"

MrzFormat = Literal["TD1", "TD2", "TD3"]
MrzKind = Literal["passport", "id-card", "visa", "other"]
Slot = Literal["alpha", "num", "alnum", "check", "check-or-filler", "sex"]


@dataclass(frozen=True)
class CheckRule:
    digit: tuple[int, int]
    over: tuple[tuple[int, int, int], ...]


@dataclass(frozen=True)
class Layout:
    lines: int
    length: int
    slots: tuple[tuple[Slot, ...], ...]
    checks: tuple[CheckRule, ...]
    dates: tuple[tuple[int, int], ...]


@dataclass(frozen=True)
class MrzSummary:
    format: MrzFormat
    kind: MrzKind
    # Every check digit matches and the dates are real calendar dates.
    valid: bool


def _slots(length: int, ranges: Sequence[tuple[int, int, Slot]]) -> tuple[Slot, ...]:
    line: list[Slot] = ["alnum"] * length
    for start, end, slot in ranges:
        for i in range(start, end + 1):
            line[i] = slot
    return tuple(line)


def _rule(digit: tuple[int, int], *over: tuple[int, int, int]) -> CheckRule:
    return CheckRule(digit, tuple(over))


MRZ_LAYOUTS: dict[MrzFormat, Layout] = {
    "TD3": Layout(
        lines=2, length=44,
        slots=(
            _slots(44, [(0, 1, "alpha"), (2, 4, "alpha"), (5, 43, "alpha")]),
            _slots(44, [(0, 8, "alnum"), (9, 9, "check"), (10, 12, "alpha"), (13, 18, "num"), (19, 19, "check"), (20, 20, "sex"),
                        (21, 26, "num"), (27, 27, "check"), (28, 41, "alnum"), (42, 42, "check-or-filler"), (43, 43, "check")]),
        ),
        checks=(
            _rule((1, 9), (1, 0, 9)), _rule((1, 19), (1, 13, 6)), _rule((1, 27), (1, 21, 6)),
            _rule((1, 42), (1, 28, 14)),
            _rule((1, 43), (1, 0, 10), (1, 13, 7), (1, 21, 22)),
        ),
        dates=((1, 13), (1, 21)),
    ),
    "TD2": Layout(
        lines=2, length=36,
        slots=(
            _slots(36, [(0, 1, "alpha"), (2, 4, "alpha"), (5, 35, "alpha")]),
            _slots(36, [(0, 8, "alnum"), (9, 9, "check"), (10, 12, "alpha"), (13, 18, "num"), (19, 19, "check"), (20, 20, "sex"),
                        (21, 26, "num"), (27, 27, "check"), (28, 34, "alnum"), (35, 35, "check")]),
        ),
        checks=(
            _rule((1, 9), (1, 0, 9)), _rule((1, 19), (1, 13, 6)), _rule((1, 27), (1, 21, 6)),
            _rule((1, 35), (1, 0, 10), (1, 13, 7), (1, 21, 14)),
        ),
        dates=((1, 13), (1, 21)),
    ),
    "TD1": Layout(
        lines=3, length=30,
        slots=(
            _slots(30, [(0, 1, "alpha"), (2, 4, "alpha"), (5, 13, "alnum"), (14, 14, "check-or-filler"), (15, 29, "alnum")]),
            _slots(30, [(0, 5, "num"), (6, 6, "check"), (7, 7, "sex"), (8, 13, "num"), (14, 14, "check"), (15, 17, "alpha"),
                        (18, 28, "alnum"), (29, 29, "check")]),
            _slots(30, [(0, 29, "alpha")]),
        ),
        checks=(
            _rule((0, 14), (0, 5, 9)), _rule((1, 6), (1, 0, 6)), _rule((1, 14), (1, 8, 6)),
            _rule((1, 29), (0, 5, 25), (1, 0, 7), (1, 8, 7), (1, 18, 11)),
        ),
        dates=((1, 0), (1, 8)),
    ),
}


def _char_value(char: str) -> int:
    if char == "<":
        return 0
    if "0" <= char <= "9":
        return ord(char) - 48
    return ord(char) - 55


def check_digit(text: str) -> int:
    """ICAO 9303 check digit: weights 7, 3, 1 repeating, modulo 10."""
    return sum(_char_value(char) * (7, 3, 1)[i % 3] for i, char in enumerate(text)) % 10


def _allowed(slot: Slot, char: str) -> bool:
    if slot == "alnum":
        return True
    if slot == "alpha":
        return char == "<" or "A" <= char <= "Z"
    if slot == "sex":
        return char in "MFX<"
    digit = "0" <= char <= "9"
    return digit if slot in ("num", "check") else digit or char == "<"


def _valid_date(text: str) -> bool:
    if not re.fullmatch(r"\d{6}", text):
        return False
    month, day = int(text[2:4]), int(text[4:6])
    return 1 <= month <= 12 and 1 <= day <= 31


def _td1_number(line: str) -> str | None:
    """The TD1 document number may continue into the optional field when it is longer than nine characters."""
    if line[14] != "<":
        return None
    rest = line[15:].rstrip("<")
    return line[5:14] + rest[:-1] if len(rest) >= 1 else None


def _rule_holds(lines: Sequence[str], rule: CheckRule, format: MrzFormat) -> bool:
    line, position = rule.digit
    digit = lines[line][position]
    text = "".join(lines[l][start:start + length] for l, start, length in rule.over)
    if digit == "<":
        # An empty optional field may carry a filler instead of a check digit; an extended TD1 number checks elsewhere.
        if format == "TD1" and line == 0 and position == 14:
            number, rest = _td1_number(lines[0]), lines[0][15:].rstrip("<")
            return number is not None and check_digit(number) == _char_value(rest[-1])
        return re.fullmatch(r"<*", text) is not None
    return "0" <= digit <= "9" and check_digit(text) == int(digit)


def summarize_mrz(lines: Sequence[str]) -> MrzSummary | None:
    """Validates text lines that are already in a known layout."""
    format = next((name for name, layout in MRZ_LAYOUTS.items()
                   if layout.lines == len(lines) and all(len(line) == layout.length for line in lines)), None)
    if format is None or any(char not in MRZ_ALPHABET for line in lines for char in line):
        return None
    layout = MRZ_LAYOUTS[format]
    valid = (all(_rule_holds(lines, rule, format) for rule in layout.checks)
             and all(_valid_date(lines[line][start:start + 6]) for line, start in layout.dates))
    code = lines[0][0]
    # Format and document code agree for genuine layouts: passports are TD3, identity cards TD1 or TD2.
    kind: MrzKind = ("passport" if code == "P" and format == "TD3" else "visa" if code == "V"
                     else "id-card" if code in "IAC" and format != "TD3" else "other")
    return MrzSummary(format, kind, valid)


@dataclass(frozen=True)
class DecodedMrz:
    lines: list[str]
    summary: MrzSummary
    confidence: float


def decode_mrz(format: MrzFormat, probabilities: Sequence[Sequence[Sequence[float]]]) -> DecodedMrz | None:
    """
    Turns per-character probabilities into the most likely MRZ text that satisfies the layout.
    Each position keeps only the characters its field allows (so O/0 and I/1 confusions disappear),
    and a failed check digit is repaired with the least confident alternatives before giving up.
    """
    layout = MRZ_LAYOUTS[format]
    if len(probabilities) != layout.lines or any(len(line) != layout.length for line in probabilities):
        return None
    # Ranked candidates per position after the field constraint.
    ranked = [[sorted(((char, math.log(max(1e-6, scores[c]))) for c, char in enumerate(MRZ_ALPHABET)
                       if _allowed(layout.slots[l][p], char)), key=lambda option: -option[1])[:3]
               for p, scores in enumerate(line)] for l, line in enumerate(probabilities)]
    lines = [[options[0][0] for options in line] for line in ranked]

    def text() -> list[str]:
        return ["".join(line) for line in lines]

    def margin(position: tuple[int, int]) -> float:
        options = ranked[position[0]][position[1]]
        return options[0][1] - options[1][1] if len(options) > 1 else math.inf

    for rule in layout.checks:
        if _rule_holds(text(), rule, format):
            continue
        # Positions this rule depends on, least confident first.
        positions = [rule.digit] + [(l, p) for l, start, length in rule.over for p in range(start, start + length)]
        uncertain = sorted((position for position in positions if margin(position) < math.inf), key=margin)[:8]
        best: tuple[float, list[tuple[int, int, str]]] | None = None

        def attempt(changes: list[tuple[int, int, str]], cost: float) -> None:
            nonlocal best
            if best is not None and cost >= best[0]:
                return
            saved = [lines[l][p] for l, p, _ in changes]
            for l, p, char in changes:
                lines[l][p] = char
            if _rule_holds(text(), rule, format):
                best = (cost, changes)
            for (l, p, _), char in zip(changes, saved):
                lines[l][p] = char

        for i, (li, pi) in enumerate(uncertain):
            top_i = ranked[li][pi][0][1]
            for char_i, score_i in ranked[li][pi][1:]:
                cost_i = top_i - score_i
                attempt([(li, pi, char_i)], cost_i)
                for lj, pj in uncertain[i + 1:]:
                    top_j = ranked[lj][pj][0][1]
                    for char_j, score_j in ranked[lj][pj][1:]:
                        attempt([(li, pi, char_i), (lj, pj, char_j)], cost_i + top_j - score_j)
        if best is not None:
            for l, p, char in best[1]:
                lines[l][p] = char

    result = text()
    summary = summarize_mrz(result)
    if summary is None:
        return None
    confidence = 0.0
    for l, line in enumerate(lines):
        for p, char in enumerate(line):
            confidence += next((math.exp(score) for candidate, score in ranked[l][p] if candidate == char), 0.0)
    return DecodedMrz(result, summary, confidence / (layout.lines * layout.length))


# --- Fields -------------------------------------------------------------------------------------------------------

def _name(field: str) -> tuple[str, str]:
    surname, _, given = field.rstrip("<").partition("<<")
    clean = lambda part: " ".join(word for word in part.split("<") if word)  # noqa: E731
    return clean(surname), clean(given)


def mrz_date(text: str, kind: Literal["birth", "expiry"], today: date | None = None) -> date | None:
    """YYMMDD as a calendar date. Birth dates lie in the past; expiry dates may lie up to 50 years ahead."""
    if not re.fullmatch(r"\d{6}", text):
        return None
    today = today or date.today()
    yy, month, day = int(text[:2]), int(text[2:4]), int(text[4:6])
    year = 2000 + yy
    if (kind == "birth" and year > today.year) or (kind == "expiry" and year > today.year + 50):
        year -= 100
    try:
        return date(year, month, day)
    except ValueError:
        return None


def mrz_fields(lines: Sequence[str], format: MrzFormat) -> dict[str, str | None]:
    """The holder and document data of a zone in a known layout."""
    if format == "TD1":
        top, middle, bottom = lines
        number = _td1_number(top) or top[5:14]
        surname, given = _name(bottom)
        birth, sex, expiry, nationality, optional = middle[0:6], middle[7], middle[8:14], middle[15:18], top[15:30]
    else:
        top, middle = lines
        number = middle[0:9]
        surname, given = _name(top[5:])
        birth, sex, expiry, nationality = middle[13:19], middle[20], middle[21:27], middle[10:13]
        optional = middle[28:42] if format == "TD3" else middle[28:35]
    born, expires = mrz_date(birth, "birth"), mrz_date(expiry, "expiry")
    return {
        "documentCode": top[0:2].rstrip("<"),
        "issuingState": top[2:5].replace("<", ""),
        "documentNumber": number.rstrip("<"),
        "surname": surname,
        "givenNames": given,
        "nationality": nationality.replace("<", ""),
        "birthDate": born.isoformat() if born else None,
        "sex": {"M": "M", "F": "F"}.get(sex, "X"),
        "expiryDate": expires.isoformat() if expires else None,
        "optionalData": optional.strip("<") or None,
    }


# --- Reading OCR text ---------------------------------------------------------------------------------------------

# Glyphs the recognizer confuses on OCR-B, with how likely the alternative is. The field rules and check digits
# pick between them. Round capitals are read as 0 far more often than B as 8.
_STRONG, _MEDIUM, _WEAK = 0.15, 0.12, 0.06
_CONFUSIONS: dict[str, dict[str, float]] = {
    "0": {"O": _STRONG, "D": _MEDIUM, "Q": _WEAK}, "O": {"0": _STRONG, "D": _MEDIUM, "Q": _WEAK},
    "D": {"0": _STRONG, "O": _MEDIUM}, "Q": {"O": _STRONG, "0": _MEDIUM},
    "1": {"I": _STRONG, "L": _WEAK}, "I": {"1": _STRONG, "L": _WEAK}, "L": {"1": _MEDIUM, "I": _WEAK},
    "2": {"Z": _STRONG}, "Z": {"2": _STRONG}, "5": {"S": _STRONG}, "S": {"5": _STRONG}, "6": {"G": _STRONG}, "G": {"6": _STRONG},
    "8": {"B": _WEAK}, "B": {"8": _WEAK}, "7": {"T": _WEAK}, "T": {"7": _WEAK}, "4": {"A": _WEAK}, "A": {"4": _WEAK},
    "U": {"V": _WEAK}, "V": {"U": _WEAK}, "M": {"N": _WEAK}, "N": {"M": _WEAK},
    "<": {"K": _MEDIUM, "C": _WEAK, "E": _WEAK}, "K": {"<": _MEDIUM}, "C": {"<": _WEAK},
}
_FILLER_LOOKALIKES = str.maketrans({"«": "<", "‹": "<", "〈": "<", "く": "<", "(": "<", "[": "<", "{": "<", "≤": "<"})


def normalize_line(text: str) -> str:
    """OCR output as MRZ characters: upper case, filler look-alikes mapped to '<', everything else dropped."""
    text = text.upper().translate(_FILLER_LOOKALIKES).replace(" ", "")
    return "".join(char for char in text if char in MRZ_ALPHABET)


def _fit_length(line: str, length: int) -> str:
    """Adds or removes fillers in the longest filler run (where OCR most often miscounts) until the line fits."""
    while len(line) != length:
        runs = [(m.end() - m.start(), m.start(), m.end()) for m in re.finditer(r"<+", line)]
        if len(line) > length:
            if runs and max(runs)[0] > 1:
                _, start, end = max(runs)
                line = line[:start] + line[start + 1:]
            else:
                line = line[:length]
        else:
            if runs:
                _, start, _ = max(runs)
                line = line[:start] + "<" + line[start:]
            else:
                line = line + "<"
    return line


def _probabilities(line: str, confidence: float) -> list[list[float]]:
    rows = []
    for char in line:
        row = [0.001] * len(MRZ_ALPHABET)
        row[MRZ_ALPHABET.index(char)] = max(0.5, min(0.98, confidence))
        for alternative, probability in _CONFUSIONS.get(char, {}).items():
            row[MRZ_ALPHABET.index(alternative)] = probability
        rows.append(row)
    return rows


def read_mrz_lines(texts: Sequence[tuple[str, float]]) -> DecodedMrz | None:
    """
    Finds a machine-readable zone among OCR text lines (top to bottom, with their confidence) and decodes it.
    Prefers a fully valid read; otherwise returns the best-formed one.
    """
    candidates = [(normalize_line(text), score) for text, score in texts]
    candidates = [(text, score) for text, score in candidates if len(text) >= 26 and text.count("<") >= 2 or len(text) >= 28]
    best: DecodedMrz | None = None
    for format, layout in MRZ_LAYOUTS.items():
        for start in range(0, len(candidates) - layout.lines + 1):
            group = candidates[start:start + layout.lines]
            if any(abs(len(text) - layout.length) > 4 for text, _ in group):
                continue
            fitted = [_fit_length(text, layout.length) for text, _ in group]
            decoded = decode_mrz(format, [_probabilities(text, score) for text, (_, score) in zip(fitted, group)])
            if decoded is None:
                continue
            if best is None or (decoded.summary.valid, decoded.confidence) > (best.summary.valid, best.confidence):
                best = decoded
    return best
