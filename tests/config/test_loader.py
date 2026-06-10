"""
Tests for ConfigLoader.get_soft_constraint_weight signature and validate_on_init behavior.

TDD: These tests were written BEFORE implementation — they should fail until the
implementation (removing the `default=` kwarg) is in place.
"""

import inspect
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from pocketbase.errors import ClientResponseError

from bunking.config import ConfigLoader, MissingKeyError
from bunking.config.errors import DatabaseUnavailableError, UnknownKeyError

REQUIRED_KEY = "constraint.age_spread.preferred_bonus"


def _make_fake_pb(record_value: int = 500) -> tuple[MagicMock, MagicMock, MagicMock]:
    """Fake PocketBase client with separate _superusers and config collection mocks."""
    superusers = MagicMock()
    config_col = MagicMock()
    record = MagicMock()
    record.value = record_value
    config_col.get_first_list_item.return_value = record
    pb = MagicMock()

    def _collection(name: str) -> Any:
        return superusers if name == "_superusers" else config_col

    pb.collection.side_effect = _collection
    return pb, superusers, config_col


class TestTokenReauthentication:
    """
    Prod incident 2026-06-10: ConfigLoader authenticates its private PB client once
    at startup; the superuser token expires after 24h, after which the config
    collection's listRule returns empty results and every required key surfaces as
    "not found in database" until the container is restarted.

    The loader must re-authenticate its own client once the auth is older than
    ``reauth_interval_seconds`` (lazily, before the next DB access).
    """

    def test_reauths_before_query_when_auth_older_than_interval(self) -> None:
        """With interval 0, every DB query re-authenticates first."""
        pb, superusers, _ = _make_fake_pb()
        with patch("bunking.config.loader.PocketBase", return_value=pb):
            loader = ConfigLoader(reauth_interval_seconds=0)
        assert superusers.auth_with_password.call_count == 1  # startup auth
        value = loader.get(REQUIRED_KEY)
        assert value == 500
        assert superusers.auth_with_password.call_count == 2

    def test_does_not_reauth_within_interval(self) -> None:
        """Fresh auth (default 1h interval) must not re-auth on every query."""
        pb, superusers, _ = _make_fake_pb()
        with patch("bunking.config.loader.PocketBase", return_value=pb):
            loader = ConfigLoader()
        loader.get(REQUIRED_KEY)
        loader.invalidate_cache()
        loader.get(REQUIRED_KEY)
        assert superusers.auth_with_password.call_count == 1  # startup auth only

    def test_injected_client_is_never_reauthed(self) -> None:
        """Injected clients (tests, callers managing their own auth) are left alone."""
        pb, superusers, _ = _make_fake_pb()
        loader = ConfigLoader(pb_client=pb, reauth_interval_seconds=0)
        loader.get(REQUIRED_KEY)
        assert superusers.auth_with_password.call_count == 0

    def test_reauth_failure_keeps_serving_with_existing_token(self) -> None:
        """A failed re-auth logs and falls through — the query still runs."""
        pb, superusers, _ = _make_fake_pb()
        with patch("bunking.config.loader.PocketBase", return_value=pb):
            loader = ConfigLoader(reauth_interval_seconds=0)
        superusers.auth_with_password.side_effect = ClientResponseError("boom", status=500)
        assert loader.get(REQUIRED_KEY) == 500

    def test_update_config_reauths_stale_token(self) -> None:
        """Config writes go through the same re-auth gate as reads."""
        pb, superusers, _ = _make_fake_pb()
        with patch("bunking.config.loader.PocketBase", return_value=pb):
            loader = ConfigLoader(reauth_interval_seconds=0)
        loader.update_config(REQUIRED_KEY, 600)
        assert superusers.auth_with_password.call_count == 2


class TestQueryErrorDiscrimination:
    """
    ``_query_database_raw`` must not report transport/auth failures as "key not
    found" — that masking made the 2026-06-10 token-expiry outage impersonate the
    missing-row bug fixed in PR #1730.
    """

    def test_404_from_pb_surfaces_as_missing_key(self) -> None:
        """A true not-found (PB 404) keeps raising MissingKeyError."""
        pb, _, config_col = _make_fake_pb()
        config_col.get_first_list_item.side_effect = ClientResponseError(
            "The requested resource wasn't found.", status=404
        )
        loader = ConfigLoader(pb_client=pb)
        with pytest.raises(MissingKeyError):
            loader.get(REQUIRED_KEY)

    def test_non_404_error_surfaces_as_database_unavailable(self) -> None:
        """A 401/5xx/etc must raise DatabaseUnavailableError, NOT MissingKeyError."""
        pb, _, config_col = _make_fake_pb()
        config_col.get_first_list_item.side_effect = ClientResponseError("unauthorized", status=401)
        loader = ConfigLoader(pb_client=pb)
        with pytest.raises(DatabaseUnavailableError):
            loader.get(REQUIRED_KEY)


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
        """initialize(validate_on_init=True) must raise MissingKeyError when a required key is absent."""
        ConfigLoader.reset()
        # Inject a fake PB client whose get_first_list_item() always raises the
        # library's not-found signal (404), so _query_database_raw returns None for
        # every key, causing MissingKeyError.
        fake_collection = MagicMock()
        fake_collection.get_first_list_item.side_effect = ClientResponseError(
            "The requested resource wasn't found.", status=404
        )
        fake_pb = MagicMock()
        fake_pb.collection.return_value = fake_collection

        with patch("bunking.config.loader.PocketBase", return_value=fake_pb):
            with pytest.raises(MissingKeyError):
                ConfigLoader.initialize(
                    pocketbase_url="http://127.0.0.1:19999",
                    validate_on_init=True,
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


class TestAgeSpreadRemovedFromWeightMappings:
    """Age Spread Phase 2: age_spread is no longer routed through soft-weight mapping.

    The hard MAX_AGE_SPREAD_MONTHS constant replaces constraint.age_spread.penalty.
    Any residual ``get_soft_constraint_weight("age_spread")`` call should fall
    through to the default key shape ``constraint.age_spread.weight``, which
    isn't in CONFIG_SCHEMA → UnknownKeyError.
    """

    def test_get_soft_constraint_weight_age_spread_falls_through(self) -> None:
        """Calling with 'age_spread' should resolve to constraint.age_spread.weight (not .penalty)."""
        ConfigLoader.reset()
        fake_collection = MagicMock()
        fake_collection.get_first_list_item.side_effect = Exception("not found")
        fake_pb = MagicMock()
        fake_pb.collection.return_value = fake_collection

        with patch("bunking.config.loader.PocketBase", return_value=fake_pb):
            ConfigLoader.initialize(
                pocketbase_url="http://127.0.0.1:19999",
                validate_on_init=False,
            )
            loader = ConfigLoader.get_instance()
            with pytest.raises(UnknownKeyError):
                loader.get_soft_constraint_weight("age_spread")
        ConfigLoader.reset()
