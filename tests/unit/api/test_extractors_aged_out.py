"""Tests for aged-out person exclusion in extractors.

Tests the exclude_aged_out_persons() and filter_aged_out_attendees() helpers
that filter 10th graders (and above) from retention calculations.
"""

from unittest.mock import Mock

from api.services.extractors import (
    RETENTION_AGED_OUT_GRADE,
    exclude_aged_out_persons,
    filter_aged_out_attendees,
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


class TestRetentionAgedOutGradeConstant:
    def test_constant_is_10(self) -> None:
        assert RETENTION_AGED_OUT_GRADE == 10


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

    def test_excludes_grade_above_10(self) -> None:
        """Grades 11, 12 should also be excluded."""
        persons = {
            1: _make_person(1, grade=11),
            2: _make_person(2, grade=12),
            3: _make_person(3, grade=8),
        }
        result = exclude_aged_out_persons({1, 2, 3}, persons)
        assert result == {3}

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
