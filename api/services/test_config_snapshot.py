"""TDD tests for solver-config snapshot capture.

These tests use real `pocketbase.models.record.Record` objects shaped per the
actual `config` migration (1500000011) — not MagicMock — so a mismatch between
the code's assumed collection/field names and the real schema fails loudly
instead of being papered over by MagicMock's auto-attributes.
"""

from typing import Any
from unittest.mock import MagicMock

import pytest
from pocketbase.models.record import Record

from api.services.config_snapshot import snapshot_solver_config


def _config_row(
    *,
    category: str,
    config_key: str,
    value: Any,
    subcategory: str | None = None,
) -> Record:
    """Build a real pocketbase Record with the same field set the prod
    `config` collection has (category, subcategory, config_key, value)."""
    return Record(
        {
            "id": f"cfg_{category}_{config_key}",
            "category": category,
            "subcategory": subcategory,
            "config_key": config_key,
            "value": value,
            "metadata": {},
            "description": "",
        }
    )


@pytest.mark.asyncio
async def test_reads_from_config_collection_not_solver_config() -> None:
    """The collection in this codebase is named `config` (per migration
    1500000011_config.js). A previous draft read from `solver_config`,
    which doesn't exist; the broad except in the implementation swallowed
    the resulting 404 and silently returned `{}` for every solver run."""
    pb = MagicMock()
    pb.collection.return_value.get_full_list = MagicMock(return_value=[])

    await snapshot_solver_config(pb)

    pb.collection.assert_called_once_with("config")


@pytest.mark.asyncio
async def test_filters_to_solver_relevant_categories() -> None:
    """Only constraint/objective/soft/solver rows are part of the solver's
    knob surface (per migration's getBusinessCategory). The snapshot must
    pass a `filter=` query_param so unrelated AI/tour/spread rows aren't
    dragged in."""
    pb = MagicMock()
    pb.collection.return_value.get_full_list = MagicMock(return_value=[])

    await snapshot_solver_config(pb)

    get_full_list = pb.collection.return_value.get_full_list
    assert get_full_list.called
    _, kwargs = get_full_list.call_args
    query_params = kwargs.get("query_params") or {}
    filter_str = query_params.get("filter", "") if isinstance(query_params, dict) else ""
    # Expect every solver-relevant category to appear in the filter.
    for cat in ("constraint", "objective", "soft", "solver"):
        assert cat in filter_str, f"snapshot filter must include category {cat!r}; got {filter_str!r}"


@pytest.mark.asyncio
async def test_reconstructs_dot_notation_key_from_category_subcategory_config_key() -> None:
    """Real config rows store the dot-notation key split across
    (category, subcategory, config_key). The snapshot must reassemble
    them so historical runs are interpretable."""
    pb = MagicMock()
    pb.collection.return_value.get_full_list = MagicMock(
        return_value=[
            _config_row(category="constraint", subcategory="grade_spread", config_key="max", value=2),
            _config_row(category="objective", subcategory=None, config_key="first_request_multiplier", value=10),
            _config_row(category="solver", subcategory="time", config_key="default_seconds", value=60),
        ]
    )

    result = await snapshot_solver_config(pb)

    assert result == {
        "constraint.grade_spread.max": "2",
        "objective.first_request_multiplier": "10",
        "solver.time.default_seconds": "60",
    }


@pytest.mark.asyncio
async def test_reads_value_field_not_config_value() -> None:
    """The migration calls the column `value`, not `config_value`. A real
    Record has no `config_value` attribute, so reading it would AttributeError
    and trip the broad except → silent `{}`. This test proves the implementation
    reads the right attribute."""
    pb = MagicMock()
    pb.collection.return_value.get_full_list = MagicMock(
        return_value=[_config_row(category="solver", config_key="threads", value=4)]
    )

    result = await snapshot_solver_config(pb)

    assert result == {"solver.threads": "4"}


@pytest.mark.asyncio
async def test_returns_empty_dict_on_empty_collection() -> None:
    pb = MagicMock()
    pb.collection.return_value.get_full_list = MagicMock(return_value=[])
    result = await snapshot_solver_config(pb)
    assert result == {}


@pytest.mark.asyncio
async def test_returns_empty_dict_on_fetch_failure() -> None:
    """Snapshot is best-effort: a transient PB outage must not block solver
    runs from being persisted."""
    pb = MagicMock()
    pb.collection.return_value.get_full_list = MagicMock(side_effect=RuntimeError("PB down"))
    result = await snapshot_solver_config(pb)
    assert result == {}


@pytest.mark.asyncio
async def test_stringifies_non_string_values() -> None:
    """Record.value is JSON (per migration), so it can be int/float/bool/dict.
    The snapshot's contract is `dict[str, str]` for downstream JSON-serialization
    of the details blob; coerce to str so historical rows don't become
    type-divergent across runs."""
    pb = MagicMock()
    pb.collection.return_value.get_full_list = MagicMock(
        return_value=[
            _config_row(category="solver", config_key="threads", value=4),
            _config_row(category="constraint", config_key="strict", value=True),
            _config_row(category="objective", config_key="weight", value=1.5),
        ]
    )

    result = await snapshot_solver_config(pb)

    assert result["solver.threads"] == "4"
    assert result["constraint.strict"] == "True"
    assert result["objective.weight"] == "1.5"
