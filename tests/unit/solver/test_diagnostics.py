"""Unit tests for solver diagnostics name-resolution (Stream B, #1638)."""

from dataclasses import dataclass

from bunking.solver.diagnostics import resolve_localization


@dataclass
class _FakePerson:
    first_name: str
    last_name: str
    grade: int
    gender: str


def test_resolve_localization_uses_minimal_correction_set_with_names() -> None:
    people = {
        1000001: _FakePerson("Emma", "Johnson", 5, "F"),
        1000002: _FakePerson("Liam", "Garcia", 6, "M"),
    }
    iis = {
        "approach": "singleton",
        "candidate_count": 2,
        "singleton_critical_cms": [1000001],
        "minimal_correction_set": [1000001, 1000002],
        "notes": "Removing these restores feasibility.",
    }
    result = resolve_localization(iis, people)  # type: ignore[arg-type]
    assert result["approach"] == "singleton"
    assert result["candidate_count"] == 2
    assert result["notes"] == "Removing these restores feasibility."
    assert result["campers"] == [
        {"cm_id": 1000001, "name": "Emma Johnson", "grade": 5, "gender": "F"},
        {"cm_id": 1000002, "name": "Liam Garcia", "grade": 6, "gender": "M"},
    ]


def test_resolve_localization_falls_back_to_singleton_when_no_mcs() -> None:
    people = {1000001: _FakePerson("Emma", "Johnson", 5, "F")}
    iis = {
        "approach": "singleton",
        "candidate_count": 1,
        "singleton_critical_cms": [1000001],
        "minimal_correction_set": [],
        "notes": "",
    }
    result = resolve_localization(iis, people)  # type: ignore[arg-type]
    assert [c["cm_id"] for c in result["campers"]] == [1000001]


def test_resolve_localization_unknown_cm_id_uses_id_as_name() -> None:
    result = resolve_localization(
        {"minimal_correction_set": [999], "approach": "x", "candidate_count": 1, "notes": ""},
        {},
    )
    assert result["campers"] == [{"cm_id": 999, "name": "999", "grade": None, "gender": None}]


def test_resolve_localization_empty_iis() -> None:
    result = resolve_localization({}, {})
    assert result == {"approach": "", "candidate_count": 0, "campers": [], "notes": ""}
