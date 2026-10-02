"""County from a billing ZIP (app spec §6.3 item 2, D32; Decision 8a): the committed Census crosswalk. A ZIP no county
holds the majority of, a non-US or a malformed code, has none."""

from __future__ import annotations

import pytest

import bunking.geo_normalizer.zip_counties as zip_counties
from bunking.geo_normalizer.zip_counties import county_for_postal_code


@pytest.fixture
def _table(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(zip_counties, "_table", lambda: {"94612": "Alameda County"})


@pytest.mark.usefixtures("_table")
@pytest.mark.parametrize(
    ("code", "county"),
    [
        ("94612", "Alameda County"),
        (" 94612-1234 ", "Alameda County"),
        ("94613", None),
        ("", None),
        ("K1A 0B1", None),
        # A longer all-digit code is a foreign one (seven digits) or a typo, never a US ZIP: no county, not a wrong one
        ("9461234", None),
        ("946123", None),
        ("94612x", None),
        ("94612-12", None),
    ],
)
def test_a_postal_code_reads_its_county_only_when_it_is_a_us_zip(code: str, county: str | None) -> None:
    assert county_for_postal_code(code) == county


def test_the_committed_crosswalk_is_five_digit_zips_to_county_names() -> None:
    table = zip_counties._table()
    assert len(table) > 33000
    assert all(len(z) == 5 and z.isdecimal() and name for z, name in table.items())
