"""StaticConfigService: snapshot-backed, read-only ConfigLoader stand-in.

The solver child process (api/services/solve_executor.py) cannot carry a live
ConfigLoader across the pickle boundary, so the parent snapshots CONFIG_SCHEMA
values into a plain dict and the child wraps them in StaticConfigService.
"""

from typing import Any

import pytest

from bunking.config.errors import MissingKeyError, UnknownKeyError
from bunking.config.loader import ConfigLoader
from bunking.config.schema import CONFIG_SCHEMA
from bunking.config.static_service import StaticConfigService, snapshot_config

A_SCHEMA_KEY = next(iter(CONFIG_SCHEMA))


class TestStaticConfigService:
    def test_is_a_config_loader(self) -> None:
        svc = StaticConfigService({})
        assert isinstance(svc, ConfigLoader)

    def test_get_returns_snapshot_value(self) -> None:
        svc = StaticConfigService({A_SCHEMA_KEY: 42})
        assert svc.get(A_SCHEMA_KEY) == 42

    def test_get_unknown_key_raises(self) -> None:
        svc = StaticConfigService({})
        with pytest.raises(UnknownKeyError):
            svc.get("nonsense.key")

    def test_get_absent_key_raises_missing(self) -> None:
        svc = StaticConfigService({})
        with pytest.raises(MissingKeyError):
            svc.get(A_SCHEMA_KEY)

    def test_typed_getter_funnels_through_get(self) -> None:
        svc = StaticConfigService({A_SCHEMA_KEY: 7})
        assert svc.get_int(A_SCHEMA_KEY) == 7

    def test_typed_getter_default_engages_for_absent_key(self) -> None:
        svc = StaticConfigService({})
        assert svc.get_int(A_SCHEMA_KEY, default=99) == 99

    def test_update_config_raises(self) -> None:
        svc = StaticConfigService({A_SCHEMA_KEY: 1})
        with pytest.raises(NotImplementedError):
            svc.update_config(A_SCHEMA_KEY, 2)

    def test_snapshot_input_is_copied(self) -> None:
        values = {A_SCHEMA_KEY: 1}
        svc = StaticConfigService(values)
        values[A_SCHEMA_KEY] = 2
        assert svc.get(A_SCHEMA_KEY) == 1


class _FakeLoader:
    """Duck-typed loader: snapshot_config only calls .get(key)."""

    def __init__(self, value: Any = 5, missing: set[str] | None = None) -> None:
        self._value = value
        self._missing = missing or set()

    def get(self, key: str) -> Any:
        if key in self._missing:
            raise MissingKeyError(key)
        return self._value


class TestSnapshotConfig:
    def test_snapshot_covers_all_schema_keys(self) -> None:
        values = snapshot_config(_FakeLoader())  # type: ignore[arg-type]
        assert set(values) == set(CONFIG_SCHEMA)

    def test_snapshot_omits_missing_keys(self) -> None:
        values = snapshot_config(_FakeLoader(missing={A_SCHEMA_KEY}))  # type: ignore[arg-type]
        assert A_SCHEMA_KEY not in values
        assert len(values) == len(CONFIG_SCHEMA) - 1

    def test_snapshot_round_trip(self) -> None:
        svc = StaticConfigService(snapshot_config(_FakeLoader(value=5)))  # type: ignore[arg-type]
        assert svc.get_int(A_SCHEMA_KEY) == 5
