"""Shared pytest markers for the test suite.

``requires_pb_db`` gates tests that reach PocketBase's SQLite directly (via
``api.services.metrics_sql_connection``) and therefore need a real database file
(``PB_DATA_DIR`` / ``pocketbase/pb_data/data.db``). These are integration-shaped
tests living in the unit tree; they run locally and in CD (where a DB exists) and
are skipped under ``SKIP_POCKETBASE_TESTS`` (CI / pre-push, where there is no DB).
"""

import pytest

from tests._env import is_truthy_env

requires_pb_db = pytest.mark.skipif(
    is_truthy_env("SKIP_POCKETBASE_TESTS"),
    reason="Hits PocketBase SQLite directly; needs a real DB (PB_DATA_DIR / pocketbase/pb_data/data.db).",
)
