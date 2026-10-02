"""A batch that lost a race to another writer is G6's conflict, answered 409 (slice 3 back-end PR-B: the grants,
grantor and source writes). Anything else PocketBase refuses stays the fault it is. Fictional only."""

from __future__ import annotations

import pytest

from bunking.financial_aid.change_log import CONFLICT_MESSAGE, race_conflict
from bunking.pocketbase_batch import BatchRequest, BatchRequestFailedError


def _failed(
    request: BatchRequest | None, status: int, field_errors: dict[str, str] | None = None
) -> BatchRequestFailedError:
    return BatchRequestFailedError(
        index=0,
        total=2,
        request=request,
        status=status,
        message="refused",
        field_errors=field_errors or {},
        response=None,
    )


def test_an_update_whose_record_someone_removed_first_is_a_race_naming_it() -> None:
    request = BatchRequest.update("aid_grantors", "gra000000000001", {"name": "Regional Fund"})
    conflict = race_conflict(_failed(request, 404))
    assert conflict is not None
    assert (conflict.collection, conflict.record_id, str(conflict)) == (
        "aid_grantors",
        "gra000000000001",
        CONFLICT_MESSAGE,
    )


def test_a_create_a_unique_index_refused_is_a_race() -> None:
    """A double click, or two staff: the second create of one grantor key, or of one grant line's placement."""
    request = BatchRequest.create("aid_attribution_overrides", {"id": "ovr000000000001", "transaction_cm_id": 9001})
    conflict = race_conflict(_failed(request, 400, {"transaction_cm_id": "Value must be unique."}))
    assert conflict is not None
    assert (conflict.collection, conflict.record_id) == ("aid_attribution_overrides", "")


@pytest.mark.parametrize(
    ("request_", "status", "errors"),
    [
        (BatchRequest.create("aid_grantors", {"id": "gra000000000002"}), 404, {}),  # a missing collection: a fault
        (BatchRequest.create("aid_grantors", {"id": "gra000000000002"}), 400, {"name": "Cannot be blank."}),
        (BatchRequest.update("aid_grantors", "gra000000000001", {"name": ""}), 400, {"name": "Cannot be blank."}),
        (None, 404, {}),
    ],
)
def test_any_other_refusal_is_not_dressed_as_a_race(
    request_: BatchRequest | None, status: int, errors: dict[str, str]
) -> None:
    assert race_conflict(_failed(request_, status, errors)) is None
