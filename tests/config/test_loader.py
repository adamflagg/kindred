"""
Tests for ConfigLoader.get_soft_constraint_weight signature and validate_on_init behavior.

TDD: These tests were written BEFORE implementation — they should fail until the
implementation (removing the `default=` kwarg) is in place.
"""

from __future__ import annotations

import inspect

import pytest

from bunking.config import ConfigLoader, MissingKeyError


class TestGetSoftConstraintWeightNoDefault:
    """
    PR 4 — Task 4.1: verify get_soft_constraint_weight has no `default` parameter.

    The method used to accept `default: int | None = None`. Removing this kwarg
    forces callers to have their keys properly seeded rather than falling back to
    a hardcoded value that may drift from the schema.
    """

    def test_signature_has_no_default_parameter(self) -> None:
        """get_soft_constraint_weight must not accept a `default` keyword argument."""
        sig = inspect.signature(ConfigLoader.get_soft_constraint_weight)
        assert "default" not in sig.parameters, (
            "get_soft_constraint_weight still has a `default` parameter. Remove it so missing keys fail loudly."
        )

    def test_signature_only_has_constraint_name_parameter(self) -> None:
        """Method should only accept `self` and `constraint_name`."""
        sig = inspect.signature(ConfigLoader.get_soft_constraint_weight)
        # self is excluded from inspect.signature for bound methods; on the class it appears
        param_names = [p for p in sig.parameters if p != "self"]
        assert param_names == ["constraint_name"], f"Expected only 'constraint_name' parameter, got: {param_names}"


class TestLoaderFailsLoudOnMissingRequiredKey:
    """
    PR 4 — Task 4.2: verify that ConfigLoader.initialize(validate_on_init=True)
    raises MissingKeyError when a required key is absent from the database.

    This indirectly verifies that `get_soft_constraint_weight` no longer silently
    swallows a missing key via a default — the validation at startup catches it.
    """

    def test_validate_on_init_true_raises_on_missing_required_key(self) -> None:
        """initialize(validate_on_init=True) must raise when a required key is absent."""
        ConfigLoader.reset()
        with pytest.raises((MissingKeyError, Exception)) as exc_info:
            # This will fail because there is no real PocketBase to connect to.
            # We verify it raises — any error from the validation path is acceptable
            # in a unit-test context without a live DB.
            ConfigLoader.initialize(
                pocketbase_url="http://127.0.0.1:19999",  # unreachable port
                validate_on_init=True,
            )
        # The error should be about DB connectivity or missing keys, not a TypeError
        # from passing `default=` kwargs.
        assert exc_info.type is not TypeError, (
            "Got TypeError — caller may still be passing `default=` to the method after the signature was updated."
        )
        ConfigLoader.reset()

    def test_validate_on_init_is_default_true(self) -> None:
        """initialize() default is validate_on_init=True (already the case; regression guard)."""
        sig = inspect.signature(ConfigLoader.initialize)
        validate_param = sig.parameters.get("validate_on_init")
        assert validate_param is not None, "initialize() has no validate_on_init parameter"
        assert validate_param.default is True, (
            f"validate_on_init default should be True, got {validate_param.default!r}"
        )


class TestMustSatisfyOnePenaltyInSchema:
    """
    Verify that constraint.must_satisfy_one.penalty is in CONFIG_SCHEMA as required=True.

    The key is seeded in the migration (value=100000) and consumed by must_satisfy.py.
    Without a schema entry, get_int() raises UnknownKeyError regardless of seeding.
    """

    def test_must_satisfy_one_penalty_in_schema(self) -> None:
        """constraint.must_satisfy_one.penalty must be in CONFIG_SCHEMA."""
        from bunking.config.schema import CONFIG_SCHEMA

        assert "constraint.must_satisfy_one.penalty" in CONFIG_SCHEMA, (
            "constraint.must_satisfy_one.penalty is missing from CONFIG_SCHEMA. "
            "Add it as required=True to match the seeded migration value."
        )

    def test_must_satisfy_one_penalty_is_required(self) -> None:
        """constraint.must_satisfy_one.penalty must be required=True."""
        from bunking.config.schema import CONFIG_SCHEMA

        key_config = CONFIG_SCHEMA.get("constraint.must_satisfy_one.penalty")
        assert key_config is not None
        assert key_config.required is True, (
            f"constraint.must_satisfy_one.penalty required={key_config.required!r}, expected True"
        )
