"""commit_aid_writes spied at a service's import site, running the real 4a helper over a fake
PocketBase batch, so every AidWrite is validated as in production. Same pattern as
test_financial_aid_write_service's _Spy; shared by the grants tests."""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock, patch

from bunking.financial_aid.change_log import AidWrite, commit_aid_writes
from bunking.pocketbase_batch import BatchRequest, BatchResult


class AidCommitSpy:
    def __init__(self) -> None:
        self.commit = MagicMock(wraps=commit_aid_writes)
        self.batches: list[list[BatchRequest]] = []

    def send_batch(self, pb: Any, requests: list[BatchRequest], *, max_requests: int) -> list[BatchResult]:
        self.batches.append(list(requests))
        return [BatchResult(status=200, body=dict(r.body) if r.body is not None else None) for r in requests]

    @property
    def called(self) -> bool:
        return self.commit.called

    @property
    def writes(self) -> list[AidWrite]:
        return list(self.commit.call_args.args[1])

    @property
    def kwargs(self) -> dict[str, Any]:
        return dict(self.commit.call_args.kwargs)

    def log_rows(self) -> list[dict[str, Any]]:
        return [dict(r.body or {}) for b in self.batches for r in b if r.url.endswith("/aid_change_log/records")]


def spy_on_commits(module: str) -> AidCommitSpy:
    """Patch `module.commit_aid_writes` and the batch transport; stop with patch.stopall()."""
    spy = AidCommitSpy()
    patch("bunking.financial_aid.change_log.send_batch", side_effect=spy.send_batch).start()
    patch(f"{module}.commit_aid_writes", spy.commit).start()
    return spy
