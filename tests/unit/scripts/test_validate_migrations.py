"""Tests for the migration validation script."""

import json
import subprocess
import sys
from pathlib import Path
from typing import Any, ClassVar

SCRIPT_PATH = Path(__file__).parents[3] / "scripts" / "ci" / "validate_migrations.py"


def run_validator(collections: list[dict[str, Any]]) -> tuple[int, str, str]:
    """Run the validation script with the given collections data."""
    result = subprocess.run(
        [sys.executable, str(SCRIPT_PATH), "-"],
        input=json.dumps(collections),
        capture_output=True,
        text=True,
    )
    return result.returncode, result.stdout, result.stderr


def make_collection(
    name: str,
    collection_id: str | None = None,
    fields: list[dict[str, Any]] | None = None,
    indexes: list[str] | None = None,
) -> dict[str, Any]:
    """Create a minimal collection structure for testing."""
    return {
        "id": collection_id or f"col_{name}",
        "name": name,
        "type": "base",
        "fields": fields or [],
        "indexes": indexes or [],
    }


def make_field(
    name: str,
    field_type: str = "text",
    required: bool = False,
    **kwargs: Any,
) -> dict[str, Any]:
    """Create a minimal field structure for testing."""
    field = {
        "name": name,
        "type": field_type,
        "required": required,
    }
    field.update(kwargs)
    return field


class TestRequiredCollections:
    """Test that missing required collections are detected."""

    def test_missing_collection_fails(self):
        """Missing required collection should fail validation."""
        # Create minimal set without 'attendees'
        collections = [
            make_collection("bunks"),
            make_collection("persons"),
        ]
        code, stdout, _ = run_validator(collections)
        assert code == 1
        assert "Missing required collection" in stdout
        assert "attendees" in stdout

    def test_all_required_collections_pass(self):
        """All required collections present should pass (this check only)."""
        # Minimal collections with required fields to pass other checks
        persons_col = make_collection(
            "persons",
            collection_id="col_persons",
            fields=[
                make_field("cm_id", "number", required=True),
                make_field("first_name", "text", required=True),
                make_field("last_name", "text", required=True),
                make_field("year", "number", required=True),
                make_field(
                    "household",
                    "relation",
                    collectionId="col_households",
                ),
            ],
            indexes=["CREATE UNIQUE INDEX `idx_persons_campminder` ON `persons` ..."],
        )

        # Note: This test is minimal - full integration would need all collections
        # with proper relations. Here we just test the existence check works.
        collections = [
            make_collection(
                "attendees",
                fields=[
                    make_field("person_id", "number"),
                    make_field("person", "relation", collectionId="col_persons"),
                    make_field(
                        "status", "select", values=["none", "enrolled", "applied", "waitlisted", "cancelled", "unknown"]
                    ),
                    make_field("year", "number"),
                    make_field("session", "relation", collectionId="col_sessions"),
                ],
                indexes=["CREATE UNIQUE INDEX `idx_attendees_unique` ON `attendees` ..."],
            ),
            make_collection(
                "bunks",
                fields=[
                    make_field("cm_id", "number"),
                    make_field("name", "text"),
                    make_field("gender", "text"),
                    make_field("year", "number"),
                ],
            ),
            make_collection(
                "bunk_assignments",
                fields=[
                    make_field("year", "number"),
                    make_field("session", "relation", collectionId="col_sessions"),
                    make_field("bunk", "relation", collectionId="col_bunks"),
                    make_field("person", "relation", collectionId="col_persons"),
                ],
            ),
            make_collection(
                "bunk_plans",
                collection_id="col_plans",
                fields=[
                    make_field("year", "number"),
                    make_field("session", "relation", collectionId="col_sessions"),
                    make_field("bunk", "relation", collectionId="col_bunks"),
                ],
            ),
            make_collection("bunk_requests"),
            make_collection(
                "camp_sessions",
                collection_id="col_sessions",
                fields=[
                    make_field("cm_id", "number"),
                    make_field("name", "text"),
                    make_field("year", "number"),
                    make_field("session_type", "select", values=["main", "ag", "embedded"]),
                ],
            ),
            make_collection("config"),
            make_collection("divisions", collection_id="col_divisions"),
            make_collection("households", collection_id="col_households"),
            make_collection("original_bunk_requests"),
            persons_col,
            make_collection("session_groups"),
            make_collection("users"),
        ]
        code, stdout, _ = run_validator(collections)
        # May still fail on other checks, but not on "Missing required collection"
        if code != 0:
            assert "Missing required collection" not in stdout


