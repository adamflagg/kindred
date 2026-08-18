"""Tests for TemporalNameCache.

Tests the pre-built name cache that enables O(1) name lookups,
matching monolith's build_temporal_name_cache() behavior."""

import logging
from datetime import datetime
from typing import Any
from unittest.mock import Mock


class TestTemporalNameCache:
    """Tests for the TemporalNameCache class"""

    def test_find_by_name_returns_matching_persons(self):
        """Test that find_by_name returns persons matching first and last name"""
        from bunking.sync.bunk_request_processor.core.models import Person
        from bunking.sync.bunk_request_processor.data.cache.temporal_name_cache import (
            TemporalNameCache,
        )

        # Create mock PocketBase
        pb = Mock()
        cache = TemporalNameCache(pb, year=2025)

        # Manually populate the cache (simulating what initialize() would do)
        test_person = Person(
            cm_id=12345,
            first_name="John",
            last_name="Smith",
            preferred_name=None,
            birth_date=datetime(2012, 5, 15),
            grade=7,
            school="Oakland Middle",
            city="Oakland",
            state="CA",
            session_cm_id=None,
        )
        cache._person_cache[12345] = test_person
        cache._attendees_with_sessions[12345] = {
            "session_cm_id": 1001,
            "session_name": "Session 2",
            "parent_session_id": 1001,
            "parent_session_name": "Session 2",
        }
        cache._build_name_index()

        # Test lookup
        results = cache.find_by_name("John", "Smith", year=2025)

        assert len(results) == 1
        assert results[0].cm_id == 12345
        assert results[0].first_name == "John"
        assert results[0].last_name == "Smith"

    def test_find_by_name_matches_preferred_name(self):
        """Test that find_by_name matches on preferred_name as well as first_name"""
        from bunking.sync.bunk_request_processor.core.models import Person
        from bunking.sync.bunk_request_processor.data.cache.temporal_name_cache import (
            TemporalNameCache,
        )

        pb = Mock()
        cache = TemporalNameCache(pb, year=2025)

        # Person with preferred_name different from first_name
        test_person = Person(
            cm_id=12345,
            first_name="Robert",
            last_name="Johnson",
            preferred_name="Bobby",  # Goes by Bobby, not Robert
            birth_date=datetime(2012, 5, 15),
            grade=7,
            school=None,
            city=None,
            state=None,
            session_cm_id=None,
        )
        cache._person_cache[12345] = test_person
        cache._attendees_with_sessions[12345] = {
            "session_cm_id": 1001,
            "session_name": "Session 2",
            "parent_session_id": 1001,
            "parent_session_name": "Session 2",
        }
        cache._build_name_index()

        # Should find by preferred name
        results = cache.find_by_name("Bobby", "Johnson", year=2025)
        assert len(results) == 1
        assert results[0].cm_id == 12345

        # Should also find by first name
        results = cache.find_by_name("Robert", "Johnson", year=2025)
        assert len(results) == 1
        assert results[0].cm_id == 12345

    def test_find_by_first_name_only(self):
        """Test FIRST: prefix pattern for first-name-only lookups"""
        from bunking.sync.bunk_request_processor.core.models import Person
        from bunking.sync.bunk_request_processor.data.cache.temporal_name_cache import (
            TemporalNameCache,
        )

        pb = Mock()
        cache = TemporalNameCache(pb, year=2025)

        # Create two Johns with different last names
        person1 = Person(
            cm_id=111,
            first_name="John",
            last_name="Smith",
            preferred_name=None,
            birth_date=datetime(2012, 1, 1),
            grade=7,
            school=None,
            city=None,
            state=None,
            session_cm_id=None,
        )
        person2 = Person(
            cm_id=222,
            first_name="John",
            last_name="Doe",
            preferred_name=None,
            birth_date=datetime(2012, 6, 1),
            grade=7,
            school=None,
            city=None,
            state=None,
            session_cm_id=None,
        )
        cache._person_cache[111] = person1
        cache._person_cache[222] = person2
        cache._attendees_with_sessions[111] = {
            "session_cm_id": 1001,
            "session_name": "Session 2",
            "parent_session_id": 1001,
            "parent_session_name": "Session 2",
        }
        cache._attendees_with_sessions[222] = {
            "session_cm_id": 1001,
            "session_name": "Session 2",
            "parent_session_id": 1001,
            "parent_session_name": "Session 2",
        }
        cache._build_name_index()

        # Should find both Johns
        results = cache.find_by_first_name("John", year=2025)
        assert len(results) == 2
        cm_ids = {r.cm_id for r in results}
        assert cm_ids == {111, 222}

    def test_find_by_name_handles_apostrophes(self):
        """Test that names with apostrophes work correctly (the bug we're fixing)"""
        from bunking.sync.bunk_request_processor.core.models import Person
        from bunking.sync.bunk_request_processor.data.cache.temporal_name_cache import (
            TemporalNameCache,
        )

        pb = Mock()
        cache = TemporalNameCache(pb, year=2025)

        # Irish name with apostrophe
        test_person = Person(
            cm_id=12345,
            first_name="Sean",
            last_name="O'Brien",  # Apostrophe that would break SQL
            preferred_name=None,
            birth_date=datetime(2012, 5, 15),
            grade=7,
            school=None,
            city=None,
            state=None,
            session_cm_id=None,
        )
        cache._person_cache[12345] = test_person
        cache._attendees_with_sessions[12345] = {
            "session_cm_id": 1001,
            "session_name": "Session 2",
            "parent_session_id": 1001,
            "parent_session_name": "Session 2",
        }
        cache._build_name_index()

        # Should find without SQL escaping issues
        results = cache.find_by_name("Sean", "O'Brien", year=2025)
        assert len(results) == 1
        assert results[0].cm_id == 12345

    def test_normalization_handles_case_and_punctuation(self):
        """Test that name lookups are case-insensitive and handle punctuation"""
        from bunking.sync.bunk_request_processor.core.models import Person
        from bunking.sync.bunk_request_processor.data.cache.temporal_name_cache import (
            TemporalNameCache,
        )

        pb = Mock()
        cache = TemporalNameCache(pb, year=2025)

        test_person = Person(
            cm_id=12345,
            first_name="Mary-Jane",  # Hyphenated name
            last_name="D'Amato",  # Apostrophe
            preferred_name=None,
            birth_date=datetime(2012, 5, 15),
            grade=7,
            school=None,
            city=None,
            state=None,
            session_cm_id=None,
        )
        cache._person_cache[12345] = test_person
        cache._attendees_with_sessions[12345] = {
            "session_cm_id": 1001,
            "session_name": "Session 2",
            "parent_session_id": 1001,
            "parent_session_name": "Session 2",
        }
        cache._build_name_index()

        # Should find with different casing
        results = cache.find_by_name("MARY-JANE", "D'AMATO", year=2025)
        assert len(results) == 1

        # Should find with lowercase
        results = cache.find_by_name("mary-jane", "d'amato", year=2025)
        assert len(results) == 1

    def test_current_vs_historical_separation(self):
        """Test that current year and historical data are properly separated"""
        from bunking.sync.bunk_request_processor.core.models import Person
        from bunking.sync.bunk_request_processor.data.cache.temporal_name_cache import (
            TemporalNameCache,
        )

        pb = Mock()
        cache = TemporalNameCache(pb, year=2025)

        # Same person attending in current year
        current_person = Person(
            cm_id=12345,
            first_name="John",
            last_name="Smith",
            preferred_name=None,
            birth_date=datetime(2012, 5, 15),
            grade=7,
            school=None,
            city=None,
            state=None,
            session_cm_id=None,
        )
        cache._person_cache[12345] = current_person
        cache._attendees_with_sessions[12345] = {
            "session_cm_id": 1001,
            "session_name": "Session 2",
            "parent_session_id": 1001,
            "parent_session_name": "Session 2",
        }

        # Historical attendance (different year in historical_bunking)
        cache._historical_bunking[12345] = {
            2024: {
                "session_cm_id": 1002,
                "session_name": "Session 3",
                "parent_session_id": 1002,
                "parent_session_name": "Session 3",
                "bunk_name": "B-5",
                "session_type": "main",
            }
        }

        cache._build_name_index()

        # Should find in current year
        results = cache.find_by_name("John", "Smith", year=2025)
        assert len(results) == 1

        # Should also find in historical year
        results = cache.find_by_name("John", "Smith", year=2024)
        assert len(results) == 1

    def test_empty_cache_returns_empty_list(self):
        """Test that lookups on empty cache return empty list, not error"""
        from bunking.sync.bunk_request_processor.data.cache.temporal_name_cache import (
            TemporalNameCache,
        )

        pb = Mock()
        cache = TemporalNameCache(pb, year=2025)
        # Don't initialize - empty cache

        results = cache.find_by_name("NonExistent", "Person", year=2025)
        assert results == []

        results = cache.find_by_first_name("Nobody", year=2025)
        assert results == []

    def test_get_session_info_for_person(self):
        """Test that session info is available for current year attendees"""
        from bunking.sync.bunk_request_processor.core.models import Person
        from bunking.sync.bunk_request_processor.data.cache.temporal_name_cache import (
            TemporalNameCache,
        )

        pb = Mock()
        cache = TemporalNameCache(pb, year=2025)

        test_person = Person(
            cm_id=12345,
            first_name="John",
            last_name="Smith",
            preferred_name=None,
            birth_date=datetime(2012, 5, 15),
            grade=7,
            school=None,
            city=None,
            state=None,
            session_cm_id=None,
        )
        cache._person_cache[12345] = test_person
        cache._attendees_with_sessions[12345] = {
            "session_cm_id": 1001,
            "session_name": "Session 2",
            "parent_session_id": 1001,
            "parent_session_name": "Session 2",
        }
        cache._build_name_index()

        # Test get_session_info
        session_info = cache.get_session_info(12345)
        assert session_info is not None
        assert session_info["session_cm_id"] == 1001
        assert session_info["session_name"] == "Session 2"

    def test_get_person_by_cm_id(self):
        """Test O(1) lookup by CM ID"""
        from bunking.sync.bunk_request_processor.core.models import Person
        from bunking.sync.bunk_request_processor.data.cache.temporal_name_cache import (
            TemporalNameCache,
        )

        pb = Mock()
        cache = TemporalNameCache(pb, year=2025)

        test_person = Person(
            cm_id=12345,
            first_name="John",
            last_name="Smith",
            preferred_name=None,
            birth_date=datetime(2012, 5, 15),
            grade=7,
            school=None,
            city=None,
            state=None,
            session_cm_id=None,
        )
        cache._person_cache[12345] = test_person

        result = cache.get_person(12345)
        assert result is not None
        assert result.cm_id == 12345

        # Non-existent person
        result = cache.get_person(99999)
        assert result is None

    def test_parent_surname_index_populated_when_parent_names_present(self):
        """Regression for #1393: when Persons have populated parent_names JSON,
        the surname index must build a non-empty entry per unique surname.

        Pre-fix, every Person had parent_names=null because the Go sync read
        non-existent fields from CampMinder's Relatives array. The index built
        with 0 unique surnames every run, silently neutering parent-surname
        recovery in the bunk request resolution pipeline.
        """
        import json

        from bunking.sync.bunk_request_processor.core.models import Person
        from bunking.sync.bunk_request_processor.data.cache.temporal_name_cache import (
            TemporalNameCache,
        )

        pb = Mock()
        cache = TemporalNameCache(pb, year=2026)

        # Two campers, each with one parent whose surname differs from the
        # camper's own — that mismatch is what the surname index exists to
        # recover.
        emma = Person(
            cm_id=1001,
            first_name="Emma",
            last_name="Johnson",
            preferred_name=None,
            birth_date=datetime(2013, 6, 1),
            grade=7,
            school=None,
            city=None,
            state=None,
            session_cm_id=None,
            parent_names=json.dumps(
                [
                    {"first": "Sarah", "last": "Johnson", "relationship": "Guardian", "is_primary": False},
                    {"first": "David", "last": "Garcia", "relationship": "Guardian", "is_primary": False},
                ]
            ),
        )
        liam = Person(
            cm_id=1002,
            first_name="Liam",
            last_name="Garcia",
            preferred_name=None,
            birth_date=datetime(2012, 9, 1),
            grade=8,
            school=None,
            city=None,
            state=None,
            session_cm_id=None,
            parent_names=json.dumps(
                [
                    {"first": "Olivia", "last": "Chen", "relationship": "Guardian", "is_primary": False},
                    {"first": "Samuel", "last": "Garcia", "relationship": "Guardian", "is_primary": False},
                ]
            ),
        )

        for person in (emma, liam):
            cache._person_cache[person.cm_id] = person
            cache._attendees_with_sessions[person.cm_id] = {
                "session_cm_id": 1,
                "session_name": "Session 1",
                "parent_session_id": 1,
                "parent_session_name": "Session 1",
            }

        cache._build_parent_surname_index()

        # Three distinct surnames across both campers: Johnson, Garcia, Chen.
        # (Garcia is shared between Emma's dad and Liam's dad.)
        assert len(cache._parent_surname_index) == 3, (
            f"expected 3 surname keys, got {len(cache._parent_surname_index)}: "
            f"{sorted(cache._parent_surname_index.keys())}"
        )

        # Cross-surname recovery: searching "Emma Garcia" must find Emma Johnson
        # (her dad has surname Garcia) — this is the whole point of the index.
        results = cache.find_by_parent_surname("Emma", "Garcia")
        # Both campers share "Garcia" in the index (Emma via dad, Liam via dad
        # and his own last_name), but first-name filtering narrows to Emma.
        assert len(results) == 1
        assert results[0].cm_id == 1001

        # Searching "Liam Chen" must find Liam Garcia (his mom is Chen).
        results = cache.find_by_parent_surname("Liam", "Chen")
        assert len(results) == 1
        assert results[0].cm_id == 1002

    def test_parent_surname_index_empty_when_parent_names_null(self):
        """When Persons have parent_names=None (the pre-#1393 state), the
        surname index builds with zero entries. Locks the contract: the index
        is a pure function of parent_names input, no other side channels."""
        from bunking.sync.bunk_request_processor.core.models import Person
        from bunking.sync.bunk_request_processor.data.cache.temporal_name_cache import (
            TemporalNameCache,
        )

        pb = Mock()
        cache = TemporalNameCache(pb, year=2026)

        person = Person(
            cm_id=1001,
            first_name="Emma",
            last_name="Johnson",
            preferred_name=None,
            birth_date=datetime(2013, 6, 1),
            grade=7,
            school=None,
            city=None,
            state=None,
            session_cm_id=None,
            parent_names=None,
        )
        cache._person_cache[1001] = person
        cache._attendees_with_sessions[1001] = {
            "session_cm_id": 1,
            "session_name": "Session 1",
            "parent_session_id": 1,
            "parent_session_name": "Session 1",
        }

        cache._build_parent_surname_index()
        assert cache._parent_surname_index == {}

    def test_find_by_parent_surname_returns_empty_for_unknown_surname(self):
        """Negative case: lookup for a surname not in any parent_names returns
        []. Locks the contract that absence is silent, not exceptional."""
        import json

        from bunking.sync.bunk_request_processor.core.models import Person
        from bunking.sync.bunk_request_processor.data.cache.temporal_name_cache import (
            TemporalNameCache,
        )

        pb = Mock()
        cache = TemporalNameCache(pb, year=2026)

        emma = Person(
            cm_id=1001,
            first_name="Emma",
            last_name="Johnson",
            preferred_name=None,
            birth_date=datetime(2013, 6, 1),
            grade=7,
            school=None,
            city=None,
            state=None,
            session_cm_id=None,
            parent_names=json.dumps(
                [{"first": "Sarah", "last": "Johnson", "relationship": "Guardian", "is_primary": False}]
            ),
        )
        cache._person_cache[1001] = emma
        cache._attendees_with_sessions[1001] = {
            "session_cm_id": 1,
            "session_name": "Session 1",
            "parent_session_id": 1,
            "parent_session_name": "Session 1",
        }
        cache._build_parent_surname_index()

        # Surname not in any indexed parent_names
        assert cache.find_by_parent_surname("Emma", "Patel") == []

    def test_find_by_parent_surname_returns_empty_for_first_name_mismatch(self):
        """Negative case: surname matches the index but first name doesn't.
        The surname index is a candidate set; first-name filter narrows it."""
        import json

        from bunking.sync.bunk_request_processor.core.models import Person
        from bunking.sync.bunk_request_processor.data.cache.temporal_name_cache import (
            TemporalNameCache,
        )

        pb = Mock()
        cache = TemporalNameCache(pb, year=2026)

        emma = Person(
            cm_id=1001,
            first_name="Emma",
            last_name="Johnson",
            preferred_name=None,
            birth_date=datetime(2013, 6, 1),
            grade=7,
            school=None,
            city=None,
            state=None,
            session_cm_id=None,
            parent_names=json.dumps(
                [{"first": "David", "last": "Garcia", "relationship": "Guardian", "is_primary": False}]
            ),
        )
        cache._person_cache[1001] = emma
        cache._attendees_with_sessions[1001] = {
            "session_cm_id": 1,
            "session_name": "Session 1",
            "parent_session_id": 1,
            "parent_session_name": "Session 1",
        }
        cache._build_parent_surname_index()

        # "Garcia" is in the index (Emma's dad), but no camper named "Liam" has
        # a Garcia parent.
        assert cache.find_by_parent_surname("Liam", "Garcia") == []

    def test_find_by_parent_surname_matches_via_preferred_name(self):
        """Preferred name should match alongside first_name. Otherwise campers
        who go by a nickname (Liam → Bo) would be invisible to surname lookups
        even when the surname matches."""
        import json

        from bunking.sync.bunk_request_processor.core.models import Person
        from bunking.sync.bunk_request_processor.data.cache.temporal_name_cache import (
            TemporalNameCache,
        )

        pb = Mock()
        cache = TemporalNameCache(pb, year=2026)

        liam = Person(
            cm_id=1002,
            first_name="Liam",
            last_name="Garcia",
            preferred_name="Bo",
            birth_date=datetime(2012, 9, 1),
            grade=8,
            school=None,
            city=None,
            state=None,
            session_cm_id=None,
            parent_names=json.dumps(
                [{"first": "Olivia", "last": "Chen", "relationship": "Guardian", "is_primary": False}]
            ),
        )
        cache._person_cache[1002] = liam
        cache._attendees_with_sessions[1002] = {
            "session_cm_id": 1,
            "session_name": "Session 1",
            "parent_session_id": 1,
            "parent_session_name": "Session 1",
        }
        cache._build_parent_surname_index()

        # Request submitted using preferred name "Bo" + mom's surname "Chen"
        results = cache.find_by_parent_surname("Bo", "Chen")
        assert len(results) == 1
        assert results[0].cm_id == 1002

    def test_parent_surname_index_empty_when_parent_names_is_empty_array(self):
        """Empty JSON array `[]` is distinct from `None` but yields the same
        empty-index result. Locks the contract that the index is a function of
        actual parent records, not of the JSON wrapper."""
        import json

        from bunking.sync.bunk_request_processor.core.models import Person
        from bunking.sync.bunk_request_processor.data.cache.temporal_name_cache import (
            TemporalNameCache,
        )

        pb = Mock()
        cache = TemporalNameCache(pb, year=2026)

        person = Person(
            cm_id=1001,
            first_name="Emma",
            last_name="Johnson",
            preferred_name=None,
            birth_date=datetime(2013, 6, 1),
            grade=7,
            school=None,
            city=None,
            state=None,
            session_cm_id=None,
            parent_names=json.dumps([]),
        )
        cache._person_cache[1001] = person
        cache._attendees_with_sessions[1001] = {
            "session_cm_id": 1,
            "session_name": "Session 1",
            "parent_session_id": 1,
            "parent_session_name": "Session 1",
        }

        cache._build_parent_surname_index()
        assert cache._parent_surname_index == {}
        assert cache.find_by_parent_surname("Emma", "Johnson") == []

    def test_load_person_cache_warns_when_zero_persons(self, caplog):
        from bunking.sync.bunk_request_processor.data.cache.temporal_name_cache import (
            TemporalNameCache,
        )

        pb = Mock()
        pb.collection.return_value.get_full_list.return_value = []
        cache = TemporalNameCache(pb, year=2025)

        with caplog.at_level(
            logging.WARNING,
            logger="bunking.sync.bunk_request_processor.data.cache.temporal_name_cache",
        ):
            cache._load_person_cache()

        assert cache._stats["persons_loaded"] == 0
        assert any(
            record.levelno == logging.WARNING and "Loaded 0 persons" in record.message for record in caplog.records
        )


