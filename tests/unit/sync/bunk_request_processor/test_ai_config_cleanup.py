"""TDD spec for the AI Config (Unified) Phase 2 cleanup.

These tests are written BEFORE the implementation and must FAIL until the
cleanup ships. They lock in the post-cleanup contract:

- The 18 live AI values are exposed as module-level constants (not loaded
  from PB).
- Strategies (Fuzzy/Phonetic/Base) no longer accept a `config` kwarg — the
  PB injection point is gone.
- The nickname helpers no longer accept a `config_service` kwarg — the
  phantom `name_matching.common_nicknames` lookup is deleted.
- The context builder no longer depends on `config_service` for AI config —
  the phantom `context_building.*` lookup is replaced by a constant.
- `ConfigLoader.get_ai_config()` returns only env-derived keys (no
  `category='ai'` PB query).
- The orchestrator always constructs a `SpreadFilter` (no
  `spread_validation.enabled` toggle).

Why this matters: the 97 AI rows in PB are being dropped (78 zombie + 1
env-shadowed + 18 hardcoded as constants). See
`docs/reference/solver-config-decisions.md` → "AI Config (Unified)" for the
full surface walk and per-key decisions.
"""

import inspect

import pytest


class TestConstantsExportedFromCore:
    """The 18 live values + 2 phantom-promotions must be importable as constants."""

    def test_confidence_thresholds_module_constants(self) -> None:
        from bunking.sync.bunk_request_processor.core import constants

        assert constants.CONFIDENCE_THRESHOLDS["auto_accept"] == 0.95
        assert constants.CONFIDENCE_THRESHOLDS["resolved"] == 0.85

    def test_context_building_max_age_constant(self) -> None:
        from bunking.sync.bunk_request_processor.core import constants

        assert constants.CONTEXT_BUILDING_MAX_AGE_DIFFERENCE_MONTHS == 24

    def test_fuzzy_resolution_constants(self) -> None:
        from bunking.sync.bunk_request_processor.resolution.strategies import fuzzy_match

        assert fuzzy_match.DEFAULT_NICKNAME_BASE == 0.85
        assert fuzzy_match.DEFAULT_NORMALIZED_BASE == 0.80
        assert fuzzy_match.DEFAULT_CONFIDENCE == 0.75
        assert fuzzy_match.DEFAULT_SESSION_MATCH == 0.85
        assert fuzzy_match.DEFAULT_SAME_SESSION_BOOST == 0.0
        assert fuzzy_match.DEFAULT_DIFFERENT_SESSION_PENALTY == -0.10
        assert fuzzy_match.DEFAULT_NOT_ENROLLED_PENALTY == -0.05
        assert fuzzy_match.DEFAULT_JARO_WINKLER_THRESHOLD == 0.85

    def test_fuzzy_parent_surname_base_constant(self) -> None:
        """Phantom dict-key promotion: parent_surname_base used to be silently default=0.70."""
        from bunking.sync.bunk_request_processor.resolution.strategies import fuzzy_match

        assert fuzzy_match.DEFAULT_PARENT_SURNAME_BASE == 0.70

    def test_phonetic_resolution_constants(self) -> None:
        from bunking.sync.bunk_request_processor.resolution.strategies import phonetic_match

        assert phonetic_match.DEFAULT_SOUNDEX_BASE == 0.70
        assert phonetic_match.DEFAULT_METAPHONE_BASE == 0.65
        assert phonetic_match.DEFAULT_NICKNAME_BASE == 0.75
        assert phonetic_match.DEFAULT_CONFIDENCE == 0.60
        assert phonetic_match.DEFAULT_SESSION_MATCH == 0.75
        assert phonetic_match.DEFAULT_SAME_SESSION_BOOST == 0.05
        assert phonetic_match.DEFAULT_DIFFERENT_SESSION_PENALTY == -0.20
        assert phonetic_match.DEFAULT_NOT_ENROLLED_PENALTY == -0.05


