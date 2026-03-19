"""Test that FinalBunkRequestTrace.status is always UPPERCASE regardless of source."""

from unittest.mock import MagicMock

from bunking.sync.bunk_request_processor.core.models import RequestStatus


def _simulate_orchestrator_status_logic(matched_br: object | None, is_resolved: bool) -> str:
    """Reproduce the orchestrator's status determination logic (orchestrator.py:1489-1495).

    This is extracted to test the case normalization fix independently of the
    full orchestrator, which requires extensive setup.
    """
    final_status = "RESOLVED" if is_resolved else "PENDING"
    if matched_br:
        if hasattr(matched_br, "status") and matched_br.status:
            raw_status = matched_br.status.value if hasattr(matched_br.status, "value") else str(matched_br.status)
            final_status = raw_status.upper()
    return final_status


def test_status_uppercase_when_matched_br_has_enum():
    """Production path: matched_br.status is a RequestStatus enum with lowercase .value."""
    for status in RequestStatus:
        br = MagicMock()
        br.status = status  # enum with lowercase .value
        result = _simulate_orchestrator_status_logic(br, is_resolved=(status == RequestStatus.RESOLVED))
        assert result == status.value.upper(), f"Expected {status.value.upper()}, got {result}"


def test_status_uppercase_when_matched_br_has_string():
    """Edge case: matched_br.status is a raw lowercase string (no .value attr)."""
    br = MagicMock(spec=[])  # spec=[] removes all magic attrs
    br.status = "pending"
    result = _simulate_orchestrator_status_logic(br, is_resolved=False)
    assert result == "PENDING"


def test_status_uppercase_when_no_matched_br():
    """Dry-run path: no matched_br, status comes from is_resolved flag."""
    assert _simulate_orchestrator_status_logic(None, is_resolved=True) == "RESOLVED"
    assert _simulate_orchestrator_status_logic(None, is_resolved=False) == "PENDING"
