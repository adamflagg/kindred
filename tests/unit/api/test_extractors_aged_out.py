"""Tests for aged-out person exclusion in extractors.

Tests the exclude_aged_out_persons() and filter_aged_out_attendees() helpers
that filter 10th graders (and above) from retention calculations.
"""

from unittest.mock import Mock

from api.services.extractors import (
    RETENTION_AGED_OUT_GRADE,
    RETENTION_GRADUATING_GRADE,
    exclude_aged_out_persons,
    filter_aged_out_attendees,
    is_aged_out,
)


def _make_person(cm_id: int, grade: int | None = 7) -> Mock:
    p = Mock()
    p.cm_id = cm_id
    p.grade = grade
    return p


def _make_attendee(person_id: int) -> Mock:
    a = Mock()
    a.person_id = person_id
    return a


class TestAgedOutConstants:
    def test_aged_out_grade_is_10(self) -> None:
        assert RETENTION_AGED_OUT_GRADE == 10

    def test_graduating_grade_is_12(self) -> None:
        assert RETENTION_GRADUATING_GRADE == 12


class TestIsAgedOut:
    """Per-person aged-out model (spec §8). The flag changes ONLY grade 10."""

    def test_none_grade_never_aged_out(self) -> None:
        assert is_aged_out(None, include_teen_pipeline=False) is False
        assert is_aged_out(None, include_teen_pipeline=True) is False

    def test_grade_9_and_below_tracked(self) -> None:
        for g in (5, 8, 9):
            assert is_aged_out(g, include_teen_pipeline=False) is False
            assert is_aged_out(g, include_teen_pipeline=True) is False

    def test_grade_11_tracked_in_both_states(self) -> None:
        assert is_aged_out(11, include_teen_pipeline=False) is False
        assert is_aged_out(11, include_teen_pipeline=True) is False

    def test_grade_12_and_above_aged_out_in_both_states(self) -> None:
        for g in (12, 13):
            assert is_aged_out(g, include_teen_pipeline=False) is True
            assert is_aged_out(g, include_teen_pipeline=True) is True

    def test_grade_10_is_the_bridge(self) -> None:
        assert is_aged_out(10, include_teen_pipeline=False) is True
        assert is_aged_out(10, include_teen_pipeline=True) is False


class TestExcludeAgedOutPersons:
    """Tests for exclude_aged_out_persons()."""

    def test_excludes_grade_10(self) -> None:
        """Grade 10 persons should be excluded."""
        persons = {
            1: _make_person(1, grade=10),
            2: _make_person(2, grade=9),
        }
        result = exclude_aged_out_persons({1, 2}, persons)
        assert result == {2}

    def test_grade_12_excluded_grade_11_kept_by_default(self) -> None:
        """Default (flag off): grade 12 aged out, grade 11 now tracked."""
        persons = {
            1: _make_person(1, grade=11),
            2: _make_person(2, grade=12),
            3: _make_person(3, grade=8),
        }
        result = exclude_aged_out_persons({1, 2, 3}, persons)
        assert result == {1, 3}

    def test_grade_10_kept_when_teen_pipeline_enabled(self) -> None:
        """Flag on: grade 10 kept (the main->teen bridge)."""
        persons = {
            1: _make_person(1, grade=10),
            2: _make_person(2, grade=9),
        }
        result = exclude_aged_out_persons({1, 2}, persons, include_teen_pipeline=True)
        assert result == {1, 2}

    def test_keeps_grade_9(self) -> None:
        """Grade 9 should NOT be excluded."""
        persons = {1: _make_person(1, grade=9)}
        result = exclude_aged_out_persons({1}, persons)
        assert result == {1}

    def test_keeps_none_grade(self) -> None:
        """Persons with None grade should NOT be excluded."""
        persons = {1: _make_person(1, grade=None)}
        result = exclude_aged_out_persons({1}, persons)
        assert result == {1}

    def test_keeps_person_not_in_persons_dict(self) -> None:
        """Persons not found in the persons dict should be kept (safe default)."""
        persons: dict[int, Mock] = {}
        result = exclude_aged_out_persons({1, 2}, persons)
        assert result == {1, 2}

    def test_empty_person_ids(self) -> None:
        """Empty input returns empty set."""
        persons = {1: _make_person(1, grade=10)}
        result = exclude_aged_out_persons(set(), persons)
        assert result == set()

    def test_mixed_grades(self) -> None:
        """Realistic mix of grades: only 10+ excluded."""
        persons = {
            1: _make_person(1, grade=5),
            2: _make_person(2, grade=7),
            3: _make_person(3, grade=9),
            4: _make_person(4, grade=10),
            5: _make_person(5, grade=None),
        }
        result = exclude_aged_out_persons({1, 2, 3, 4, 5}, persons)
        assert result == {1, 2, 3, 5}

    def test_does_not_mutate_input(self) -> None:
        """Should return a new set, not mutate the input."""
        persons = {1: _make_person(1, grade=10)}
        original = {1, 2}
        result = exclude_aged_out_persons(original, persons)
        assert original == {1, 2}  # unchanged
        assert result != original


class TestFilterAgedOutAttendees:
    """Tests for filter_aged_out_attendees()."""

    def test_filters_grade_10_attendees(self) -> None:
        """Attendees for grade 10 persons should be removed."""
        persons = {
            1: _make_person(1, grade=10),
            2: _make_person(2, grade=8),
        }
        attendees = [_make_attendee(1), _make_attendee(2)]
        result = filter_aged_out_attendees(attendees, persons)
        assert len(result) == 1
        assert result[0].person_id == 2

    def test_grade_10_attendees_kept_when_teen_pipeline_enabled(self) -> None:
        persons = {1: _make_person(1, grade=10), 2: _make_person(2, grade=8)}
        attendees = [_make_attendee(1), _make_attendee(2)]
        result = filter_aged_out_attendees(attendees, persons, include_teen_pipeline=True)
        assert {a.person_id for a in result} == {1, 2}

    def test_keeps_none_grade_attendees(self) -> None:
        """Attendees with None grade should be kept."""
        persons = {1: _make_person(1, grade=None)}
        attendees = [_make_attendee(1)]
        result = filter_aged_out_attendees(attendees, persons)
        assert len(result) == 1

    def test_keeps_attendees_not_in_persons(self) -> None:
        """Attendees whose person_id is not in persons dict should be kept."""
        persons: dict[int, Mock] = {}
        attendees = [_make_attendee(1)]
        result = filter_aged_out_attendees(attendees, persons)
        assert len(result) == 1

    def test_handles_attendee_without_person_id(self) -> None:
        """Attendees without person_id attribute should be kept."""
        a = Mock(spec=[])  # no attributes
        a.person_id = None
        persons = {1: _make_person(1, grade=10)}
        result = filter_aged_out_attendees([a], persons)
        assert len(result) == 1

    def test_empty_attendees(self) -> None:
        """Empty input returns empty list."""
        result = filter_aged_out_attendees([], {})
        assert result == []