def _bunk_assignment(
    person_cm_id: int,
    year: int,
    bunk_name: str,
    session_cm_id: int,
    session_type: str,
    record_id: str,
) -> Mock:
    """Build a bunk_assignments record whose expand looks like PocketBase's."""
    assignment = Mock(spec=["expand", "year", "id"])
    assignment.id = record_id
    assignment.year = year
    person = Mock(spec=["cm_id"])
    person.cm_id = person_cm_id
    bunk = Mock(spec=["name"])
    bunk.name = bunk_name
    session = Mock(spec=["cm_id", "session_type", "name"])
    session.cm_id = session_cm_id
    session.session_type = session_type
    session.name = f"Session {session_cm_id}"
    assignment.expand = {"person": person, "bunk": bunk, "session": session}
    return assignment


def _load_cache(assignments):
    """Run _load_historical_bunking against mocked PocketBase collections."""
    from bunking.sync.bunk_request_processor.data.cache.temporal_name_cache import (
        TemporalNameCache,
    )

    captured: dict[str, Any] = {}

    sessions_collection = Mock()
    sessions_collection.get_full_list = Mock(return_value=[])

    assignments_collection = Mock()

    def _get_full_list(**kwargs):
        captured.update(kwargs.get("query_params", {}))
        return list(assignments)

    assignments_collection.get_full_list = Mock(side_effect=_get_full_list)

    pb = Mock()
    pb.collection = Mock(
        side_effect=lambda name: sessions_collection if name == "camp_sessions" else assignments_collection
    )

    cache = TemporalNameCache(pb, year=2026)
    cache._load_historical_bunking()
    return cache, captured


