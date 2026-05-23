"""TDD tests for git SHA capture used in solver run tagging."""

import os
import subprocess
from unittest.mock import patch

from api.services import git_sha as git_sha_mod
from api.services.git_sha import _read_git_sha, get_git_sha


class TestReadGitSha:
    def test_returns_env_var_when_set(self) -> None:
        with patch.dict(os.environ, {"KINDRED_GIT_SHA": "abc1234"}, clear=False):
            assert _read_git_sha() == "abc1234"

    def test_strips_env_var_whitespace(self) -> None:
        with patch.dict(os.environ, {"KINDRED_GIT_SHA": "  abc1234\n"}, clear=False):
            assert _read_git_sha() == "abc1234"

    def test_falls_back_to_git_rev_parse_when_env_missing(self) -> None:
        env = dict(os.environ)
        env.pop("KINDRED_GIT_SHA", None)
        with patch.dict(os.environ, env, clear=True):
            with patch("subprocess.check_output", return_value=b"def5678abc\n"):
                assert _read_git_sha() == "def5678abc"

    def test_falls_back_to_unknown_when_subprocess_fails(self) -> None:
        env = dict(os.environ)
        env.pop("KINDRED_GIT_SHA", None)
        with patch.dict(os.environ, env, clear=True):
            with patch("subprocess.check_output", side_effect=subprocess.CalledProcessError(1, "git")):
                assert _read_git_sha() == "unknown"

    def test_falls_back_to_unknown_when_git_not_installed(self) -> None:
        env = dict(os.environ)
        env.pop("KINDRED_GIT_SHA", None)
        with patch.dict(os.environ, env, clear=True):
            with patch("subprocess.check_output", side_effect=FileNotFoundError()):
                assert _read_git_sha() == "unknown"


class TestGetGitSha:
    def test_caches_result_across_calls(self) -> None:
        git_sha_mod._cached_sha = None
        with patch("api.services.git_sha._read_git_sha", return_value="cached_sha") as m:
            assert get_git_sha() == "cached_sha"
            assert get_git_sha() == "cached_sha"
            assert m.call_count == 1
