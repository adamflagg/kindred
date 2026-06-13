"""Read-only, snapshot-backed config service for solver child processes.

A CP-SAT solve runs in a throwaway child process (api/services/solve_executor.py).
ConfigLoader cannot cross that pickle boundary (it owns a PocketBase client), so
the parent snapshots every readable CONFIG_SCHEMA value and the child wraps the
plain dict in this service. Subclasses ConfigLoader so every ``config: ConfigLoader``
annotation in the solver keeps working; deliberately skips ConfigLoader.__init__ —
no PB client, no singleton interaction, no cache TTL.
"""

from typing import Any

from .errors import MissingKeyError, UnknownKeyError
from .loader import ConfigLoader
from .schema import CONFIG_SCHEMA


def snapshot_config(loader: ConfigLoader) -> dict[str, Any]:
    """Export every readable CONFIG_SCHEMA value to a plain picklable dict.

    Absent keys (optional, unseeded) are omitted; StaticConfigService.get raises
    MissingKeyError for them, so typed-getter defaults engage exactly as they
    would against the live loader. Env overrides are baked in here (loader.get
    resolves env first) — the child sees the parent's effective config.
    """
    values: dict[str, Any] = {}
    for key in CONFIG_SCHEMA:
        try:
            values[key] = loader.get(key)
        except MissingKeyError:
            continue
    return values


class StaticConfigService(ConfigLoader):
    """ConfigLoader-compatible reads over a frozen snapshot dict."""

    def __init__(self, values: dict[str, Any]) -> None:
        # Intentionally no super().__init__(): no PB client, no cache machinery.
        # Parent attributes (_pb, _cache, ...) stay unset; the only inherited
        # code paths that touch them are writes/health checks, overridden below.
        self._values = dict(values)

    def get(self, key: str) -> Any:
        if key not in CONFIG_SCHEMA:
            raise UnknownKeyError(f"Unknown config key: '{key}'")
        if key not in self._values:
            raise MissingKeyError(f"Config key '{key}' absent from snapshot")
        return self._values[key]

    def update_config(self, key: str, value: str | int | float) -> None:
        raise NotImplementedError("StaticConfigService is read-only")

    def health_check(self) -> dict[str, Any]:
        return {
            "status": "healthy",
            "database_connected": False,
            "static_snapshot": True,
            "keys": len(self._values),
        }