class TestHistoricalBunkingSessionType:
    """The temporal cache must not treat Family Camp day groups as cabins (#2427)."""

    def test_record_carries_session_type_and_bunk_name(self):
        cache, _ = _load_cache([_bunk_assignment(1001, 2025, "Cabin 7", 500, "main", "rec_a")])

        record = cache.get_historical_info(1001, 2025)
        assert record is not None
        assert record["session_type"] == "main"
        # The producer must write the key `verify_bunk_together` reads.
        assert record["bunk_name"] == "Cabin 7"

    def test_load_is_deterministic_and_keeps_day_group_people_in_the_index(self):
        """The load stays unfiltered on purpose — the name index needs those people."""
        cache, captured = _load_cache([_bunk_assignment(1002, 2025, "Day Group 3", 900, "family", "rec_b")])

        assert captured.get("sort") == "id"
        # A Family Camp attendee is still a real prior-year person for name resolution.
        assert 2025 in cache._historical_bunking[1002]
        assert cache._historical_bunking[1002][2025]["session_type"] == "family"

    def test_eligible_row_beats_a_day_group_row_whatever_the_order(self):
        eligible = _bunk_assignment(1003, 2025, "Cabin 7", 500, "main", "rec_c")
        day_group = _bunk_assignment(1003, 2025, "Day Group 3", 900, "family", "rec_d")

        for rows in ([day_group, eligible], [eligible, day_group]):
            cache, _ = _load_cache(rows)
            record = cache.get_historical_info(1003, 2025)
            assert record["bunk_name"] == "Cabin 7"
            assert record["session_type"] == "main"

    def test_verify_bunk_together_reads_what_the_loader_writes(self):
        """The producer wrote "bunk" and the consumer read "bunk_name" — it was inert."""
        cache, _ = _load_cache(
            [
                _bunk_assignment(1004, 2025, "Cabin 7", 500, "main", "rec_e"),
                _bunk_assignment(1005, 2025, "Cabin 7", 500, "main", "rec_f"),
            ]
        )

        were_together, bunk_name = cache.verify_bunk_together(1004, [1005], 2025)

        assert were_together is True
        assert bunk_name == "Cabin 7"

    def test_verify_bunk_together_rejects_a_shared_day_group(self):
        cache, _ = _load_cache(
            [
                _bunk_assignment(1006, 2025, "Day Group 3", 900, "family", "rec_g"),
                _bunk_assignment(1007, 2025, "Day Group 3", 900, "family", "rec_h"),
            ]
        )

        assert cache.verify_bunk_together(1006, [1007], 2025) == (False, "")

    def test_verify_bunk_together_rejects_a_target_from_another_session(self):
        """Same cabin name, different week — not bunkmates."""
        cache, _ = _load_cache(
            [
                _bunk_assignment(1008, 2025, "Cabin 7", 500, "main", "rec_i"),
                _bunk_assignment(1009, 2025, "Cabin 7", 501, "main", "rec_j"),
            ]
        )

        assert cache.verify_bunk_together(1008, [1009], 2025) == (False, "")
