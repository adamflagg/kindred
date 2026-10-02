"""The ZIP-to-county crosswalk (Decision 8a, ruled by the lead): Census 2020 ZCTA-to-county pieces, a ZIP kept only
when one county holds the majority of its land. Fictional figures; real county names are public geography."""

from __future__ import annotations

from scripts.data.seed_zip_counties import crosswalk


def _piece(zcta: str, county: str, zcta_land: int, part: int) -> dict[str, str]:
    return {
        "GEOID_ZCTA5_20": zcta,
        "NAMELSAD_COUNTY_20": county,
        "AREALAND_ZCTA5_20": str(zcta_land),
        "AREALAND_PART": str(part),
    }


def test_a_zip_takes_the_county_holding_most_of_its_land() -> None:
    rows = [_piece("90001", "Alameda County", 100, 70), _piece("90001", "Contra Costa County", 100, 30)]
    assert crosswalk(rows) == {"90001": "Alameda County"}


def test_a_zip_no_county_holds_the_majority_of_is_left_out() -> None:
    rows = [
        _piece("90002", "Dallas County", 100, 40),
        _piece("90002", "Collin County", 100, 35),
        _piece("90002", "Denton County", 100, 25),
    ]
    assert crosswalk(rows) == {}


def test_an_exact_half_is_no_majority() -> None:
    rows = [_piece("90003", "Jackson County", 100, 50), _piece("90003", "Clay County", 100, 50)]
    assert crosswalk(rows) == {}


def test_county_pieces_in_no_zcta_and_zctas_with_no_land_are_skipped() -> None:
    rows = [_piece("", "Baldwin County", 0, 339765765), _piece("90004", "Marin County", 0, 0)]
    assert crosswalk(rows) == {}