class TestStrategyConfigArgRemoved:
    """Strategies no longer take a `config` kwarg — PB injection is gone."""

    def test_base_match_strategy_init_has_no_config_param(self) -> None:
        from bunking.sync.bunk_request_processor.resolution.strategies.base_match_strategy import (
            BaseMatchStrategy,
        )

        sig = inspect.signature(BaseMatchStrategy.__init__)
        assert "config" not in sig.parameters, (
            "BaseMatchStrategy still accepts a `config` kwarg. Remove it — strategies use module constants now."
        )

    def test_fuzzy_match_strategy_init_has_no_config_param(self) -> None:
        from bunking.sync.bunk_request_processor.resolution.strategies.fuzzy_match import (
            FuzzyMatchStrategy,
        )

        sig = inspect.signature(FuzzyMatchStrategy.__init__)
        assert "config" not in sig.parameters

    def test_phonetic_match_strategy_init_has_no_config_param(self) -> None:
        from bunking.sync.bunk_request_processor.resolution.strategies.phonetic_match import (
            PhoneticMatchStrategy,
        )

        sig = inspect.signature(PhoneticMatchStrategy.__init__)
        assert "config" not in sig.parameters

    def test_base_match_strategy_has_no_get_confidence_method(self) -> None:
        """The `_get_confidence` indirection collapses to direct constant references."""
        from bunking.sync.bunk_request_processor.resolution.strategies.base_match_strategy import (
            BaseMatchStrategy,
        )

        assert not hasattr(BaseMatchStrategy, "_get_confidence"), (
            "_get_confidence indirection should be removed — strategies use module constants directly."
        )


class TestNicknameHelpersNoConfigService:
    """The phantom `name_matching.common_nicknames` lookup is deleted.

    Both callers (`context_builder.py:130`, `nickname_groups.py:113`) always
    got `{}` and fell through to defaults — confirmed in the surface walk.
    The runtime source of truth is `DEFAULT_NICKNAME_GROUPS` + the kindred-
    local override file + the `nicknames` PyPI library.
    """

    def test_get_nickname_groups_has_no_config_service_param(self) -> None:
        from bunking.sync.bunk_request_processor.shared.nickname_groups import get_nickname_groups

        sig = inspect.signature(get_nickname_groups)
        assert "config_service" not in sig.parameters

    def test_find_nickname_variations_has_no_config_service_param(self) -> None:
        from bunking.sync.bunk_request_processor.shared.nickname_groups import find_nickname_variations

        sig = inspect.signature(find_nickname_variations)
        assert "config_service" not in sig.parameters

    def test_names_match_via_nicknames_has_no_config_service_param(self) -> None:
        from bunking.sync.bunk_request_processor.shared.nickname_groups import names_match_via_nicknames

        sig = inspect.signature(names_match_via_nicknames)
        assert "config_service" not in sig.parameters

    def test_get_nickname_groups_returns_default_groups(self) -> None:
        """Behavior preserved: returns the hardcoded DEFAULT_NICKNAME_GROUPS list."""
        from bunking.sync.bunk_request_processor.shared.nickname_groups import (
            DEFAULT_NICKNAME_GROUPS,
            get_nickname_groups,
        )

        result = get_nickname_groups()
        assert result is DEFAULT_NICKNAME_GROUPS or result == DEFAULT_NICKNAME_GROUPS


class TestContextBuilderNoConfigService:
    """ContextBuilder no longer takes a config_service — the only PB-derived
    knob (`context_building.max_age_difference_months`) is now a constant."""

    def test_context_builder_init_has_no_config_service_param(self) -> None:
        from bunking.sync.bunk_request_processor.services.context_builder import ContextBuilder

        sig = inspect.signature(ContextBuilder.__init__)
        assert "config_service" not in sig.parameters


