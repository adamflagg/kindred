"""Cross-language drift guard for the source_field → "family"/"staff" mapping.

Issue #1217. The same 5→2 mapping lives in two places:

- Python: ``bunking/sync/bunk_request_processor/core/models.py`` — ``_SOURCE_FIELD_MAP``
- TypeScript: ``frontend/src/utils/sourceFromField.ts`` — ``SOURCE_FIELD_MAP``

If a sixth source_field is added on the Python side (or one is renamed), the TS
helper will silently throw at runtime in the browser when that value reaches
``safeSourceFromField``. This test parses the TS file and asserts both sides
agree, so drift fails CI rather than the user.
"""

import re
from pathlib import Path

from bunking.sync.bunk_request_processor.core.models import _SOURCE_FIELD_MAP

# tests/unit/sync/bunk_request_processor/core/test_source_field_map_ts_parity.py → repo root
_REPO_ROOT = Path(__file__).resolve().parents[5]
_TS_FILE = _REPO_ROOT / "frontend" / "src" / "utils" / "sourceFromField.ts"

# Matches the SOURCE_FIELD_MAP literal: ``key: 'value'`` or ``key: "value"``,
# trailing comma optional, optional ``// …`` end-of-line comment tolerated.
_TS_ENTRY_RE = re.compile(
    r"^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*['\"]([a-zA-Z_]+)['\"]\s*,?\s*(?://[^\n]*)?\s*$",
    re.MULTILINE,
)


def _parse_ts_source_field_map(ts_source: str) -> dict[str, str]:
    """Extract the SOURCE_FIELD_MAP literal from sourceFromField.ts."""
    match = re.search(
        r"SOURCE_FIELD_MAP\s*:\s*Readonly<Record<[^>]+>>\s*=\s*\{([^}]*)\}",
        ts_source,
        re.DOTALL,
    )
    if not match:
        raise ValueError("SOURCE_FIELD_MAP literal not found in sourceFromField.ts")
    return {m.group(1): m.group(2) for m in _TS_ENTRY_RE.finditer(match.group(1))}


def test_python_and_ts_source_field_maps_agree() -> None:
    """Python ``_SOURCE_FIELD_MAP`` and TS ``SOURCE_FIELD_MAP`` must match.

    If this fails, update whichever side is out of date so they stay in sync.
    """
    assert _TS_FILE.exists(), f"missing TS source: {_TS_FILE}"
    ts_map = _parse_ts_source_field_map(_TS_FILE.read_text())

    python_map = dict(_SOURCE_FIELD_MAP)

    assert ts_map == python_map, (
        "source_field map drift between Python and TypeScript.\n"
        f"  Python ({len(python_map)} entries): {sorted(python_map.items())}\n"
        f"  TypeScript ({len(ts_map)} entries): {sorted(ts_map.items())}\n"
        "Update either bunking/sync/bunk_request_processor/core/models.py or "
        "frontend/src/utils/sourceFromField.ts so both sides agree."
    )


def test_ts_parser_returns_non_empty_map() -> None:
    """Sanity check: parser produced at least one entry (catches silent regex breakage)."""
    ts_map = _parse_ts_source_field_map(_TS_FILE.read_text())
    assert len(ts_map) > 0
