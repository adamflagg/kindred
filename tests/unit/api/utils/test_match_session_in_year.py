"""match_session_in_year across the 2026 → 2027 rename (#3207 ruling #15).

2027 returns to "Taste of Camp" (a new CampMinder id) where 2026 ran "Taste of Camp 1". The owner asked
for confirmation that the two are the same session under #3245's matching: id first, then the alias
group, then the exact name. These tests pin it in both directions.
"""

from api.utils.session_metrics import match_session_in_year
from tests.unit.api.conftest import create_mock_session


def _sessions_2026() -> dict:
    return {
        1000101: create_mock_session(1000101, "Taste of Camp 1", year=2026, session_type="embedded"),
        1000102: create_mock_session(1000102, "Taste of Camp 2", year=2026, session_type="embedded"),
        1000200: create_mock_session(1000200, "Session 2", year=2026),
        1000300: create_mock_session(1000300, "Session 3", year=2026),
    }


def _sessions_2027() -> dict:
    return {
        1000901: create_mock_session(1000901, "Taste of Camp", year=2027, session_type="embedded"),
        1000200: create_mock_session(1000200, "Session 2", year=2027),
    }


def test_2027_taste_of_camp_matches_2026_taste_of_camp_1() -> None:
    """A new id and a new name: the alias group pairs them."""
    assert match_session_in_year(_sessions_2026(), 1000901, "Taste of Camp") == 1000101


def test_2026_taste_of_camp_1_matches_2027_taste_of_camp() -> None:
    """The same pairing read the other way (a 2026 pick viewed in 2027)."""
    assert match_session_in_year(_sessions_2027(), 1000101, "Taste of Camp 1") == 1000901


def test_taste_of_camp_never_matches_taste_of_camp_2() -> None:
    """Taste of Camp 2 is its own alias group (with Session 2b): it has no 2027 match."""
    assert match_session_in_year(_sessions_2027(), 1000102, "Taste of Camp 2") is None


def test_taste_of_camp_matches_when_2027_is_a_main_session() -> None:
    """The match does not depend on CampMinder filing 2027's Taste of Camp as embedded or main."""
    sessions_2027 = {1000901: create_mock_session(1000901, "Taste of Camp", year=2027, session_type="main")}
    assert match_session_in_year(sessions_2027, 1000101, "Taste of Camp 1") == 1000901
