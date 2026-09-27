"""The corrections layer: the original stays visible (spec 3.3, 9.3)."""

from __future__ import annotations

import pytest

from api.services.financial_aid_corrections import (
    APPLICATION_CORRECTABLE,
    REQUEST_CORRECTABLE,
    CorrectionError,
    FieldKind,
    canonical_synced,
    effective_values,
    parse_new_value,
)
from api.services.financial_aid_household import BOOL_FIELDS, INCOME_FIELDS, NUMBER_FIELDS, TEXT_FIELDS
from api.services.financial_aid_intake_types import CorrectionRecord


def correction(new: str, original: str, created: str, rid: str, field: str = "total_gross_income") -> CorrectionRecord:
    return CorrectionRecord(
        rid,
        2027,
        "app000000000001",
        "",
        field,
        new,
        original,
        "Checked the tax return.",
        "registrar@example.com",
        created,
    )


def test_only_named_fields_are_correctable() -> None:
    assert "total_gross_income" in APPLICATION_CORRECTABLE
    assert "contact_email" not in APPLICATION_CORRECTABLE
    assert APPLICATION_CORRECTABLE["total_rent"] is FieldKind.MONEY
    assert APPLICATION_CORRECTABLE["unemployment"] is FieldKind.FLAG
    assert APPLICATION_CORRECTABLE["income_override"] is FieldKind.INCOME_OVERRIDE
    assert "special_circumstances" not in APPLICATION_CORRECTABLE  # free text: shown, never corrected
    assert dict(REQUEST_CORRECTABLE) == {"ask": FieldKind.MONEY}


def test_every_numeric_and_yes_no_financial_field_is_correctable() -> None:
    assert set(INCOME_FIELDS) | set(NUMBER_FIELDS) | set(BOOL_FIELDS) <= set(APPLICATION_CORRECTABLE)
    assert not set(TEXT_FIELDS) & set(APPLICATION_CORRECTABLE)


@pytest.mark.parametrize(
    ("kind", "raw", "expected"),
    [
        (FieldKind.MONEY, "$92,000", "92000.00"),
        (FieldKind.MONEY, "1234.5", "1234.50"),
        (FieldKind.COUNT, " 3 ", "3"),
        (FieldKind.FLAG, "Yes", "true"),
        (FieldKind.FLAG, "false", "false"),
        (FieldKind.MONEY, None, ""),
        (FieldKind.MONEY, "0", "0.00"),
        (FieldKind.INCOME_OVERRIDE, " prior_year_only ", "prior_year_only"),
        (FieldKind.INCOME_OVERRIDE, "confirmed_prior_year", "confirmed_prior_year"),
        (FieldKind.INCOME_OVERRIDE, "staff_entered:$52,000", "staff_entered:52000.00"),
    ],
)
def test_new_values_are_stored_canonically(kind: FieldKind, raw: str | None, expected: str) -> None:
    assert parse_new_value(kind, raw) == expected


@pytest.mark.parametrize(
    ("kind", "raw"),
    [
        (FieldKind.MONEY, "-5"),
        (FieldKind.MONEY, "12.345"),
        (FieldKind.MONEY, "NaN"),
        (FieldKind.MONEY, "lots"),
        (FieldKind.COUNT, "51"),
        (FieldKind.COUNT, "2.5"),
        (FieldKind.COUNT, "³"),  # superscript three: str.isdigit() is True but int() raises bare ValueError
        (FieldKind.FLAG, "maybe"),
        (FieldKind.INCOME_OVERRIDE, "staff_entered"),
        (FieldKind.INCOME_OVERRIDE, "prior_year_only:5"),
        (FieldKind.INCOME_OVERRIDE, "whatever"),
    ],
)
def test_bad_values_are_refused(kind: FieldKind, raw: str) -> None:
    with pytest.raises(CorrectionError):
        parse_new_value(kind, raw)


def test_synced_values_canonicalise_like_corrections() -> None:
    assert canonical_synced(FieldKind.MONEY, 85000) == "85000.00"
    assert canonical_synced(FieldKind.MONEY, 0) == "0.00"  # a reported zero
    assert canonical_synced(FieldKind.MONEY, None) == ""  # a blank: unknown, never "0.00"
    assert canonical_synced(FieldKind.COUNT, 3.0) == "3"
    assert canonical_synced(FieldKind.COUNT, None) == ""
    assert canonical_synced(FieldKind.FLAG, None) == "false"
    assert canonical_synced(FieldKind.INCOME_OVERRIDE, None) == ""


def test_a_huge_family_typed_figure_canonicalises_instead_of_raising() -> None:
    # The FA mirror stores any finite float a family types (a pasted digit run, "1e30").
    # Quantizing it at Decimal's default 28-digit precision raised InvalidOperation, a 500
    # on the application page, and on the season's request queue when it was an ask.
    assert canonical_synced(FieldKind.MONEY, float("9" * 30)) == "1" + "0" * 30 + ".00"  # the float is 1e30
    assert canonical_synced(FieldKind.MONEY, 1.5e300).startswith("15" + "0" * 299)


def test_a_blank_synced_income_stays_unknown_until_staff_confirm_a_figure() -> None:
    kinds = {"total_gross_income": FieldKind.MONEY}
    blank = effective_values({"total_gross_income": None}, kinds, [])["total_gross_income"]
    assert (blank.synced, blank.effective, blank.corrected) == ("", "", False)
    confirmed = effective_values({"total_gross_income": None}, kinds, [correction("0.00", "", "2027-01-01", "c1")])[
        "total_gross_income"
    ]
    assert (confirmed.effective, confirmed.corrected, confirmed.changed_since_correction) == ("0.00", True, False)


def test_the_latest_correction_wins_and_the_synced_value_stays_visible() -> None:
    values = effective_values(
        {"total_gross_income": 85000.0},
        {"total_gross_income": FieldKind.MONEY},
        [
            correction("90000.00", "85000.00", "2027-01-02", "c2"),
            correction("88000.00", "85000.00", "2027-01-01", "c1"),
        ],
    )["total_gross_income"]
    assert (values.synced, values.effective, values.corrected, values.changed_since_correction) == (
        "85000.00",
        "90000.00",
        True,
        False,
    )
    assert [c.id for c in values.history] == ["c1", "c2"]


def test_an_empty_new_value_reverts_to_the_synced_value() -> None:
    value = effective_values(
        {"total_gross_income": 85000.0},
        {"total_gross_income": FieldKind.MONEY},
        [correction("90000.00", "85000.00", "2027-01-01", "c1"), correction("", "85000.00", "2027-01-02", "c2")],
    )["total_gross_income"]
    assert (value.effective, value.corrected) == ("85000.00", False)


def test_a_synced_value_that_moved_after_the_correction_is_flagged() -> None:
    value = effective_values(
        {"total_gross_income": 87000.0},
        {"total_gross_income": FieldKind.MONEY},
        [correction("90000.00", "85000.00", "2027-01-01", "c1")],
    )["total_gross_income"]
    assert (value.effective, value.changed_since_correction) == ("90000.00", True)


def test_request_corrections_are_scoped_to_their_request() -> None:
    other = CorrectionRecord(
        "c9",
        2027,
        "app000000000001",
        "req000000000002",
        "ask",
        "100.00",
        "900.00",
        "r",
        "registrar@example.com",
        "2027-01-01",
    )
    value = effective_values({"ask": 900.0}, REQUEST_CORRECTABLE, [other], "req000000000001")["ask"]
    assert (value.effective, value.corrected) == ("900.00", False)