class TestRequiredFields:
    """Test that missing required fields are detected."""

    def test_missing_field_detected(self):
        """Missing required field should fail validation."""
        collections = [
            make_collection(
                "attendees",
                fields=[
                    # Missing person_id, person, status, year, session
                ],
            ),
            # Include other required collections minimally
            make_collection("bunks"),
            make_collection("bunk_assignments"),
            make_collection("bunk_plans"),
            make_collection("bunk_requests"),
            make_collection("camp_sessions"),
            make_collection("config"),
            make_collection("divisions"),
            make_collection("households"),
            make_collection("original_bunk_requests"),
            make_collection("persons"),
            make_collection("session_groups"),
            make_collection("users"),
        ]
        code, stdout, _ = run_validator(collections)
        assert code == 1
        assert "Missing field" in stdout
        assert "attendees" in stdout


class TestSelectValues:
    """Test that select fields have required values."""

    def test_missing_select_value_detected(self):
        """Missing value in select field should fail validation."""
        collections = [
            make_collection(
                "attendees",
                fields=[
                    make_field("person_id", "number"),
                    make_field("person", "relation", collectionId="col_persons"),
                    # status missing 'none' value
                    make_field(
                        "status",
                        "select",
                        values=["enrolled", "applied"],  # Missing none, waitlisted, etc
                    ),
                    make_field("year", "number"),
                    make_field("session", "relation", collectionId="col_sessions"),
                ],
                indexes=["CREATE UNIQUE INDEX `idx_attendees_unique` ..."],
            ),
            make_collection(
                "bunks",
                fields=[
                    make_field("cm_id", "number"),
                    make_field("name", "text"),
                    make_field("gender", "text"),
                    make_field("year", "number"),
                ],
            ),
            make_collection(
                "bunk_assignments",
                fields=[
                    make_field("year", "number"),
                    make_field("session", "relation"),
                    make_field("bunk", "relation"),
                    make_field("person", "relation"),
                ],
            ),
            make_collection(
                "bunk_plans",
                fields=[
                    make_field("year", "number"),
                    make_field("session", "relation"),
                    make_field("bunk", "relation"),
                ],
            ),
            make_collection("bunk_requests"),
            make_collection(
                "camp_sessions",
                collection_id="col_sessions",
                fields=[
                    make_field("cm_id", "number"),
                    make_field("name", "text"),
                    make_field("year", "number"),
                    make_field("session_type", "select", values=["main", "ag", "embedded"]),
                ],
            ),
            make_collection("config"),
            make_collection("divisions"),
            make_collection("households"),
            make_collection("original_bunk_requests"),
            make_collection(
                "persons",
                collection_id="col_persons",
                fields=[
                    make_field("cm_id", "number"),
                    make_field("first_name", "text"),
                    make_field("last_name", "text"),
                    make_field("year", "number"),
                    make_field("household", "relation"),
                ],
                indexes=["CREATE UNIQUE INDEX `idx_persons_campminder` ..."],
            ),
            make_collection("session_groups"),
            make_collection("users"),
        ]
        code, stdout, _ = run_validator(collections)
        assert code == 1
        assert "missing values" in stdout
        assert "none" in stdout


