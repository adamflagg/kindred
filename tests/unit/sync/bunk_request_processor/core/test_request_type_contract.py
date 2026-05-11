"""Contract test for the two deliberately-duplicated RequestType enums.

bunking.models.RequestType (solver/scenario layer, Pydantic-adjacent) and
bunking.sync.bunk_request_processor.core.models.RequestType (sync pipeline,
clean-architecture domain layer) are intentionally separate to keep the sync
pipeline free of upstream dependencies. This test pins that they stay in lockstep
so the duplication can't silently drift.

If this test fails, the two enums have diverged. Either:
  (a) decide they should converge → consolidate to a neutral module, or
  (b) decide the divergence is intentional → delete this test with rationale.

Do not "fix" by mutating one side to match the other without thinking.
"""

from __future__ import annotations

from bunking.models import RequestType as SolverRequestType
from bunking.sync.bunk_request_processor.core.models import RequestType as SyncRequestType


def test_request_type_enums_stay_in_lockstep() -> None:
    solver_members = {member.name: member.value for member in SolverRequestType}
    sync_members = {member.name: member.value for member in SyncRequestType}
    assert solver_members == sync_members, (
        "Solver-layer RequestType and sync-pipeline RequestType have drifted. "
        f"solver={solver_members} sync={sync_members}"
    )
    # Catch base-class drift (e.g. one side migrating to StrEnum), which would
    # silently change == / `in` / serialization semantics without changing the
    # {name: value} mapping above.
    assert SolverRequestType.__mro__[1:] == SyncRequestType.__mro__[1:], (
        f"RequestType base classes diverged. solver={SolverRequestType.__mro__[1:]} sync={SyncRequestType.__mro__[1:]}"
    )
