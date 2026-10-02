"""Camperships: the words and lists the frontend mirrors from the server (slice 1 screens plan review I5).

The frontend can't import Python, so it keeps a copy of a few server-owned words and lists. Both sides read
`tests/fixtures/camperships_frontend_mirrors.json`: this file holds the server to it, and the frontend's
vitest tests hold the frontend to it. A change on either side fails on its own PR.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from api.services.financial_aid_queues import ROUND_STATUS_LABELS

FIXTURE = Path(__file__).resolve().parents[4] / "tests" / "fixtures" / "camperships_frontend_mirrors.json"
MIRRORS: dict[str, Any] = json.loads(FIXTURE.read_text(encoding="utf-8"))


def test_the_round_status_words_are_the_servers() -> None:
    assert MIRRORS["round_status_labels"] == dict(ROUND_STATUS_LABELS)