class TestEdgeCases:
    """Test edge cases and error handling."""

    def test_empty_collections_list(self):
        """Empty collections list should fail."""
        code, stdout, _ = run_validator([])
        assert code == 1
        assert "Missing required collection" in stdout

    def test_invalid_json_input(self):
        """Invalid JSON should fail gracefully."""
        result = subprocess.run(
            [sys.executable, str(SCRIPT_PATH), "-"],
            input="not valid json",
            capture_output=True,
            text=True,
        )
        assert result.returncode == 1
        assert "Failed to load" in result.stderr

    def test_paginated_response_format(self):
        """Should handle paginated response format with 'items' key."""
        # PocketBase returns { items: [...], page: 1, perPage: 30, ... }
        collections = [
            make_collection("attendees"),
            make_collection("bunks"),
            # ... other required
        ]
        paginated = {"items": collections, "page": 1, "perPage": 30, "totalItems": 2}
        result = subprocess.run(
            [sys.executable, str(SCRIPT_PATH), "-"],
            input=json.dumps(paginated),
            capture_output=True,
            text=True,
        )
        # Will fail on missing collections but should parse correctly
        assert "Validating PocketBase schema" in result.stdout


class TestTextFieldExactLimits:
    """Exact caps on the columns that mirror free-text CampMinder answers.

    `TEXT_FIELDS_REQUIRE_CUSTOM_LIMIT` only asserts a field is not sitting on
    PocketBase's 5000 default, which says nothing about a field capped far too
    LOW. That is the failure that reached production: `away_from_date` at 100
    refused a parent's 130-character answer and the whole
    `household_demographics` transform job reported failure.

    Migration 1500000163 widened those columns by mutating fields in place, so
    no collection literal in `pb_migrations/` states the resulting cap and no
    static read of the migrations can confirm it. This validator runs against a
    booted PocketBase's `/api/collections` after every migration has applied,
    which is the only place the real number is observable.
    """

    HOUSEHOLD_DEMOGRAPHICS_WIDENED: ClassVar[list[str]] = [
        "jewish_affiliation",
        "jewish_affiliation_other",
        "congregation_summer",
        "congregation_family",
        "jcc_summer",
        "jcc_family",
        "away_location",
        "away_phone",
        "away_from_date",
        "away_return_date",
        "form_filler",
    ]

    def _household_demographics(self, overrides: dict[str, int] | None = None) -> dict[str, Any]:
        caps = dict.fromkeys(self.HOUSEHOLD_DEMOGRAPHICS_WIDENED, 1000)
        caps.update(overrides or {})
        return make_collection(
            "household_demographics",
            fields=[make_field(name, max=cap) for name, cap in caps.items()],
        )

    def test_narrowed_field_detected(self):
        """A column back at its old cap fails, naming the field and the cap."""
        collections = [self._household_demographics({"away_from_date": 100})]
        code, stdout, _ = run_validator(collections)

        assert code == 1
        assert "away_from_date" in stdout
        assert "1000" in stdout

    def test_every_widened_field_is_checked(self):
        """Each of the eleven is guarded, not just the two that failed.

        Narrowing them one at a time proves the spec covers all of them --
        a check listing only `away_*` would pass nine of these.
        """
        for field_name in self.HOUSEHOLD_DEMOGRAPHICS_WIDENED:
            collections = [self._household_demographics({field_name: 100})]
            code, stdout, _ = run_validator(collections)

            assert code == 1, f"{field_name} narrowed to 100 did not fail validation"
            assert field_name in stdout, f"{field_name} narrowed to 100 was not reported"

    def test_correct_limits_raise_no_text_cap_error(self):
        """All eleven at 1000 produce no cap complaint.

        Other validations still fail on this deliberately minimal input, so
        this asserts the ABSENCE of the cap message rather than exit code 0.
        """
        collections = [self._household_demographics()]
        _, stdout, _ = run_validator(collections)

        assert "expected max" not in stdout

    def test_missing_collection_is_not_an_error_here(self):
        """A dump without the collection is another check's problem, not this one."""
        collections = [make_collection("persons")]
        _, stdout, _ = run_validator(collections)

        assert "expected max" not in stdout
