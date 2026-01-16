"""Request Orchestrator - Coordinates the three-phase processing with all V1 and V2 components"""

from __future__ import annotations

import hashlib
import logging
import warnings
from collections.abc import Callable
from typing import TYPE_CHECKING, Any

from bunking.config.loader import ConfigLoader
from pocketbase import PocketBase

if TYPE_CHECKING:
    from bunking.sync.bunk_request_processor.data.data_access_context import (
        DataAccessContext,
    )

from ..confidence.confidence_scorer import ConfidenceScorer
from ..conflict.conflict_detector import ConflictDetector
from ..core.models import (
    AgePreference,
    BunkRequest,
    ParsedRequest,
    ParseRequest,
    ParseResult,
    RequestSource,
    RequestStatus,
    RequestType,
)
from ..data.cache.temporal_name_cache import TemporalNameCache
from ..data.repositories.request_repository import RequestRepository
from ..data.repositories.session_repository import SessionRepository
from ..data.repositories.source_link_repository import SourceLinkRepository
from ..integration.batch_processor import BatchProcessor
from ..integration.provider_factory import ProviderFactory
from ..processing.deduplicator import Deduplicator
from ..processing.priority_calculator import PriorityCalculator
from ..processing.reciprocal_detector import ReciprocalDetector
from ..resolution.interfaces import ResolutionResult
from ..resolution.resolution_pipeline import ResolutionPipeline
from ..services.context_builder import ContextBuilder
from ..services.historical_verification_service import HistoricalVerificationService
from ..services.phase1_parse_service import Phase1ParseService
from ..services.phase2_resolution_service import Phase2ResolutionService
from ..services.phase3_disambiguation_service import Phase3DisambiguationService
from ..services.placeholder_expander import PlaceholderExpander
from ..services.request_builder import RequestBuilder
from ..services.staff_name_detector import StaffNameDetector
from ..services.staff_note_parser import parse_multi_staff_notes
from ..shared.constants import (
    ALL_FIELD_TO_SOURCE_FIELD,
    FIELDS_TO_CHECK,
    UNRESOLVED_ID_DEFAULT,
    UNRESOLVED_ID_MAX,
    UNRESOLVED_ID_MIN,
    is_no_preference,
)
from ..social.adapters import SocialGraphSignalsAdapter
from ..social.social_graph import SocialGraph
from ..validation.request_type_validator import validate_request_type_for_field
from ..validation.rules.self_reference import SelfReferenceRule

logger = logging.getLogger(__name__)


def generate_unresolved_person_id(name_text: str) -> int:
    """Generate a deterministic negative ID for unresolved names.

    This ensures:
    - Same name always gets same ID (idempotent)
    - Different names get different IDs
    - IDs are negative to distinguish from real person IDs
    - Range: -1,000,000 to -1,000,000,000

    Uses MD5 hash for consistency across runs.
    Must match monolith implementation for backward compatibility.
    """
    if not name_text:
        return UNRESOLVED_ID_DEFAULT

    # Normalize the name for consistent hashing
    normalized = name_text.strip().lower()

    # Create MD5 hash of the normalized name
    hash_object = hashlib.md5(normalized.encode("utf-8"))
    hash_hex = hash_object.hexdigest()

    # Take first 8 characters of hex and convert to int
    # This gives us a number between 0 and 4,294,967,295 (32-bit)
    hash_int = int(hash_hex[:8], 16)

    # Make it negative and ensure it's in a reasonable range
    # Range: UNRESOLVED_ID_MAX (-1,000,000) to UNRESOLVED_ID_MIN (-1,000,000,000)
    # Formula matches original: -(1_000_000 + (hash_int % 999_000_000))
    id_range = abs(UNRESOLVED_ID_MIN) - abs(UNRESOLVED_ID_MAX)  # 999_000_000
    unresolved_id = -(abs(UNRESOLVED_ID_MAX) + (hash_int % id_range))

    logger.debug(f"Generated unresolved ID {unresolved_id} for name '{name_text}'")
    return unresolved_id


