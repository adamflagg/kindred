"""Typed PocketBase record shapes used by the graph builder.

PocketBase's ``Record`` class uses ``setattr`` at load time so attribute access
is invisible to pyright. This module defines ``TypedDict`` shapes for the
record shapes actually consumed by ``social_graph_builder.py`` and provides
lightweight cast helpers that copy dynamic attributes into the typed dict.

These are **boundary types only** — they don't enforce schema at the network
layer, just at the Python attribute-access layer. If PocketBase adds or
renames a field, update the TypedDict here and fix the resulting mypy/pyright
noise.

Do NOT widen this to other files in this PR. If ``optimized_graph_builder.py``
or other consumers need the same shapes, lift into a shared ``bunking/pb_types/``
package in a follow-up issue.
"""

from typing import Any, TypedDict

# ---------------------------------------------------------------------------
# CampSessions collection
# ---------------------------------------------------------------------------


class CampSessionRecord(TypedDict):
    """Fields from the ``camp_sessions`` PocketBase collection.

    All keys are required (``total=True`` default). The cast helper always
    supplies every field (falling back to a safe default), so direct
    ``record["name"]`` access never raises ``KeyError``.
    """

    id: str
    cm_id: int
    name: str
    session_type: str


# ---------------------------------------------------------------------------
# Persons collection
# ---------------------------------------------------------------------------


class _PersonRecordRequired(TypedDict):
    """Required (always-present) fields from the ``persons`` collection."""

    id: str
    cm_id: int
    first_name: str
    last_name: str
    grade: int
    gender: str
    household_id: int
    school: str
    age: int | None


class PersonRecord(_PersonRecordRequired, total=False):
    """All fields from the ``persons`` collection.

    Required fields are in ``_PersonRecordRequired``. Optional fields are
    declared here with ``total=False``.
    """


# ---------------------------------------------------------------------------
# Cast helpers
# ---------------------------------------------------------------------------


def cast_person(record: Any) -> PersonRecord:
    """Extract ``PersonRecord`` fields from a PocketBase ``Record`` instance.

    Pulls only the fields defined in ``PersonRecord`` so the resulting dict is
    typed. The cast helper always supplies every required field (using safe
    defaults), so callers can use ``record["field"]`` without KeyError.
    """
    return PersonRecord(
        id=getattr(record, "id", ""),
        cm_id=getattr(record, "cm_id", 0),
        first_name=getattr(record, "first_name", ""),
        last_name=getattr(record, "last_name", ""),
        grade=getattr(record, "grade", 0),
        gender=getattr(record, "gender", ""),
        household_id=getattr(record, "household_id", 0),
        age=getattr(record, "age", None),
        school=getattr(record, "school", ""),
    )


def cast_session(record: Any) -> CampSessionRecord:
    """Extract ``CampSessionRecord`` fields from a PocketBase ``Record``. Always supplies every field with a safe default."""
    return CampSessionRecord(
        id=getattr(record, "id", ""),
        cm_id=getattr(record, "cm_id", 0),
        name=getattr(record, "name", ""),
        session_type=getattr(record, "session_type", ""),
    )
