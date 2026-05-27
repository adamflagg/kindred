"""Tests for TraceCollector persisting trigger + session_breakdown on the run record.

Task 4 of GitHub #1686: wire trigger and session_breakdown into the .create() payload
written during flush().
"""

import asyncio
from typing import Any
from unittest.mock import MagicMock

from bunking.sync.bunk_request_processor.debug.trace_collector import TraceCollector
from bunking.sync.bunk_request_processor.debug.trace_models import (
    DispositionTrace,
    FinalBunkRequestTrace,
)


def _make_pb_mock() -> MagicMock:
    """Return a PB client mock that:
    - Captures the FIRST .create() call's payload in captured_creates[0]
    - Returns a MagicMock with .id = "x" from every .create()
    - Returns get_list result with total_items=0 (suppresses retention cleanup)
    """
    pb = MagicMock()
    # get_list used by retention check — needs numeric .total_items
    pb.collection.return_value.get_list.return_value.total_items = 0
    pb.collection.return_value.get_list.return_value.items = []

    # create() returns a MagicMock with id attribute
    create_mock = MagicMock()
    create_mock.id = "x"
    pb.collection.return_value.create.return_value = create_mock

    return pb


def _seed_one_resolved_trace(tc: TraceCollector, session_cm_id: int = 1000001) -> None:
    """Seed one resolved trace so flush() has something to write."""
    tc.record_pre_phase1(
        key="req-a",
        action="parsed",
        original_text="bunk with Emma",
        requester_cm_id=99999,
        year=2026,
        session_cm_id=session_cm_id,
        source_field="bunk_request_form",
    )
    tc.record_disposition(
        key="req-a",
        disposition=DispositionTrace(
            final_bunk_requests=[FinalBunkRequestTrace(status="RESOLVED", request_type="BUNK_WITH")]
        ),
    )


class TestFlushPersistsTriggerAndSessionBreakdown:
    """flush() must include trigger + session_breakdown in the run-record .create() payload."""

    def test_trigger_upload_written_to_run_record(self) -> None:
        """TraceCollector(trigger='upload') → run record payload has trigger='upload'."""
        tc = TraceCollector(run_id="r1", trigger="upload")
        _seed_one_resolved_trace(tc, session_cm_id=1000001)

        pb = _make_pb_mock()

        # Capture the first .create() call's payload (the run record)
        first_payload: dict[str, Any] = {}

        original_create = pb.collection.return_value.create

        call_count = 0

        def capturing_create(payload: dict[str, Any]) -> Any:
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                first_payload.update(payload)
            return original_create.return_value

        pb.collection.return_value.create.side_effect = capturing_create

        asyncio.run(tc.flush(pb, run_metadata={"year": 2026}))

        assert first_payload["trigger"] == "upload"
        assert "session_breakdown" in first_payload
        assert first_payload["session_breakdown"]["1000001"]["resolved"] == 1

    def test_default_trigger_is_manual(self) -> None:
        """TraceCollector without explicit trigger → run record payload has trigger='manual'."""
        tc = TraceCollector(run_id="r2")
        _seed_one_resolved_trace(tc, session_cm_id=1000002)

        pb = _make_pb_mock()

        first_payload: dict[str, Any] = {}
        call_count = 0

        original_create = pb.collection.return_value.create

        def capturing_create(payload: dict[str, Any]) -> Any:
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                first_payload.update(payload)
            return original_create.return_value

        pb.collection.return_value.create.side_effect = capturing_create

        asyncio.run(tc.flush(pb, run_metadata={"year": 2026}))

        assert first_payload["trigger"] == "manual"
        assert "session_breakdown" in first_payload

    def test_session_breakdown_multiple_sessions(self) -> None:
        """session_breakdown correctly groups counts across two sessions."""
        tc = TraceCollector(run_id="r3", trigger="manual")

        # Session 1000001: one RESOLVED
        _seed_one_resolved_trace(tc, session_cm_id=1000001)

        # Session 1000002: one PENDING
        tc.record_pre_phase1(
            key="req-b",
            action="parsed",
            original_text="not bunk with Liam",
            requester_cm_id=88888,
            year=2026,
            session_cm_id=1000002,
            source_field="bunk_request_form",
        )
        tc.record_disposition(
            key="req-b",
            disposition=DispositionTrace(
                final_bunk_requests=[FinalBunkRequestTrace(status="PENDING", request_type="NOT_BUNK_WITH")]
            ),
        )

        pb = _make_pb_mock()

        first_payload: dict[str, Any] = {}
        call_count = 0
        original_create = pb.collection.return_value.create

        def capturing_create(payload: dict[str, Any]) -> Any:
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                first_payload.update(payload)
            return original_create.return_value

        pb.collection.return_value.create.side_effect = capturing_create

        asyncio.run(tc.flush(pb, run_metadata={"year": 2026}))

        bd = first_payload["session_breakdown"]
        assert bd["1000001"]["resolved"] == 1
        assert bd["1000001"]["pending"] == 0
        assert bd["1000002"]["pending"] == 1
        assert bd["1000002"]["resolved"] == 0