class RequestOrchestrator:
    """Main orchestrator for the three-phase bunk request processing.

    Integrates V1's proven components with V2's cleaner architecture:
    - Phase 1: AI Parse-Only (V1 prompts + BatchProcessor)
    - Phase 2: Local Resolution (V2 strategies + SocialGraphBuilder)
    - Phase 3: AI Disambiguation (V1 AI + minimal context)
    """

    @staticmethod
    def _is_smart_resolution_enabled(config: dict[str, Any] | None) -> bool:
        """Check if smart resolution is enabled in config.

        Matches monolith behavior: checks smart_local_resolution.enabled,
        defaults to True if missing.

        Args:
            config: AI configuration dict

        Returns:
            True if smart resolution is enabled, False otherwise
        """
        if not config:
            return True
        smart_config = config.get("smart_local_resolution", {})
        return bool(smart_config.get("enabled", True))

    def __init__(
        self,
        pb: PocketBase | None = None,
        year: int = 0,
        session_cm_ids: list[int] | None = None,
        ai_config: dict[str, Any] | None = None,
        data_context: DataAccessContext | None = None,
    ):
        """Initialize the request orchestrator.

        Args:
            pb: PocketBase client (deprecated, use data_context instead)
            year: Current year for processing
            session_cm_ids: Optional list of session CM IDs to filter by
            ai_config: Optional AI configuration override
            data_context: DataAccessContext for repository access (preferred)

        Note:
            Either pb or data_context must be provided. Using pb directly is
            deprecated and will emit a warning. Prefer using data_context.
        """
        # Handle data_context vs pb
        self._data_context = data_context
        if data_context is not None:
            # New pattern: use context
            self.pb = data_context.pb_client
            if year == 0:
                year = data_context._year
        elif pb is not None:
            # Old pattern: direct pb - emit deprecation warning
            warnings.warn(
                "Passing 'pb' directly to RequestOrchestrator is deprecated. "
                "Use 'data_context=DataAccessContext(year)' instead.",
                DeprecationWarning,
                stacklevel=2,
            )
            self.pb = pb
        else:
            raise ValueError("Either 'pb' or 'data_context' must be provided")

        self.year = year
        self.session_cm_ids = session_cm_ids or []
        self._person_sessions: dict[int, list[int]] = {}  # person_cm_id -> [session_cm_ids] current year
        self._person_previous_year_sessions: dict[int, list[int]] = {}  # person_cm_id -> [session_cm_ids] previous year

        # Session repository for DB-based session queries
        self._session_repo = SessionRepository(self.pb)

        # Load AI configuration - use ConfigLoader if not provided
        self.ai_config = ai_config or self._load_ai_config()

        # Initialize components
        self._initialize_components()

        self._stats = {
            # Phase tracking (existing)
            "phase1_parsed": 0,
            "phase2_resolved": 0,
            "phase2_ambiguous": 0,
            "phase3_disambiguated": 0,
            "conflicts_detected": 0,
            "requests_created": 0,
            "self_referential_filtered": 0,
            "duplicates_removed": 0,
            "reciprocal_pairs": 0,
            "no_preference_skipped": 0,
            "status_resolved": 0,
            "status_pending": 0,
            "status_declined": 0,
            "type_bunk_with": 0,
            "type_not_bunk_with": 0,
            "type_age_preference": 0,
            "declined_cross_session": 0,
            "declined_not_attending": 0,
            "declined_other": 0,
            "ai_high_confidence": 0,
            "ai_manual_review": 0,
        }

    def _load_ai_config(self) -> dict[str, Any]:
        """Load AI configuration via ConfigLoader with constant fallbacks.

        Delegates to ConfigLoader.get_ai_config() which:
        - Loads provider settings from environment variables
        - Queries PocketBase for category='ai' config records
        - Builds nested dict from subcategory paths

        Falls back to CONFIDENCE_THRESHOLDS from constants.py when PocketBase
        config is unavailable (e.g., in CI/testing environments).

        Returns:
            AI configuration dict with provider, model, thresholds, etc.
        """
        from bunking.sync.bunk_request_processor.core.constants import CONFIDENCE_THRESHOLDS

        loader = ConfigLoader.get_instance()
        config = loader.get_ai_config()

        # Merge confidence_thresholds from constants as defaults
        # PocketBase values (if loaded) take precedence
        if "confidence_thresholds" not in config:
            config["confidence_thresholds"] = {
                "auto_accept": CONFIDENCE_THRESHOLDS["auto_accept"],  # 0.95
                "resolved": CONFIDENCE_THRESHOLDS["resolved"],  # 0.85
            }

        return config

    def _get_auto_resolve_threshold(self) -> float:
        """Get the confidence threshold for auto-resolving matches.

        Matches with confidence >= threshold are auto-resolved (status=RESOLVED).
        Matches with confidence < threshold stay PENDING for staff confirmation.

        Returns confidence_thresholds.resolved from config (default 0.85).
        Supports legacy 'valid' key for backward compatibility.
        """
        thresholds = self.ai_config.get("confidence_thresholds", {})
        # Try 'resolved' (preferred), then 'valid' (legacy), then default
        return float(thresholds.get("resolved", thresholds.get("valid", 0.85)))

    def _track_request_stats(self, request: BunkRequest) -> None:
        """Track extended statistics for a saved request.

        Updates status breakdown, type breakdown, declined reasons, and AI quality
        metrics based on the request properties.

        Args:
            request: The BunkRequest being saved
        """
        # Track status breakdown
        if request.status == RequestStatus.RESOLVED:
            self._stats["status_resolved"] += 1
        elif request.status == RequestStatus.PENDING:
            self._stats["status_pending"] += 1
        elif request.status == RequestStatus.DECLINED:
            self._stats["status_declined"] += 1

        # Track type breakdown
        if request.request_type == RequestType.BUNK_WITH:
            self._stats["type_bunk_with"] += 1
        elif request.request_type == RequestType.NOT_BUNK_WITH:
            self._stats["type_not_bunk_with"] += 1
        elif request.request_type == RequestType.AGE_PREFERENCE:
            self._stats["type_age_preference"] += 1

        # Track declined reasons (only for declined requests)
        if request.status == RequestStatus.DECLINED:
            declined_reason = request.metadata.get("declined_reason", "") if request.metadata else ""
            declined_reason_lower = declined_reason.lower()
            # Check "not attending" FIRST since it's more specific than "session"
            if "not attending" in declined_reason_lower or "not enrolled" in declined_reason_lower:
                self._stats["declined_not_attending"] += 1
            elif "session mismatch" in declined_reason_lower or "cross-session" in declined_reason_lower:
                self._stats["declined_cross_session"] += 1
            else:
                self._stats["declined_other"] += 1

        # Track AI quality metrics

        if request.confidence_score >= 0.90:
            self._stats["ai_high_confidence"] += 1
        # Manual review: pending status means staff needs to review
        if request.status == RequestStatus.PENDING:
            self._stats["ai_manual_review"] += 1

    def _is_no_preference(self, text: str) -> bool:
        """Check if text indicates 'no preference' and should be skipped.

        Delegates to constants.is_no_preference() for the actual matching.

        Args:
            text: The field value to check

        Returns:
            True if the text is a 'no preference' indicator that should be skipped
        """
        result = is_no_preference(text)
        if result:
            logger.debug(f"Detected 'no preference' indicator: '{text}'")
        return result

    def _validate_request_types(self, parse_results: list[ParseResult]) -> tuple[int, int]:
        """Validate request types based on source field requirements.

        Applies validation to each parsed request:
        - do_not_share_with → MUST produce NOT_BUNK_WITH
        - socialize_preference → MUST produce AGE_PREFERENCE
        - Flexible fields can produce any type but require target_name for bunk types

        Modifies parse_results in place - invalid requests are filtered out.

        Args:
            parse_results: List of ParseResult objects from Phase 1

        Returns:
            Tuple of (validated_count, rejected_count)
        """
        validated_count = 0
        rejected_count = 0

        for result in parse_results:
            if not result.is_valid or not result.parsed_requests:
                continue

            # Validate each parsed request and keep only valid ones
            validated_requests = []
            for parsed_req in result.parsed_requests:
                validated = validate_request_type_for_field(parsed_req)
                if validated is not None:
                    validated_requests.append(validated)
                    validated_count += 1
                else:
                    rejected_count += 1

            # Update the result with validated requests
            result.parsed_requests = validated_requests

            # Mark result as invalid if all requests were rejected
            if not validated_requests and result.is_valid:
                result.is_valid = False

        return validated_count, rejected_count

    def _filter_temporal_conflicts(self, parse_results: list[ParseResult]) -> tuple[int, int]:
        """Filter out superseded requests using structured temporal metadata.

        Filtering order:
        1. Remove requests where is_superseded=True (AI's semantic judgment)
        2. For remaining conflicts (same target, opposite types):
           a. Compare temporal_date if both have parsed dates
           b. Fall back to csv_position (higher = more recent)

        This handles cases like:
        "6/4 wants separate bunks | 6/5 changed minds, wants together"
        where the AI marks the 6/4 request as superseded.

        Args:
            parse_results: List of ParseResult objects to filter

        Returns:
            Tuple of (kept_count, filtered_count)
        """
        kept_count = 0
        filtered_count = 0

        for result in parse_results:
            if not result.is_valid or not result.parsed_requests:
                continue

            filtered_requests = []

            # Pass 1: Filter by is_superseded flag (AI's semantic judgment)
            for req in result.parsed_requests:
                if req.is_superseded:
                    logger.info(
                        f"Filtered superseded request: {req.request_type.value} {req.target_name} "
                        f"(reason: {req.supersedes_reason})"
                    )
                    filtered_count += 1
                else:
                    filtered_requests.append(req)

            # Pass 2: Check for remaining conflicts (same target, opposite types)
            target_groups: dict[str, list[ParsedRequest]] = {}
            for req in filtered_requests:
                target = req.target_name or ""
                target_groups.setdefault(target, []).append(req)

            final_requests = []
            for target, reqs in target_groups.items():
                if len(reqs) == 1:
                    final_requests.append(reqs[0])
                    kept_count += 1
                    continue

                # Check for bunk_with vs not_bunk_with conflict
                bunk_with = [r for r in reqs if r.request_type == RequestType.BUNK_WITH]
                not_bunk = [r for r in reqs if r.request_type == RequestType.NOT_BUNK_WITH]
                other = [r for r in reqs if r.request_type not in (RequestType.BUNK_WITH, RequestType.NOT_BUNK_WITH)]

                if bunk_with and not_bunk:
                    # Conflict exists - resolve by date then position
                    all_conflicting = bunk_with + not_bunk
                    winner = self._resolve_by_date_or_position(all_conflicting)
                    final_requests.append(winner)
                    kept_count += 1
                    filtered_count += len(all_conflicting) - 1
                    logger.info(f"Resolved conflict for '{target}': kept {winner.request_type.value}")
                else:
                    # No conflict - keep all
                    final_requests.extend(reqs)
                    kept_count += len(reqs)

                # Always keep other request types
                final_requests.extend(other)
                kept_count += len(other)

            # Update the result with filtered requests
            result.parsed_requests = final_requests

        return kept_count, filtered_count

    def _resolve_by_date_or_position(self, requests: list[ParsedRequest]) -> ParsedRequest:
        """Resolve conflicting requests by date (preferred) or position (fallback).

        Args:
            requests: List of conflicting requests (same target, opposite types)

        Returns:
            The most recent request based on temporal_date or csv_position
        """
        # Try date comparison first
        dated_requests = [(r, r.temporal_date) for r in requests if r.temporal_date]
        if len(dated_requests) >= 2:
            # Sort by date, return most recent
            dated_requests.sort(key=lambda x: x[1])
            return dated_requests[-1][0]

        # Fall back to csv_position
        return max(requests, key=lambda r: r.csv_position)

    def _filter_post_expansion_conflicts(
        self,
        expansion_results: list[tuple[ParseResult, list[ResolutionResult]]],
    ) -> tuple[list[tuple[ParseResult, list[ResolutionResult]]], int, int]:
        """Filter conflicts introduced by placeholder expansion.

        After SIBLING placeholder expansion, check for cases where the same
        person now has bunk_with and not_bunk_with requests targeting the same
        resolved person_cm_id. This catches conflicts that weren't visible
        during pre-expansion filtering (when target was "SIBLING" string).

        This is a deterministic safety net that doesn't depend on AI correctly
        marking is_superseded flags.

        Args:
            expansion_results: List of (ParseResult, ResolutionResult) tuples
                after placeholder expansion

        Returns:
            Tuple of (filtered_results, kept_count, filtered_count)
        """
        kept_count = 0
        filtered_count = 0

        for parse_result, resolution_results in expansion_results:
            if not parse_result.is_valid or not parse_result.parsed_requests:
                continue

            # Group by resolved person_cm_id
            by_target: dict[int, list[tuple[ParsedRequest, ResolutionResult]]] = {}
            unresolved: list[tuple[ParsedRequest, ResolutionResult]] = []

            for req, res in zip(parse_result.parsed_requests, resolution_results, strict=True):
                if res.person and res.person.cm_id:
                    target_id = res.person.cm_id
                    by_target.setdefault(target_id, []).append((req, res))
                else:
                    # Unresolved - keep for later processing
                    unresolved.append((req, res))

            # Check each target for bunk_with vs not_bunk_with conflict
            final_requests: list[ParsedRequest] = []
            final_resolutions: list[ResolutionResult] = []

            for target_id, pairs in by_target.items():
                bunk_with = [(r, res) for r, res in pairs if r.request_type == RequestType.BUNK_WITH]
                not_bunk = [(r, res) for r, res in pairs if r.request_type == RequestType.NOT_BUNK_WITH]

                if bunk_with and not_bunk:
                    # Conflict! Pick winner by date/position
                    all_reqs = [r for r, _ in bunk_with + not_bunk]
                    winner = self._resolve_by_date_or_position(all_reqs)
                    # Find the resolution result for the winner
                    for r, res in bunk_with + not_bunk:
                        if r is winner:
                            final_requests.append(r)
                            final_resolutions.append(res)
                            kept_count += 1
                            break
                    filtered_count += len(bunk_with) + len(not_bunk) - 1
                    logger.info(f"Post-expansion conflict: kept {winner.request_type.value} for target {target_id}")
                else:
                    # No conflict - keep all
                    for r, res in pairs:
                        final_requests.append(r)
                        final_resolutions.append(res)
                        kept_count += 1

            # Add unresolved requests
            for req, res in unresolved:
                final_requests.append(req)
                final_resolutions.append(res)
                kept_count += 1

            # Update in-place
            parse_result.parsed_requests = final_requests
            resolution_results[:] = final_resolutions

        return expansion_results, kept_count, filtered_count

    def _initialize_components(self) -> None:
        """Initialize all components with proper dependency injection.

        Delegates to focused helper methods for each subsystem.
        """
        # Initialize in dependency order
        self._init_cache_system()
        self._init_repositories()
        self._init_ai_provider()
        self._init_scoring_components()
        self._init_social_graph()
        self._init_resolution_pipeline()
        self._init_phase_services()
        self._init_validation_components()
        self._init_extracted_services()

        # Load person-session mapping
        self._load_person_sessions()

        logger.info(
            f"Initialized RequestOrchestrator for year {self.year}, "
            f"sessions {self.session_cm_ids} with AI provider {self.ai_config['provider']}"
        )

        # Log cache configuration
        if self.cache_monitor:
            logger.info("Cache monitoring enabled")

    def _init_cache_system(self) -> None:
        """Initialize cache manager, monitor, and temporal name cache."""
        from ..data.cache import CacheManager, CacheMonitor, create_cache_monitor

        cache_config = self.ai_config.get("cache", {})
        self.cache_manager = CacheManager(cache_config)

        # Create cache monitor if monitoring is enabled
        monitor: CacheMonitor | None
        if cache_config.get("enable_monitoring", False):
            monitor = create_cache_monitor(self.cache_manager, cache_config.get("monitor", {}))
        else:
            monitor = None
        self.cache_monitor = monitor

        # Create temporal name cache for O(1) name lookups
        # Initialized lazily before Phase 2 resolution
        self.temporal_name_cache = TemporalNameCache(self.pb, self.year)

    def _init_repositories(self) -> None:
        """Initialize data repositories."""
        from ..data.repositories.attendee_repository import AttendeeRepository
        from ..data.repositories.person_repository import PersonRepository

        self._attendee_repo = AttendeeRepository(self.pb)
        self._person_repo = PersonRepository(self.pb, name_cache=self.temporal_name_cache)

    def _init_ai_provider(self) -> None:
        """Initialize AI provider, context builder, and batch processor."""
        from ..integration.ai_service import AIServiceConfig

        # Create AI provider using factory
        provider_factory = ProviderFactory()
        ai_service_config = AIServiceConfig(
            provider=self.ai_config.get("provider", "openai"),
            api_key=self.ai_config.get("api_key"),
            model=self.ai_config.get("model", "gpt-4o-mini"),
            base_url=self.ai_config.get("endpoint"),
        )
        self.ai_provider = provider_factory.create(ai_service_config)

        # Create context builder
        self.context_builder = ContextBuilder()

        # Create staff name detector for filtering staff/parent names from targets
        self.staff_name_detector = StaffNameDetector()

        # Create native V2 batch processor
        self.batch_processor = BatchProcessor(
            ai_provider=self.ai_provider, config={"batch_processing": self.ai_config.get("batch_processing", {})}
        )

    def _init_scoring_components(self) -> None:
        """Initialize confidence scorer, conflict detector, and priority calculator."""
        # Social graph signals will be linked after social graph init
        self.social_graph_signals: SocialGraphSignalsAdapter | None = None

        # Create native V2 confidence scorer
        self.confidence_scorer = ConfidenceScorer(
            config=self.ai_config,
            attendee_repo=self._attendee_repo,
            social_graph_signals=None,  # Will be linked after social graph init
            person_repo=self._person_repo,
        )

        # Create native V2 conflict detector
        conflict_config = self.ai_config.get("conflict_detection", {})
        self.conflict_detector = ConflictDetector(conflict_config)

        # Create priority calculator with config from ai_config.json
        priority_config = self.ai_config.get("priority", {})
        self.priority_calculator = PriorityCalculator(priority_config)

        # Create spread filter from unified spread.* config
        from bunking.config.loader import ConfigLoader

        from ..name_resolution.filters.spread_filter import SpreadFilter

        config_loader = ConfigLoader()
        spread_enabled = self.ai_config.get("spread_validation", {}).get("enabled", True)
        spread_filter: SpreadFilter | None
        if spread_enabled:
            spread_filter = SpreadFilter(
                grade_spread=config_loader.get_int("spread.max_grade", default=2),
                age_spread_months=config_loader.get_int("spread.max_age_months", default=24),
            )
        else:
            spread_filter = None
        self.spread_filter = spread_filter

    def _init_social_graph(self) -> None:
        """Initialize social graph service if enabled."""
        self._smart_resolution_enabled = self._is_smart_resolution_enabled(self.ai_config)

        if not self._smart_resolution_enabled:
            logger.info("Smart resolution disabled via config - skipping social graph initialization")
            self.social_graph = None
            return

        # SocialGraph expects PocketBase - use the underlying client
        self.social_graph = SocialGraph(pb=self.pb, year=self.year, session_cm_ids=self.session_cm_ids)  # type: ignore[arg-type]

        # Create adapter that wraps SocialGraph for confidence scorer
        # Pass a getter so adapter always sees current _person_sessions
        signals_adapter = SocialGraphSignalsAdapter(
            self.social_graph, person_sessions_getter=lambda: self._person_sessions
        )
        # SocialGraphSignalsAdapter implements SocialGraphSignals interface via duck typing
        self.social_graph_signals = signals_adapter
        self.confidence_scorer.social_graph_signals = signals_adapter  # type: ignore[assignment]

    def _init_resolution_pipeline(self) -> None:
        """Initialize resolution pipeline with strategies."""
        from ..resolution.strategies.exact_match import ExactMatchStrategy
        from ..resolution.strategies.fuzzy_match import FuzzyMatchStrategy
        from ..resolution.strategies.phonetic_match import PhoneticMatchStrategy
        from ..resolution.strategies.school_disambiguation import SchoolDisambiguationStrategy

        # Extract resolution config from PocketBase-loaded config
        resolution_config = self.ai_config.get("confidence_scoring", {}).get("resolution", {})
        fuzzy_config = resolution_config.get("fuzzy", {})
        phonetic_config = resolution_config.get("phonetic", {})

        self.resolution_pipeline = ResolutionPipeline(self._person_repo, self._attendee_repo)
        self.resolution_pipeline.add_strategy(ExactMatchStrategy(self._person_repo, self._attendee_repo))
        self.resolution_pipeline.add_strategy(
            FuzzyMatchStrategy(self._person_repo, self._attendee_repo, config=fuzzy_config)
        )
        self.resolution_pipeline.add_strategy(
            PhoneticMatchStrategy(self._person_repo, self._attendee_repo, config=phonetic_config)
        )
        self.resolution_pipeline.add_strategy(SchoolDisambiguationStrategy(self._person_repo, self._attendee_repo))

        # Set spread filter if enabled
        if self.spread_filter:
            self.resolution_pipeline.set_spread_filter(self.spread_filter)

        # Set cache for resolution pipeline
        self.resolution_pipeline.set_cache(self.cache_manager)

    def _init_phase_services(self) -> None:
        """Initialize phase 1, 2, and 3 services."""
        self.phase1_service = Phase1ParseService(
            ai_service=self.ai_provider,
            context_builder=self.context_builder,
            batch_processor=self.batch_processor,
            cache_manager=self.cache_manager,
        )

        self.phase2_service = Phase2ResolutionService(
            resolution_pipeline=self.resolution_pipeline,
            networkx_analyzer=self.social_graph,  # SocialGraph has compatible interface
            confidence_scorer=self.confidence_scorer,
            staff_name_filter=self.is_staff_name,  # Filter detected staff names from resolution
            attendee_repository=self._attendee_repo,  # For prior bunkmate resolution
            person_repository=self._person_repo,  # For prior bunkmate name matching
        )

        self.phase3_service = Phase3DisambiguationService(
            ai_provider=self.ai_provider,
            context_builder=self.context_builder,
            batch_processor=self.batch_processor,
            confidence_scorer=self.confidence_scorer,
            spread_filter=self.spread_filter,
            cache_manager=self.cache_manager,
        )

    def _init_validation_components(self) -> None:
        """Initialize request repository and validation pipeline components."""
        self.request_repository = RequestRepository(self.pb)
        self.source_link_repository = SourceLinkRepository(self.pb)
        self.self_reference_rule = SelfReferenceRule()
        self.deduplicator = Deduplicator(self.request_repository)
        self.reciprocal_detector = ReciprocalDetector(
            confidence_boost=self.ai_config.get("reciprocal_confidence_boost", 0.1)
        )

        # Create request builder for constructing BunkRequest objects
        self.request_builder = RequestBuilder(
            priority_calculator=self.priority_calculator,
            temporal_name_cache=self.temporal_name_cache,
            year=self.year,
            auto_resolve_threshold=self._get_auto_resolve_threshold(),
        )

    def _init_extracted_services(self) -> None:
        """Initialize services extracted from orchestrator for reduced complexity.

        These services encapsulate specific orchestrator functionality:
        - PlaceholderExpander: Expands LAST_YEAR_BUNKMATES placeholders
        - HistoricalVerificationService: Verifies historical bunking groups
        """
        self.placeholder_expander = PlaceholderExpander(
            attendee_repo=self._attendee_repo,
            person_repo=self._person_repo,
            year=self.year,
        )
        self.historical_verification_service = HistoricalVerificationService(
            temporal_name_cache=self.temporal_name_cache,
        )

    def _load_person_sessions(self) -> None:
        """Load person_cm_id to session_cm_id mapping from attendees table.

        Loads BOTH current year and previous year data:
        - _person_sessions: current year sessions (for filtering/processing)
        - _person_previous_year_sessions: previous year sessions (for disambiguation)

        Session continuity is a strong signal - kids often return to the same session
        year after year, and knowing prior session helps disambiguate names like
        "Sarah from last year" to "Sarah who was in Session 2 last year".
        """
        try:
            # Use DB-based session lookup for valid bunking sessions
            valid_session_ids = self._session_repo.get_valid_bunking_session_ids(self.year)

            # Delegate to repository for data loading
            result = self._attendee_repo.build_person_session_mappings(
                year=self.year, valid_session_ids=valid_session_ids, current_session_cm_ids=self.session_cm_ids
            )

            # Extract mappings
            self._person_sessions = result["person_sessions"]
            self._person_previous_year_sessions = result["person_previous_year_sessions"]
            stats = result["stats"]

            # Check for errors
            if "error" in stats:
                logger.warning(stats["error"])
                return

            # Log summary
            logger.info(
                f"Loaded {stats['unique_persons']} unique persons with "
                f"{stats['total_enrollments']} current year enrollments "
                f"(skipped {stats['filtered_count']} non-bunking)"
            )

            if stats["prev_year_persons"] > 0:
                logger.info(
                    f"Loaded {stats['prev_year_persons']} persons with "
                    f"{stats['prev_year_count']} previous year enrollments "
                    f"(for session-based disambiguation)"
                )

            if stats["multi_session_count"] > 0:
                logger.info(
                    f"{stats['multi_session_count']} persons attend multiple sessions (this is normal and expected)"
                )

        except Exception as e:
            logger.error(f"Failed to load person-session mappings: {e}")
            self._person_sessions = {}
            self._person_previous_year_sessions = {}

    def get_previous_year_session(self, person_cm_id: int) -> int | None:
        """Get the session a person attended in the previous year.

        Used for session-based disambiguation when resolving names like
        "Sarah from last year" - prioritizes Sarahs who were in the same
        session as the requester last year.

        Args:
            person_cm_id: Person's CampMinder ID

        Returns:
            Session CM ID from previous year, or None if not found
        """
        sessions = self._person_previous_year_sessions.get(person_cm_id, [])
        return sessions[0] if sessions else None

    async def process_requests(
        self,
        raw_requests: list[dict[str, Any]],
        clear_existing: bool = True,
        progress_callback: Callable[..., Any] | None = None,
    ) -> dict[str, Any]:
        """Process bunk requests through all three phases.

        Args:
            raw_requests: List of raw request data from the source
            clear_existing: Whether to clear existing requests first (default True).
                           Uses granular per-field clearing to only remove requests
                           from source_fields being reprocessed, preserving others.
            progress_callback: Optional callback for progress updates

        Returns:
            Processing results with statistics
        """
        logger.info(f"Starting three-phase processing for {len(raw_requests)} requests")

        # First pass: detect staff names from all records BEFORE processing
        # This builds a global set for filtering during resolution
        self._detect_staff_names(raw_requests)

        # Clear existing if requested
        if clear_existing:
            await self._clear_existing_requests(raw_requests)

        # Convert raw requests to ParseRequest objects
        parse_requests, pre_parsed_results = await self._prepare_parse_requests(raw_requests)

        # Phase 1: AI Parse-Only (skip if no requests need AI)
        if parse_requests:
            logger.info(f"=== Phase 1: AI Parse-Only ({len(parse_requests)} requests) ===")
            ai_parse_results = await self.phase1_service.batch_parse(parse_requests, progress_callback)
        else:
            logger.info("=== Phase 1: Skipped (no AI parsing needed) ===")
            ai_parse_results = []

        # Combine AI-parsed and pre-parsed results
        parse_results = ai_parse_results + pre_parsed_results
        self._stats["phase1_parsed"] = len([r for r in parse_results if r.is_valid])

        # Log pre-parsed stats
        if pre_parsed_results:
            logger.info(f"Pre-parsed {len(pre_parsed_results)} requests without AI (e.g., socialize preferences)")

        # This catches AI errors where wrong request type is returned for strict fields
        validated_count, rejected_count = self._validate_request_types(parse_results)
        if rejected_count > 0:
            logger.info(f"Validated {validated_count} requests, rejected {rejected_count} invalid")

        # Filter temporal conflicts (e.g., "6/4 separate | 6/5 together" keeps only most recent)
        kept_count, conflict_filtered = self._filter_temporal_conflicts(parse_results)
        if conflict_filtered > 0:
            logger.info(f"Temporal conflict filter: kept {kept_count} requests, filtered {conflict_filtered} stale")

        # Initialize temporal name cache before Phase 2

        logger.info("=== Initializing Temporal Name Cache ===")
        self.temporal_name_cache.initialize()  # Sync - PocketBase SDK is synchronous
        cache_stats = self.temporal_name_cache.get_stats()
        logger.info(f"Cache ready: {cache_stats['persons_loaded']} persons, {cache_stats['unique_names']} name keys")

        # Initialize social graph between Phase 1 and Phase 2 (if enabled)
        # This is when we need it for confidence scoring and resolution
        if self._smart_resolution_enabled and self.social_graph:
            logger.info("=== Initializing Social Graph ===")
            await self.social_graph.initialize()
        else:
            logger.info("=== Skipping Social Graph (disabled via config) ===")

        # Phase 2: Local Resolution
        logger.info("=== Phase 2: Local Resolution ===")
        resolution_results = await self.phase2_service.batch_resolve(parse_results)

        # Expand LAST_YEAR_BUNKMATES placeholders into individual bunk_with requests
        # This must happen after Phase 2 resolution and before Phase 3 disambiguation
        logger.info("=== Expanding LAST_YEAR_BUNKMATES Placeholders ===")
        resolution_results = await self.placeholder_expander.expand(resolution_results)

        # Post-expansion conflict detection: catch conflicts that weren't visible before
        # SIBLING expansion (e.g., "not_bunk_with Pippi" vs "bunk_with SIBLING" → Pippi)
        resolution_results, post_kept, post_filtered = self._filter_post_expansion_conflicts(resolution_results)
        if post_filtered > 0:
            logger.info(f"Post-expansion conflict filter: kept {post_kept}, filtered {post_filtered}")

        # Phase 2.5: Historical Group Verification
        # Verify that multiple targets for same historical year were actually in same bunk
        # Boost confidence by +0.10 for verified groups (capped at 0.95)
        logger.info("=== Phase 2.5: Historical Group Verification ===")
        resolution_results = await self.historical_verification_service.verify(resolution_results)

        # Count Phase 2 results (on expanded results)
        for _, resolution_list in resolution_results:
            for res_result in resolution_list:
                if res_result.is_resolved:
                    self._stats["phase2_resolved"] += 1
                elif res_result.is_ambiguous:
                    self._stats["phase2_ambiguous"] += 1

        # Phase 3: AI Disambiguation (for unresolved cases)
        unresolved_cases = []
        unresolved_indices = []
        phase3_processed = set()  # Track which indices went through Phase 3

        # Debug logging for Phase 3 decision
        total_unresolved = 0
        for idx, (pr, resolution_list) in enumerate(resolution_results):
            unresolved_in_this = sum(
                1 for rr in resolution_list if not rr.is_resolved and rr.method != "age_preference"
            )
            if unresolved_in_this > 0:
                total_unresolved += unresolved_in_this
                logger.debug(f"ParseResult {idx} has {unresolved_in_this} unresolved requests")

        logger.info(
            f"Phase 3 check: Found {total_unresolved} total unresolved requests across {len(resolution_results)} ParseResults"
        )

        for idx, (pr, resolution_list) in enumerate(resolution_results):
            # Check if any resolutions in this ParseResult are unresolved
            # Skip pre-parsed requests (like age preferences from dropdowns)
            has_unresolved = any(not rr.is_resolved and rr.method != "age_preference" for rr in resolution_list)
            if has_unresolved:
                unresolved_cases.append((pr, resolution_list))
                unresolved_indices.append(idx)
                phase3_processed.add(idx)

        if unresolved_cases:
            logger.info(f"=== Phase 3: AI Disambiguation for {len(unresolved_cases)} cases ===")
            disambiguated_results = await self.phase3_service.batch_disambiguate(unresolved_cases, progress_callback)

            # Replace unresolved results with disambiguated ones
            final_results = resolution_results.copy()
            for idx, (pr, resolution_list) in enumerate(disambiguated_results):
                original_idx = unresolved_indices[idx]
                final_results[original_idx] = (pr, resolution_list)
                # Count how many were disambiguated
                for rr in resolution_list:
                    if rr.is_resolved:
                        self._stats["phase3_disambiguated"] += 1
            resolution_results = final_results

        # Store phase3_processed for later use
        self._phase3_indices = phase3_processed

        # Convert to request format for conflict detection
        resolved_requests = self._prepare_for_conflict_detection(resolution_results)

        # Detect conflicts
        logger.info("=== Conflict Detection ===")
        conflict_result = self.conflict_detector.detect_conflicts(resolved_requests)
        self._stats["conflicts_detected"] = len(conflict_result.conflicts)

        if conflict_result.has_conflicts:
            logger.info(self.conflict_detector.get_conflict_summary(conflict_result))
            # Apply conflict resolution
            resolved_requests = self.conflict_detector.apply_conflict_resolution(resolved_requests, conflict_result)

        # Create bunk requests
        logger.info("=== Creating Bunk Requests ===")
        created_requests = await self._create_bunk_requests(resolved_requests)
        self._stats["requests_created"] = len(created_requests)

        # Log final statistics
        logger.info(
            f"Processing complete: "
            f"{self._stats['phase1_parsed']} parsed, "
            f"{self._stats['phase2_resolved']} resolved locally, "
            f"{self._stats['phase2_ambiguous']} ambiguous, "
            f"{self._stats['phase3_disambiguated']} disambiguated, "
            f"{self._stats['conflicts_detected']} conflicts, "
            f"{self._stats['requests_created']} created"
        )

        if self._stats["requests_created"] > 0:
            logger.info(
                f"Status breakdown: "
                f"resolved={self._stats['status_resolved']}, "
                f"pending={self._stats['status_pending']}, "
                f"declined={self._stats['status_declined']}"
            )
            logger.info(
                f"Type breakdown: "
                f"bunk_with={self._stats['type_bunk_with']}, "
                f"not_bunk_with={self._stats['type_not_bunk_with']}, "
                f"age_preference={self._stats['type_age_preference']}"
            )
            if self._stats["status_declined"] > 0:
                logger.info(
                    f"Declined reasons: "
                    f"cross_session={self._stats['declined_cross_session']}, "
                    f"not_attending={self._stats['declined_not_attending']}, "
                    f"other={self._stats['declined_other']}"
                )
            logger.info(
                f"AI quality: "
                f"high_confidence={self._stats['ai_high_confidence']}, "
                f"manual_review={self._stats['ai_manual_review']}"
            )

        # Log cache statistics if monitor is available
        if self.cache_monitor:
            self.cache_monitor.log_statistics()
            self.cache_monitor.log_cache_recommendation()

        return {
            "success": True,
            "requests_created": created_requests,
            "statistics": self._stats,
            "conflicts": conflict_result.conflicts if conflict_result.has_conflicts else [],
        }

    def _parse_socialize_preference(self, value: str) -> ParsedRequest | None:
        """Parse the ret_parent_socialize_with_best field directly without AI.

        This field has exactly two possible dropdown values that map to age preferences:
        - "Kids their own grade and one grade above" → "older"
        - "Kids their own grade and one grade below" → "younger"

        Args:
            value: The field value to parse

        Returns:
            ParsedRequest with age preference or None if not a valid value
        """
        if not value or value.strip() == "":
            return None

        # Map exact dropdown values to age preferences
        if value == "Kids their own grade and one grade above":
            target = AgePreference.OLDER
        elif value == "Kids their own grade and one grade below":
            target = AgePreference.YOUNGER
        else:
            # Unknown value - shouldn't happen with dropdown but handle gracefully
            logger.warning(f"Unknown socialize_preference value: {value}")
            return None

        # Create ParsedRequest with 100% confidence for exact dropdown matches
        return ParsedRequest(
            raw_text=value,
            request_type=RequestType.AGE_PREFERENCE,
            target_name=None,
            age_preference=target,
            source_field="ret_parent_socialize_with_best",
            source=RequestSource.FAMILY,
            confidence=1.0,  # 100% confidence for exact dropdown matches
            csv_position=1,
            metadata={
                "source_type": "family",
                "source_detail": "social",  # Matches AI's classification
                "target": target.value,
                "parse_notes": f"Parent form field: prefers {target.value} kids",
                "pre_parsed": True,  # Mark as pre-parsed
                "ai_parsed": False,
                "keywords_found": [],
                # No ai_reasoning for pre-parsed requests
            },
            notes=f"Parent form field: prefers {target} kids",
        )

    async def _prepare_parse_requests(
        self, raw_requests: list[dict[str, Any]]
    ) -> tuple[list[ParseRequest], list[ParseResult]]:
        """Convert raw request data to ParseRequest objects.

        Includes FC content filtering for bunking_notes and internal_bunk_notes
        to remove Family Camp specific content before summer camp processing.

        Returns:
            Tuple of (parse_requests, pre_parsed_results)
            - parse_requests: Requests that need AI parsing
            - pre_parsed_results: Already parsed results (e.g., socialize preferences)
        """
        parse_requests = []
        pre_parsed_results = []

        # Diagnostic: Track filtering
        skipped_no_session = 0
        skipped_no_text = 0
        total_fields_checked = 0

        # Diagnostic: Log person_sessions state
        logger.info(
            f"_prepare_parse_requests: person_sessions has {len(self._person_sessions)} persons, "
            f"processing {len(raw_requests)} raw_requests"
        )

        for row in raw_requests:
            # Extract request texts from various fields (defined in constants.py)
            for field_key, field_name in FIELDS_TO_CHECK:
                total_fields_checked += 1
                request_text = row.get(field_key, "").strip()
                if not request_text:
                    skipped_no_text += 1
                    continue

                # Check for "no preference" indicators before processing
                if self._is_no_preference(request_text):
                    self._stats["no_preference_skipped"] += 1
                    continue

                # Extract staff signatures from bunking_notes before AI parsing
                # bunking_notes has STAFFNAME (DATETIME) patterns; internal_bunk_notes does not
                staff_metadata = None
                if field_key == "bunking_notes_notes":
                    parsed_notes = parse_multi_staff_notes(request_text)

                    request_text = " | ".join([n["content"] for n in parsed_notes if n["content"]])
                    # Extract staff metadata from parsed notes
                    staff_entries = [n for n in parsed_notes if n["staff"]]
                    if staff_entries:
                        # Use the most recent staff entry (last in list)
                        staff_metadata = {
                            "staff_name": staff_entries[-1]["staff"],
                            "timestamp": staff_entries[-1]["timestamp"],
                            "all_staff": [{"staff": n["staff"], "timestamp": n["timestamp"]} for n in staff_entries],
                        }
                    if not request_text:
                        # All content was in staff signatures, skip this field
                        continue

                # Handle both field formats
                # CSV format: PersonID, First, Last, Grade
                requester_cm_id = int(row.get("requester_cm_id", row.get("PersonID", 0)))

                # Build name from available fields
                first_name = row.get("first_name", row.get("First", ""))
                last_name = row.get("last_name", row.get("Last", ""))
                requester_name = f"{first_name} {last_name}".strip()

                # For now, use 0 as placeholder if not provided
                requester_grade = str(row.get("Grade", 0))

                # Look up sessions from person_sessions mapping
                person_sessions = self._person_sessions.get(requester_cm_id, [])
                if not person_sessions:
                    # Person not enrolled or not in filtered session
                    skipped_no_session += 1
                    logger.debug(f"Skipping request for person {requester_cm_id} - not enrolled")
                    continue

                # Use the first valid session for this person
                # TODO: In future, could match based on request context
                person_session_cm_id = person_sessions[0]

                # Handle ret_parent_socialize_with_best without AI
                if field_key == "ret_parent_socialize_with_best":
                    parsed_req = self._parse_socialize_preference(request_text)
                    if parsed_req:
                        # Create ParseRequest for context
                        parse_request = ParseRequest(
                            request_text=request_text,
                            field_name=field_name,
                            requester_cm_id=requester_cm_id,
                            requester_name=requester_name,
                            requester_grade=requester_grade,
                            session_cm_id=person_session_cm_id,
                            session_name=row.get("Session", ""),
                            year=row.get("year", self.year),
                            row_data=row,
                        )

                        # Create ParseResult with the pre-parsed request
                        parse_result = ParseResult(
                            parsed_requests=[parsed_req],  # Changed to list
                            needs_historical_context=False,
                            is_valid=True,
                            parse_request=parse_request,
                            metadata={"pre_parsed": True, "source": "dropdown_field", "ai_parsed": False},
                        )
                        pre_parsed_results.append(parse_result)

                        # Skip adding to parse_requests - no AI needed
                        continue

                # Regular parsing flow for other fields
                parse_request = ParseRequest(
                    request_text=request_text,
                    field_name=field_name,
                    requester_cm_id=requester_cm_id,
                    requester_name=requester_name,
                    requester_grade=requester_grade,
                    session_cm_id=person_session_cm_id,
                    session_name=row.get("Session", ""),
                    year=row.get("year", self.year),
                    row_data=row,
                    staff_metadata=staff_metadata,  # Staff attribution for bunking_notes
                )

                # Log staff metadata for debugging (now also stored in ParseRequest)
                if staff_metadata:
                    logger.debug(
                        f"Extracted staff signatures from bunking notes: "
                        f"{[s['staff'] for s in staff_metadata.get('all_staff', [])]}"
                    )

                parse_requests.append(parse_request)

        # Diagnostic: Log summary
        logger.info(
            f"_prepare_parse_requests summary: "
            f"fields_checked={total_fields_checked}, "
            f"skipped_no_text={skipped_no_text}, "
            f"skipped_no_session={skipped_no_session}, "
            f"no_preference={self._stats.get('no_preference_skipped', 0)}, "
            f"parse_requests={len(parse_requests)}, "
            f"pre_parsed={len(pre_parsed_results)}"
        )

        return parse_requests, pre_parsed_results

    def _detect_staff_names(self, raw_requests: list[dict[str, Any]]) -> None:
        """Detect staff/parent names from all bunking notes before processing.

        This runs early in process_requests() to build a global set of detected
        staff names that can be filtered from bunk targets during resolution.

        Args:
            raw_requests: List of raw request data containing notes fields
        """
        # Extract all notes texts for detection
        notes_texts: list[str | None] = []
        for req in raw_requests:
            bunking_notes = (req.get("bunking_notes_notes") or "").strip()
            internal_notes = (req.get("internal_bunk_notes") or "").strip()
            combined = f"{bunking_notes} {internal_notes}".strip()
            if combined:
                notes_texts.append(combined)

        # Build global set of detected staff names
        detected = self.staff_name_detector.build_global_set(notes_texts)
        self.staff_name_detector.detected_staff_names = detected

        if detected:
            logger.info(f"Detected {len(detected)} likely staff/parent names: {sorted(detected)}")

    def is_staff_name(self, name: str | None) -> bool:
        """Check if a name matches a detected staff/parent name.

        Helper method for use during resolution and request creation.

        Args:
            name: The name to check

        Returns:
            True if name is a detected staff name, False otherwise
        """
        return self.staff_name_detector.is_staff_name(name)

    def _prepare_for_conflict_detection(
        self, resolution_results: list[tuple[ParseResult, list[ResolutionResult]]]
    ) -> list[tuple[ParsedRequest, dict[str, Any]]]:
        """Prepare resolved requests for conflict detection - now flattens the list structure"""
        resolved_requests = []

        for idx, (parse_result, resolution_list) in enumerate(resolution_results):
            if not parse_result.is_valid or not parse_result.parsed_requests:
                continue

            # Skip if parse_request is None (shouldn't happen but mypy requires check)
            if parse_result.parse_request is None:
                continue

            # Process each parsed request with its corresponding resolution
            for req_idx, (parsed_req, resolution_result) in enumerate(
                zip(parse_result.parsed_requests, resolution_list, strict=False)
            ):
                # Build resolution info
                resolution_info = {
                    "requester_cm_id": parse_result.parse_request.requester_cm_id,
                    "requester_name": parse_result.parse_request.requester_name,
                    "session_cm_id": parse_result.parse_request.session_cm_id,
                    "confidence": resolution_result.confidence if resolution_result else 0.0,
                    "phase3_disambiguated": idx in getattr(self, "_phase3_indices", set()),
                    "field_index": req_idx,  # Track position within field
                    "total_in_field": len(parse_result.parsed_requests),  # Track total requests in field
                }

                if resolution_result and resolution_result.is_resolved and resolution_result.person:
                    resolution_info["person_cm_id"] = resolution_result.person.cm_id
                    resolution_info["person_name"] = resolution_result.person.full_name
                    resolution_info["resolution_method"] = resolution_result.method
                    resolution_info["confidence_factors"] = getattr(resolution_result, "confidence_factors", [])
                    # Pass along resolution metadata (includes Phase 3 reasoning if applicable)
                    if resolution_result.metadata:
                        resolution_info["resolution_metadata"] = resolution_result.metadata
                elif parsed_req.request_type == RequestType.AGE_PREFERENCE:
                    # Age preferences don't need person resolution
                    resolution_info["person_cm_id"] = None
                else:
                    # Unresolved requests get negative IDs - status will be PENDING
                    if parsed_req.target_name:
                        unresolved_id = generate_unresolved_person_id(parsed_req.target_name)
                        resolution_info["person_cm_id"] = unresolved_id
                        resolution_info["person_name"] = parsed_req.target_name  # Keep original name
                        resolution_info["resolution_method"] = (
                            resolution_result.method if resolution_result else "unresolved"
                        )

                        # Check if this was filtered as a staff/parent name
                        if resolution_result and resolution_result.method == "staff_filtered":
                            resolution_info["likely_staff"] = True
                            logger.warning(f"Flagged likely staff/parent name: '{parsed_req.target_name}'")
                        else:
                            logger.info(
                                f"Created unresolved request for '{parsed_req.target_name}' with ID {unresolved_id}"
                            )
                    else:
                        # No target name - skip this request (log warning for data quality visibility)
                        logger.warning(
                            f"Invalid {parsed_req.request_type.value} request without target name "
                            f"from {parsed_req.source_field} - skipping"
                        )
                        continue

                resolved_requests.append((parsed_req, resolution_info))

        return resolved_requests

    async def _clear_existing_requests(self, raw_requests: list[dict[str, Any]]) -> None:
        """Clear existing requests for specific source fields per person.

        Uses granular per-field clearing like V1:
        - Only clears requests from source_fields being reprocessed
        - Preserves requests from unchanged fields
        """
        # Map from original_bunk_requests.field to bunk_requests.source_field
        # Defined in constants.py as ALL_FIELD_TO_SOURCE_FIELD

        # Track source fields to clear per person
        # person_cm_id -> set of source_field values
        person_source_fields: dict[int, set[str]] = {}

        for row in raw_requests:
            # Get person ID
            person_id = row.get("PersonID") or row.get("requester_cm_id")
            if not person_id:
                continue
            person_id = int(person_id)

            if person_id not in person_source_fields:
                person_source_fields[person_id] = set()

            # Method 1: Check _original_request_ids (from original_requests_loader)
            original_ids = row.get("_original_request_ids", {})
            for field_name in original_ids:
                source_field = ALL_FIELD_TO_SOURCE_FIELD.get(field_name)
                if source_field:
                    person_source_fields[person_id].add(source_field)

            # Method 2: Check which data fields are present in the row
            # This handles direct CSV processing
            for field_name, source_field in ALL_FIELD_TO_SOURCE_FIELD.items():
                if field_name in row and row[field_name]:
                    person_source_fields[person_id].add(source_field)

        # Clear requests per person, per source field
        total_cleared = 0
        for person_id, source_fields in person_source_fields.items():
            if source_fields:
                cleared = self.request_repository.clear_by_source_fields(
                    requester_cm_id=person_id,
                    source_fields=list(source_fields),
                    year=self.year,
                    session_cm_ids=self.session_cm_ids,
                )
                total_cleared += cleared
                if cleared > 0:
                    logger.debug(
                        f"Cleared {cleared} requests for person {person_id} from source fields: {source_fields}"
                    )

        if total_cleared > 0:
            logger.info(
                f"Cleared {total_cleared} existing requests for "
                f"{len(person_source_fields)} persons (per-field granular clear)"
            )

    async def _create_bunk_requests(
        self, resolved_requests: list[tuple[ParsedRequest, dict[str, Any]]]
    ) -> list[BunkRequest]:
        """Create bunk request records in the database.

        This method:
        1. Builds BunkRequest objects from resolved requests (via RequestBuilder)
        2. Applies the validation pipeline (self-ref, dedup, reciprocal)
        3. Persists validated requests to the database
        """
        # Build BunkRequest objects using the request builder
        pending_requests = self.request_builder.build_requests(resolved_requests)

        # Apply validation pipeline to all requests
        if pending_requests:
            logger.info(f"=== Applying Validation Pipeline to {len(pending_requests)} requests ===")
            validated_requests = self._apply_validation_pipeline(pending_requests)
        else:
            validated_requests = []

        # Save validated requests to database
        return self._save_bunk_requests(validated_requests)

    def _save_bunk_requests(self, validated_requests: list[BunkRequest]) -> list[BunkRequest]:
        """Save validated bunk requests to the database.

        Handles both new requests and cross-run merge scenarios:
        - New requests: Create record and primary source link
        - Database match (unlocked): Merge into existing, add source link
        - Database match (locked): Create new, flag for manual review

        Args:
            validated_requests: List of validated BunkRequest objects

        Returns:
            List of successfully saved requests
        """
        saved_requests = []

        for bunk_request in validated_requests:
            try:
                # Check if this request should be merged with an existing DB record
                if bunk_request.metadata.get("database_match_action") == "merge":
                    if bunk_request.metadata.get("database_match_locked"):
                        # Locked request - create new and flag for manual review
                        saved = self._save_new_request_for_locked_merge(bunk_request)
                    else:
                        # Unlocked - perform auto-merge
                        saved = self._merge_into_existing(bunk_request)
                else:
                    # No database match - create new request with source link
                    saved = self._save_new_request_with_source_link(bunk_request)

                if saved:
                    saved_requests.append(bunk_request)
                    self._track_request_stats(bunk_request)
                else:
                    logger.warning(f"Failed to save bunk request for {bunk_request.requester_cm_id}")

            except Exception as e:
                logger.error(f"Failed to save bunk request: {e}")

        return saved_requests

    def _save_new_request_with_source_link(self, request: BunkRequest) -> bool:
        """Create a new bunk request with primary source link.

        Args:
            request: BunkRequest to create

        Returns:
            True if creation succeeded
        """
        if not self.request_repository.create(request):
            return False

        # Add source link if we have original_request_id
        original_request_id = request.metadata.get("original_request_id")
        if original_request_id and request.id:
            self.source_link_repository.add_source_link(
                bunk_request_id=request.id,
                original_request_id=original_request_id,
                is_primary=True,
                source_field=request.source_field,
            )

        return True

    def _merge_into_existing(self, request: BunkRequest) -> bool:
        """Merge a new request into an existing database record.

        Updates source_fields, confidence, and metadata on the existing record.
        Creates a non-primary source link for the new original_request.

        Args:
            request: BunkRequest with database_duplicate_id in metadata

        Returns:
            True if merge succeeded
        """
        existing_id = request.metadata.get("database_duplicate_id")
        if not existing_id:
            logger.warning("Merge requested but no database_duplicate_id in metadata")
            return False

        # Get existing record to merge with
        existing = self.request_repository.get_by_id(existing_id)
        if not existing:
            logger.warning(f"Could not find existing record {existing_id} for merge")
            return False

        # Combine source_fields arrays
        existing_source_fields = getattr(existing, "source_fields", None) or []
        if isinstance(existing_source_fields, str):
            import json

            try:
                existing_source_fields = json.loads(existing_source_fields)
            except json.JSONDecodeError:
                existing_source_fields = [existing.source_field] if existing.source_field else []

        new_source_fields = list(set(existing_source_fields + [request.source_field]))

        # Use higher confidence score
        final_confidence = max(existing.confidence_score, request.confidence_score)

        # Merge metadata
        merged_metadata = {**existing.metadata, **request.metadata}
        merged_metadata["is_merged_duplicate"] = True
        merged_metadata["merge_source_field"] = request.source_field

        # Update existing record
        if not self.request_repository.update_for_merge(
            record_id=existing_id,
            source_fields=new_source_fields,
            confidence_score=final_confidence,
            metadata=merged_metadata,
        ):
            return False

        # Add source link for the new original_request
        original_request_id = request.metadata.get("original_request_id")
        if original_request_id:
            self.source_link_repository.add_source_link(
                bunk_request_id=existing_id,
                original_request_id=original_request_id,
                is_primary=False,  # Not primary since we're merging
                source_field=request.source_field,
            )

        # Track merge statistics
        self._stats["cross_run_merges"] = self._stats.get("cross_run_merges", 0) + 1

        logger.info(
            f"Merged request into existing {existing_id}: "
            f"source_fields={new_source_fields}, confidence={final_confidence}"
        )

        return True

    def _save_new_request_for_locked_merge(self, request: BunkRequest) -> bool:
        """Create a new request when merge target is locked.

        Locked requests need manual review, so we create a separate record
        and flag it for staff attention.

        Args:
            request: BunkRequest that would have merged with a locked record

        Returns:
            True if creation succeeded
        """
        # Flag for manual review
        request.metadata["requires_manual_merge_review"] = True
        request.metadata["locked_duplicate_id"] = request.metadata.get("database_duplicate_id")

        return self._save_new_request_with_source_link(request)

    def _apply_validation_pipeline(self, requests: list[BunkRequest]) -> list[BunkRequest]:
        """Apply the validation pipeline to a list of BunkRequest objects.

        This pipeline runs in order:
        1. Self-reference validation (mark and modify, keep for staff review)
        2. Deduplication (remove duplicate requests, keep highest priority)
        3. Reciprocal detection (mark reciprocal pairs and boost confidence)

        Args:
            requests: List of BunkRequest objects to validate

        Returns:
            Validated and processed list of BunkRequest objects
        """
        if not requests:
            return requests

        # Step 1: Handle self-referential requests
        # Unlike filtering, we KEEP them with modifications for staff review.
        # This prevents losing valid requests due to false positives
        # (e.g., first-name ambiguity for cross-session friends)
        validated_requests = []
        self_ref_count = 0
        for request in requests:
            validation_result = self.self_reference_rule.validate(request)
            if not validation_result.is_valid:
                # Self-referential detected - modify and keep for staff review
                self_ref_count += 1
                request.requested_cm_id = None  # Clear invalid target
                request.confidence_score = 0.0  # Zero confidence
                request.metadata["self_referential"] = True
                request.metadata["requires_clarification"] = True
                request.metadata["ambiguity_reason"] = "Self-referential request detected"
                request.metadata["manual_review_reason"] = "Self-referential request"

                logger.warning(
                    f"Self-referential request detected (kept for review): "
                    f"{request.requester_cm_id} -> original target cleared"
                )

            validated_requests.append(request)

        # Track both for backwards compatibility and clarity
        self._stats["self_referential_filtered"] = self_ref_count  # Legacy key
        self._stats["self_referential_detected"] = self_ref_count  # New key

        if self_ref_count > 0:
            logger.info(f"Marked {self_ref_count} self-referential request(s) for staff review")

        # Step 2: Deduplicate requests (in-batch only - Go clears DB before reprocessing)
        dedup_result = self.deduplicator.deduplicate_batch(validated_requests)
        deduplicated_requests = dedup_result.kept_requests

        duplicates_removed = dedup_result.statistics.get("duplicates_removed", 0)
        self._stats["duplicates_removed"] = duplicates_removed

        if duplicates_removed > 0:
            logger.info(f"Removed {duplicates_removed} duplicate request(s)")

        # Step 3: Detect and mark reciprocal requests
        reciprocal_pairs = self.reciprocal_detector.detect_reciprocals(deduplicated_requests)
        self._stats["reciprocal_pairs"] = len(reciprocal_pairs)

        # Apply confidence boost to reciprocal pairs
        self.reciprocal_detector.apply_reciprocal_boost(deduplicated_requests)

        if reciprocal_pairs:
            logger.info(f"Detected {len(reciprocal_pairs)} reciprocal pair(s)")

        return deduplicated_requests

    async def close(self) -> None:
        """Clean up resources held by the orchestrator.

        Call this when done processing to ensure proper cleanup of:
        - AI provider HTTP client
        - Any other async resources
        """
        if hasattr(self, "ai_provider") and self.ai_provider:
            # Check if close method exists (OpenAIProvider has it, mock might not)
            if hasattr(self.ai_provider, "close"):
                await self.ai_provider.close()
                logger.debug("AI provider closed")
