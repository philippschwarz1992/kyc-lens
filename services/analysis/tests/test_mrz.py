from datetime import date

from app.mrz import (MRZ_ALPHABET, MrzSummary, check_digit, decode_mrz, mrz_date, mrz_fields, normalize_line,
                     read_mrz_lines, summarize_mrz)

# Fictional ICAO 9303 specimens (Utopia, Anna Maria Eriksson), the same as the SDK's tests/mrz.test.ts.
TD3 = ["P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<", "L898902C36UTO7408122F1204159ZE184226B<<<<<10"]
TD1 = ["I<UTOD231458907<<<<<<<<<<<<<<<", "7408122F1204159UTO<<<<<<<<<<<6", "ERIKSSON<<ANNA<MARIA<<<<<<<<<<"]
TD2 = ["I<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<", "D231458907UTO7408122F1204159<<<<<<<6"]


def scores(lines: list[str], confuse: dict[str, str] | None = None) -> list[list[list[float]]]:
    """Classifier-like probabilities: mostly confident, with chosen positions confused."""
    confuse = confuse or {}
    result = []
    for l, line in enumerate(lines):
        rows = []
        for p, char in enumerate(line):
            vector = [0.001] * len(MRZ_ALPHABET)
            wrong = confuse.get(f"{l}:{p}")
            if wrong:
                vector[MRZ_ALPHABET.index(wrong)] = 0.6
                vector[MRZ_ALPHABET.index(char)] = 0.35
            else:
                vector[MRZ_ALPHABET.index(char)] = 0.95
            rows.append(vector)
        result.append(rows)
    return result


class TestCheckDigitsAndFormats:
    def test_computes_icao_check_digits(self):
        assert check_digit("L898902C3") == 6
        assert check_digit("740812") == 2
        assert check_digit("120415") == 9
        assert check_digit("D23145890") == 7

    def test_recognizes_passports_identity_cards_and_td2_cards(self):
        assert summarize_mrz(TD3) == MrzSummary("TD3", "passport", True)
        assert summarize_mrz(TD1) == MrzSummary("TD1", "id-card", True)
        assert summarize_mrz(TD2) == MrzSummary("TD2", "id-card", True)

    def test_marks_a_misread_digit_or_an_impossible_date_invalid(self):
        assert summarize_mrz([TD3[0], TD3[1].replace("7408122", "7408132")]).valid is False
        assert summarize_mrz([TD1[0], "7413122F1204159UTO<<<<<<<<<<<6", TD1[2]]).valid is False
        assert summarize_mrz(["P<UTO", "L898"]) is None

    def test_accepts_a_td1_number_that_continues_into_the_optional_field(self):
        number = "D23145890AB"
        line1 = f"I<UTO{number[:9]}<{number[9:]}{check_digit(number)}".ljust(30, "<")
        line2 = "7408122F1204159UTO<<<<<<<<<<<"
        composite = check_digit(line1[5:] + line2[0:7] + line2[8:15] + line2[18:29])
        lines = [line1, line2 + str(composite), TD1[2]]
        assert summarize_mrz(lines).valid is True
        assert mrz_fields(lines, "TD1")["documentNumber"] == number


class TestDecoding:
    def test_restricts_each_field_to_its_character_class(self):
        # Dates are numeric and the name is alphabetic, so a classifier preferring O for 0 or 1 for I is overruled.
        decoded = decode_mrz("TD3", scores(TD3, {"1:14": "O", "0:23": "1", "1:20": "E"}))
        assert decoded.lines == TD3
        assert decoded.summary.valid

    def test_repairs_an_alphanumeric_misread_with_the_check_digit(self):
        # In the document number both 8 and B are allowed; only the check digit tells them apart.
        decoded = decode_mrz("TD1", scores(TD1, {"0:7": "8"}))
        assert decoded.lines == TD1
        assert decoded.summary.valid

    def test_reports_an_unrepairable_read_as_invalid_instead_of_guessing(self):
        probabilities = scores(TD1)
        # Two confident wrong digits in the birth date cannot be repaired from second choices.
        for p in (2, 3):
            probabilities[1][p] = [0.001] * 37
            probabilities[1][p][MRZ_ALPHABET.index("9")] = 0.99
        assert decode_mrz("TD1", probabilities).summary.valid is False

    def test_rejects_probabilities_that_do_not_match_the_layout(self):
        assert decode_mrz("TD3", scores(TD1)) is None


class TestFields:
    def test_parses_the_passport_specimen(self):
        assert mrz_fields(TD3, "TD3") == {
            "documentCode": "P", "issuingState": "UTO", "documentNumber": "L898902C3", "surname": "ERIKSSON",
            "givenNames": "ANNA MARIA", "nationality": "UTO", "birthDate": "1974-08-12", "sex": "F",
            "expiryDate": "2012-04-15", "optionalData": "ZE184226B",
        }

    def test_parses_the_identity_card_specimens(self):
        for lines, format in ((TD1, "TD1"), (TD2, "TD2")):
            fields = mrz_fields(lines, format)
            assert fields["documentNumber"] == "D23145890"
            assert (fields["surname"], fields["givenNames"]) == ("ERIKSSON", "ANNA MARIA")
            assert (fields["birthDate"], fields["expiryDate"]) == ("1974-08-12", "2012-04-15")

    def test_dates_pick_their_century(self):
        today = date(2026, 10, 25)
        assert mrz_date("300101", "birth", today) == date(1930, 1, 1)
        assert mrz_date("200101", "birth", today) == date(2020, 1, 1)
        assert mrz_date("350101", "expiry", today) == date(2035, 1, 1)
        assert mrz_date("990231", "expiry", today) is None


class TestOcrLines:
    def test_normalizes_ocr_look_alikes(self):
        assert normalize_line("p<uto eriksson«anna") == "P<UTOERIKSSON<ANNA"

    def test_repairs_typical_ocr_mistakes(self):
        noisy = [("P<UTOERIKSSON<<ANNA<MAR1A<<<<<<<<<<<<<<<<<<", 0.9),  # 1 for I, one filler missing
                 ("L898902C36UT07408I22F1204159ZE184226B<<<<<<10", 0.9)]  # 0 for O, I for 1, one filler extra
        decoded = read_mrz_lines([("REPUBLIC OF UTOPIA", 0.99), *noisy])
        assert decoded.lines == TD3
        assert decoded.summary.valid
