"""SOLVER_SUBPROCESS kill-switch: defaults on; env var reverts to in-thread solves."""

import pytest

from api.settings import Settings


class TestSolverSubprocessFlag:
    def test_defaults_to_true(self) -> None:
        assert Settings(_env_file=None).solver_subprocess is True

    def test_env_override_disables(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("SOLVER_SUBPROCESS", "false")
        assert Settings(_env_file=None).solver_subprocess is False
