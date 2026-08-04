"""Tests for scripts/dev/lib/parse_bed_bath.py.

Every input here is a VERBATIM value from the "Master Housing Tab" of the 2026
Master Housing Document. The parser exists to turn that column into the `beds`
JSON shape that `frontend/src/types/beds.ts` already ships, and the vocabulary
there is CLOSED: `normaliseBeds()` silently drops an entry whose type it does
not know, so an invented type id would write to PocketBase, pass every check,
and then disappear from the UI with no error. These tests pin the mapping onto
that vocabulary and nothing else.

The other half of the contract is refusal. `beds` is nullable and null means
UNKNOWN, so a value the parser cannot read in full must produce None rather
than a partial list — a partial list reads as a complete answer and understates
capacity silently, which is worse than admitting ignorance.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

_SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "dev" / "lib" / "parse_bed_bath.py"
_spec = importlib.util.spec_from_file_location("parse_bed_bath", _SCRIPT)
assert _spec is not None
assert _spec.loader is not None
parse_bed_bath = importlib.util.module_from_spec(_spec)
sys.modules[_spec.name] = parse_bed_bath
_spec.loader.exec_module(parse_bed_bath)

parse = parse_bed_bath.parse_bed_bath


# --- the shipped vocabulary ----------------------------------------------


def test_vocabulary_matches_the_shipped_frontend_types() -> None:
    """A type this parser can emit but beds.ts cannot render is a silent data loss.

    beds.ts is the source of truth; this asserts we never drift ahead of it.
    """
    shipped = Path(__file__).resolve().parents[2] / "frontend" / "src" / "types" / "beds.ts"
    text = shipped.read_text(encoding="utf-8")
    for bed_type in parse_bed_bath.EMITTABLE_TYPES:
        assert f"id: '{bed_type}'" in text, f"{bed_type} is not in BED_TYPES"


# --- clean comma lists, the common case ----------------------------------


def test_parses_the_standard_camper_cabin() -> None:
    """18 of 94 rows are exactly this. A bare 'bunk' is a twin-over-twin."""
    result = parse("6 bunks, 3 singles")

    assert result.beds == [
        {"type": "twin_bunk", "count": 6},
        {"type": "twin", "count": 3},
    ]
    assert result.reason == ""


def test_singles_are_twins_and_doubles_are_fulls() -> None:
    assert parse("4 singles").beds == [{"type": "twin", "count": 4}]
    assert parse("1 double, 2 singles").beds == [
        {"type": "full", "count": 1},
        {"type": "twin", "count": 2},
    ]


def test_preserves_source_order_so_the_list_round_trips() -> None:
    assert parse("3 singles, 1 full").beds == [
        {"type": "twin", "count": 3},
        {"type": "full", "count": 1},
    ]


def test_an_absent_count_means_one() -> None:
    assert parse("queen bed, shared bath").beds == [{"type": "queen", "count": 1}]
    assert parse("full/twin bunk bed, shared bath").beds == [{"type": "full_twin_bunk", "count": 1}]


# --- the two bunk types must not be confused -----------------------------


def test_full_twin_bunk_is_not_eaten_by_the_plainer_patterns() -> None:
    """'full/twin bunk' contains both 'full' and 'twin bunk' as substrings.

    Staff-confirmed as a distinct piece of furniture: twin on top, full below.
    It appears only in family/guest housing, never in a camper cabin.
    """
    assert parse("1 full/twin bunk, 1 twin bunk, mini fridge").beds == [
        {"type": "full_twin_bunk", "count": 1},
        {"type": "twin_bunk", "count": 1},
    ]


def test_twin_bunk_beds_plural_is_still_twin_bunk() -> None:
    assert parse("2 twin bunk beds, shared bath").beds == [{"type": "twin_bunk", "count": 2}]


# --- non-bed tokens are recognised, not treated as failures --------------


def test_ignores_bathroom_and_kitchen_tokens_that_have_their_own_columns() -> None:
    assert parse("1 full, 2 singles, bath, mini fridge").beds == [
        {"type": "full", "count": 1},
        {"type": "twin", "count": 2},
    ]


def test_a_room_count_prefix_does_not_hide_the_bed_list() -> None:
    """A semicolon separates the room summary from the beds themselves."""
    assert parse("2 bdrm, 1 bath, kitch; 1 queen, 1 full/twin bunk").beds == [
        {"type": "queen", "count": 1},
        {"type": "full_twin_bunk", "count": 1},
    ]


def test_a_loft_is_a_place_not_a_bed_type() -> None:
    assert parse("full in loft, bath").beds == [{"type": "full", "count": 1}]


# --- amenities ride along -------------------------------------------------


def test_distinguishes_a_private_mini_fridge_from_a_shared_one() -> None:
    assert parse("1 queen, 1 twin bunk, bath, mini fridge").fridge == "private"
    assert parse("1 queen, 1 twin bunk, shared mini fridge").fridge == "shared"
    assert parse("4 singles").fridge == ""


def test_reports_crib_and_changing_table_without_making_them_beds() -> None:
    """Both need a schema home of their own; neither is a bed."""
    crib = parse("2 rooms; 1 queen, 1 full/twin bunk bed + crib, bathroom")
    assert crib.crib is True
    assert crib.beds == [
        {"type": "queen", "count": 1},
        {"type": "full_twin_bunk", "count": 1},
    ]

    table = parse("1 queen, 1 twin bunk, changing table, shared mini fridge")
    assert table.changing_table is True
    assert table.crib is False


# --- qualifiers are kept, because they change the meaning ----------------


def test_keeps_a_mattress_qualifier_that_changes_what_the_bed_sleeps() -> None:
    """Two single frames carrying full mattresses may sleep four, not two.

    The shipped shape has nowhere to record that, so the bed count is emitted
    honestly and the qualifier is surfaced for a human instead of discarded.
    """
    result = parse("2 singles (w/ full mattress)")

    assert result.beds == [{"type": "twin", "count": 2}]
    assert result.qualifiers == ("w/ full mattress",)


def test_a_parenthetical_bunk_marks_the_pair_as_one_bunk() -> None:
    """New Trailer: '1 double, 2 singles (bunk)' against Capacity 4."""
    assert parse("1 double, 2 singles (bunk)").beds == [
        {"type": "full", "count": 1},
        {"type": "twin_bunk", "count": 1},
    ]


# --- refusal --------------------------------------------------------------


@pytest.mark.parametrize(
    ("text", "because"),
    [
        ("1 bd 1 bth, kitch", "bd is a bedroom, not a bed"),
        ("2 bdrm 2 bath", "rooms only, no bed data at all"),
        ("3 rm 2 bth", "rooms only, no bed data at all"),
        ("1 bed, bath, kitch", "a bed of unstated size"),
        ("1 queen, guest room, bath, kitchen, laundry", "guest room holds unlisted beds"),
    ],
)
def test_refuses_rather_than_guessing(text: str, because: str) -> None:
    result = parse(text)

    assert result.beds is None, f"should not have parsed ({because}): {text!r}"
    assert result.reason != "", "a refusal must say why"


def test_refuses_the_clouds_rest_prose() -> None:
    """Clouds Rest is normally let as one whole-house booking rather than per
    room, which is why its row describes four child rooms in prose where every
    other container appears only as its leaves. It is mapped by hand.
    """
    result = parse(
        "3+ bedrooms, 1 bath; side room w/ queen (full?), loft w/ queen (full?), "
        "queen futon in living room, back room w full/twin bunk + crib, "
        "laundry room with 1 twin)"
    )

    assert result.beds is None
    assert result.reason != ""


def test_an_empty_cell_is_unknown_not_empty() -> None:
    assert parse("").beds is None
    assert parse("   ").beds is None
