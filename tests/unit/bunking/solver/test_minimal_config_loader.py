"""Tests for the ``MinimalConfigLoader`` test double in ``conftest``.

The mock must mirror production ``ConfigLoader.get_soft_constraint_weight``,
which falls through to ``constraint.<name>.weight`` and raises
``UnknownKeyError`` when that key is absent. A silent ``0`` would let a
config-key regression pass unnoticed in constraint tests.
"""

import pytest

from bunking.config.errors import UnknownKeyError

from .conftest import MinimalConfigLoader


def test_soft_constraint_weight_fails_loudly_on_unknown_key() -> None:
    """An unmapped constraint resolves to ``constraint.<name>.weight`` and raises."""
    loader = MinimalConfigLoader()

    with pytest.raises(UnknownKeyError):
        loader.get_soft_constraint_weight("age_grade_flow")
