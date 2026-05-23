"""Dependency-free env-truthiness helper (no pytest import — safe in early conftest import).

``is_truthy_env(name)`` is the single way the suite reads boolean gate vars
(``SKIP_POCKETBASE_TESTS``, ``SKIP_MOCKING``, ...). It accepts the common truthy spellings
and trims/lowercases. ``default`` preserves each call site's unset semantics: gate vars that
should *run* tests when unset use the ``"false"`` default; the sync smoke/CLI tests that
should *skip* when unset pass ``default="true"``.
"""

import os

_TRUTHY = {"1", "true", "yes", "on"}


def is_truthy_env(name: str, *, default: str = "false") -> bool:
    return os.environ.get(name, default).strip().lower() in _TRUTHY
