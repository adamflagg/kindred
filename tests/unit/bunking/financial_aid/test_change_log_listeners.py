"""commit_aid_writes announces every commit to registered listeners, success or failure.

The API registers the Camperships season cache's invalidation here (bunking cannot import api).
Fictional data only.
"""

import logging
from collections.abc import Callable, Iterator, Sequence
from types import SimpleNamespace
from typing import Any

import pytest

from bunking.financial_aid import change_log
from bunking.financial_aid.change_log import (
    AidOperationPartiallyCommittedError,
    AidWrite,
    add_commit_listener,
    commit_aid_writes,
)
from bunking.pocketbase_batch import BatchRequestFailedError, BatchResult

ACTOR = "finance-lead@example.com"


def _write(n: int = 1) -> AidWrite:
    return AidWrite(collection="aid_requests", action="create", year=2027, data={"note": f"row {n}"})


def _failure() -> BatchRequestFailedError:
    return BatchRequestFailedError(
        index=0, total=2, request=None, status=400, message="nope", field_errors={}, response=None
    )


@pytest.fixture(autouse=True)
def _isolated_registry() -> Iterator[None]:
    saved = list(change_log._LISTENERS)
    change_log._LISTENERS.clear()
    yield
    change_log._LISTENERS[:] = saved


def _fake_send(monkeypatch: pytest.MonkeyPatch, behaviour: Callable[[int], list[BatchResult]]) -> None:
    calls = {"n": 0}

    def send(pb: Any, requests: Sequence[Any], **_: Any) -> list[BatchResult]:
        n = calls["n"]
        calls["n"] += 1
        return behaviour(n)

    monkeypatch.setattr(change_log, "send_batch", send)


def _ok(n: int) -> list[BatchResult]:
    return [BatchResult(status=200, body={"id": "x"}) for _ in range(2)]


def _boom(n: int) -> list[BatchResult]:
    raise _failure()


PB = SimpleNamespace()


def test_listener_runs_once_with_writes_and_actor_on_success(monkeypatch: pytest.MonkeyPatch) -> None:
    _fake_send(monkeypatch, _ok)
    seen: list[tuple[Sequence[AidWrite], str]] = []
    add_commit_listener(lambda writes, actor: seen.append((writes, actor)))
    writes = [_write()]
    commit_aid_writes(PB, writes, actor=ACTOR)  # type: ignore[arg-type]
    assert seen == [(writes, ACTOR)]


def test_listener_runs_when_the_batch_fails_and_the_error_still_surfaces(monkeypatch: pytest.MonkeyPatch) -> None:
    _fake_send(monkeypatch, _boom)
    seen: list[str] = []
    add_commit_listener(lambda writes, actor: seen.append(actor))
    with pytest.raises(BatchRequestFailedError):
        commit_aid_writes(PB, [_write()], actor=ACTOR)  # type: ignore[arg-type]
    assert seen == [ACTOR]


def test_listener_runs_when_a_chunked_operation_partly_commits(monkeypatch: pytest.MonkeyPatch) -> None:
    _fake_send(monkeypatch, lambda n: _ok(n) if n == 0 else _boom(n))
    seen: list[str] = []
    add_commit_listener(lambda writes, actor: seen.append(actor))
    with pytest.raises(AidOperationPartiallyCommittedError):
        commit_aid_writes(
            PB,  # type: ignore[arg-type]
            [_write(1), _write(2)],
            actor=ACTOR,
            allow_chunking=True,
            max_requests=2,
        )
    assert seen == [ACTOR]


def test_a_raising_listener_is_logged_and_swallowed(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    _fake_send(monkeypatch, _ok)
    later: list[str] = []

    def bad(writes: Sequence[AidWrite], actor: str) -> None:
        raise RuntimeError("cache exploded")

    add_commit_listener(bad)
    add_commit_listener(lambda writes, actor: later.append(actor))
    with caplog.at_level(logging.ERROR):
        result = commit_aid_writes(PB, [_write()], actor=ACTOR)  # type: ignore[arg-type]
    assert result.batches == 1
    assert later == [ACTOR]
    assert any("cache exploded" in (r.exc_text or "") for r in caplog.records)


def test_a_raising_listener_does_not_mask_the_commit_error(monkeypatch: pytest.MonkeyPatch) -> None:
    _fake_send(monkeypatch, _boom)

    def bad(writes: Sequence[AidWrite], actor: str) -> None:
        raise RuntimeError("cache exploded")

    add_commit_listener(bad)
    with pytest.raises(BatchRequestFailedError):
        commit_aid_writes(PB, [_write()], actor=ACTOR)  # type: ignore[arg-type]


def test_the_remover_unregisters_the_listener(monkeypatch: pytest.MonkeyPatch) -> None:
    _fake_send(monkeypatch, _ok)
    seen: list[str] = []
    remove = add_commit_listener(lambda writes, actor: seen.append(actor))
    remove()
    commit_aid_writes(PB, [_write()], actor=ACTOR)  # type: ignore[arg-type]
    assert seen == []