class TestConfigLoaderAIConfigEnvOnly:
    """`ConfigLoader.get_ai_config()` returns only env-derived keys.

    The `category='ai'` PB query is gone. Returned dict has exactly the
    env-derived fields: provider, api_key, model, temperature, max_tokens,
    batch_processing. No PB-loaded keys like `confidence_thresholds.*`.
    """

    def test_get_ai_config_does_not_query_pb(self) -> None:
        from unittest.mock import MagicMock

        from bunking.config import ConfigLoader

        ConfigLoader.reset()
        fake_pb = MagicMock()

        loader = ConfigLoader.__new__(ConfigLoader)
        loader._pb = fake_pb
        loader._cache = {}

        result = loader.get_ai_config()

        # After Phase 2 cleanup, get_ai_config must NOT touch the config collection.
        assert not fake_pb.collection.called, (
            "get_ai_config() must not query the config collection after Phase 2 cleanup"
        )

        # Env-only contract (Phase 2): assert the EXACT key set so removed
        # PB-derived keys (confidence_thresholds.*, confidence_scoring.*, etc.)
        # cannot silently reappear.
        assert set(result.keys()) == {
            "provider",
            "api_key",
            "model",
            "temperature",
            "max_tokens",
            "batch_processing",
        }, f"get_ai_config() returned unexpected keys: {sorted(result.keys())}"
        ConfigLoader.reset()


class TestOrchestratorSpreadFilterAlwaysConstructed:
    """`spread_validation.enabled` toggle is deleted. SpreadFilter is always
    constructed in `_init_scoring_components`. Pattern-matched from Cabin
    Capacity `mode` and Grade Spread `mode` collapses."""

    def test_init_scoring_components_does_not_read_spread_validation_enabled(self) -> None:
        """Source-level guard: the toggle key should not appear anywhere in the orchestrator."""
        import pathlib

        orchestrator_path = (
            pathlib.Path(__file__).resolve().parent.parent.parent.parent.parent
            / "bunking"
            / "sync"
            / "bunk_request_processor"
            / "orchestrator"
            / "orchestrator.py"
        )
        source = orchestrator_path.read_text()
        assert 'ai_config.get("spread_validation"' not in source, (
            "orchestrator.py still reads spread_validation from ai_config — toggle should be deleted."
        )


class TestNoPhantomDictKeyReads:
    """Source-level guard: the phantom `ai_config.get("X", ...)` lookups for
    paths that were never seeded should be deleted from the orchestrator."""

    @pytest.mark.parametrize(
        "phantom_key",
        [
            'ai_config.get("cache"',
            'ai_config.get("conflict_detection"',
            'ai_config.get("endpoint"',
        ],
    )
    def test_orchestrator_no_phantom_blob_reads(self, phantom_key: str) -> None:
        import pathlib

        orchestrator_path = (
            pathlib.Path(__file__).resolve().parent.parent.parent.parent.parent
            / "bunking"
            / "sync"
            / "bunk_request_processor"
            / "orchestrator"
            / "orchestrator.py"
        )
        source = orchestrator_path.read_text()
        # Direct ai_config.get OR self.ai_config.get — both are bugs.
        assert phantom_key not in source, f"Phantom blob read still present: {phantom_key}. Drop the lookup."

    def test_context_builder_no_common_nicknames_phantom(self) -> None:
        import pathlib

        path = (
            pathlib.Path(__file__).resolve().parent.parent.parent.parent.parent
            / "bunking"
            / "sync"
            / "bunk_request_processor"
            / "services"
            / "context_builder.py"
        )
        assert "common_nicknames" not in path.read_text()

    def test_nickname_groups_no_common_nicknames_phantom(self) -> None:
        import pathlib

        path = (
            pathlib.Path(__file__).resolve().parent.parent.parent.parent.parent
            / "bunking"
            / "sync"
            / "bunk_request_processor"
            / "shared"
            / "nickname_groups.py"
        )
        assert "common_nicknames" not in path.read_text()
