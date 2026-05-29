"""Request Orchestrator - Coordinates the three-phase processing with all V1 and V2 components"""

from __future__ import annotations

import hashlib
import re
import warnings
from collections.abc import Callable
from typing import TYPE_CHECKING, Any

from bunking.config.loader import ConfigLoader
from bunking.logging_config import get_logger
from bunking.solver.constants import MAX_AGE_SPREAD_MONTHS, MAX_UNIQUE_GRADES_PER_BUNK
from pocketbase import PocketBase

if TYPE_CHECKING:
    from bunking.sync.bunk_request_processor.data.data_access_context import (
        DataAccessContext,
    )

from ..conflict.conflict_detector import ConflictDetector
from ..core.constants import CONFIDENCE_THRESHOLDS
from ..core.models import (
    AgePreference,
    BunkRequest,
    ParsedRequest,
    ParseRequest,
    ParseResult,
    RequestStatus,
    RequestType,
)
from ..data.cache import CacheManager, CacheMonitor
from ..data.cache.temporal_name_cache import TemporalNameCache
from ..data.repositories.attendee_repository import AttendeeRepository
from ..data.repositories.person_repository import PersonRepository
from ..data.repositories.request_repository import RequestRepository
from ..data.repositories.session_repository import SessionRepository
from ..data.repositories.source_link_repository import SourceLinkRepository
from ..debug.trace_collector import NoOpTraceCollector, TraceCollector
from ..debug.trace_models import (
    CandidateTrace,
    ConflictDetectionTrace,
    DedupSaveTrace,
    DispositionTrace,
    FinalBunkRequestTrace,
    Phase2FinalResult,
    Phase2IntentTrace,
    Phase3IntentTrace,
    ReciprocalSignal,
    SelfReferenceSignal,
)
from ..integration.ai_service import AIServiceConfig
from ..integration.batch_processor import BatchProcessor
from ..integration.provider_factory import ProviderFactory
from ..name_resolution.filters.spread_filter import SpreadFilter
from ..processing.batch_signals import ResolvedRequest as BSResolvedRequest
from ..processing.batch_signals import detect_batch_signals
from ..processing.deduplicator import Deduplicator
from ..resolution.interfaces import ResolutionResult
from ..resolution.resolution_pipeline import ResolutionPipeline
from ..resolution.strategies.exact_match import ExactMatchStrategy
from ..resolution.strategies.fuzzy_match import FuzzyMatchStrategy
from ..resolution.strategies.phonetic_match import PhoneticMatchStrategy
from ..resolution.strategies.school_disambiguation import SchoolDisambiguationStrategy
from ..services.context_builder import ContextBuilder
from ..services.historical_verification_service import HistoricalVerificationService
from ..services.phase1_parse_service import Phase1ParseService
from ..services.phase2_resolution_service import Phase2ResolutionService
from ..services.phase3_disambiguation_service import Phase3DisambiguationService
from ..services.request_builder import RequestBuilder
from ..services.staff_name_detector import StaffNameDetector
from ..services.staff_note_parser import parse_multi_staff_notes
from ..shared.constants import (
    ALL_PROCESSING_FIELDS,
    NOTES_FIELDS,
    UNIT_NAMES,
    UNRESOLVED_ID_DEFAULT,
    UNRESOLVED_ID_MAX,
    UNRESOLVED_ID_MIN,
    VALID_AGE_TARGETS,
    SourceField,
    is_no_preference,
    strip_na_prefix,
)
from ..social.adapters import SocialGraphSignalsAdapter
from ..social.social_graph import SocialGraph
from ..validation.request_type_validator import validate_request_type_for_field
from ..validation.rules.self_reference import SelfReferenceRule
from .reconciliation import log_obr_reconciliation
from .target_enrollment_reconcile import run_target_reconcile_phase

logger = get_logger(__name__)


_TRACE_KEY_CACHE_SENTINEL = "_trace_key_cache"


def _get_trace_key(parse_result: ParseResult) -> str:
    """Extract the original_request_id trace key from a ParseResult.

    Uses V2 field_name directly as the _original_request_ids key.
    Returns empty string if mapping fails (e.g., CSV data without original_request_ids).

    Result is memoized on the ParseResult's metadata dict (#923) to avoid
    repeated dict lookups when multiple trace loops iterate the same results.
    """
    meta = parse_result.metadata
    cached = meta.get(_TRACE_KEY_CACHE_SENTINEL)
    if cached is not None:
        return str(cached)

    if parse_result.parse_request is None:
        result = ""
    else:
        field_name = parse_result.parse_request.field_name
        result = str(parse_result.parse_request.row_data.get("_original_request_ids", {}).get(field_name, ""))

    meta[_TRACE_KEY_CACHE_SENTINEL] = result
    return result


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
    hash_object = hashlib.md5(normalized.encode("utf-8"))  # noqa: S324 — deterministic seed, not security
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


def needs_phase3(rr: ResolutionResult) -> bool:
    """Return True if this resolution result should proceed to Phase 3 disambiguation.

    Age-preference requests are excluded — they are staff-reviewed, not AI-resolved.
    """
    return not rr.is_resolved and rr.method != RequestType.AGE_PREFERENCE.value


class RequestOrchestrator:
    """Main orchestrator for the three-phase bunk request processing.

    Integrates V1's proven components with V2's cleaner architecture:
    - Phase 1: AI Parse-Only (V1 prompts + BatchProcessor)
    - Phase 2: Local Resolution (V2 strategies + SocialGraphBuilder)
    - Phase 3: AI Disambiguation (V1 AI + minimal context)
    """

    def __init__(
        self,
        pb: PocketBase | None = None,
        year: int = 0,
        session_cm_ids: list[int] | None = None,
        ai_config: dict[str, Any] | None = None,
        data_context: DataAccessContext | None = None,
        debug: bool = False,
        trace_collector: TraceCollector | None = None,
    ):
        """Initialize the request orchestrator.

        Args:
            pb: PocketBase client (deprecated, use data_context instead)
            year: Current year for processing
            session_cm_ids: Optional list of session CM IDs to filter by
            ai_config: Optional AI configuration override
            data_context: DataAccessContext for repository access (preferred)
            debug: Enable verbose AI parse logging
            trace_collector: Pipeline trace collector for debug instrumentation.
                Defaults to NoOpTraceCollector (zero overhead) when None.

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

        # Debug mode for verbose AI parse logging
        self.debug = debug

        # Trace collector for pipeline debug instrumentation
        self.trace_collector: TraceCollector = trace_collector if trace_collector is not None else NoOpTraceCollector()

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
            "no_preference_only": 0,  # #943: subset of no_preference_skipped from BUNK_WITH only
            "na_only": 0,  # #943: "N/A" sole-content rows (distinct from na_prefix_stripped)
            "na_prefix_stripped": 0,
            # #943: top-level OBR -> BR reconciliation counters
            "obr_input": 0,
            "skipped_empty_field": 0,
            "ai_parse_requests": 0,
            "direct_mapped": 0,
            "pre_dedup_requests": 0,
            "hallucination_rejected": 0,
            "unit_name_rejected": 0,
            "status_resolved": 0,
            "status_pending": 0,
            "status_declined": 0,
            "type_bunk_with": 0,
            "type_not_bunk_with": 0,
            "type_age_preference": 0,
            "declined_cross_session": 0,
            "declined_not_attending": 0,
            "declined_not_enrolled": 0,
            "declined_other": 0,
            "ai_high_confidence": 0,
            "ai_manual_review": 0,
            "phase1_failed": 0,
            # Phase C bidirectional enrollment reconciliation (#1069, #1375)
            "target_declined_count": 0,
            "target_reopened_count": 0,
            "target_declined_errors": 0,
        }
        self._phase1_first_error: str | None = None

    def _load_ai_config(self) -> dict[str, Any]:
        """Load AI provider/model settings from env via ConfigLoader.

        Returns the env-derived blob (provider, api_key, model, etc.). PB-side
        AI config was retired in the AI Config (Unified) Phase 2 cleanup —
        confidence thresholds, name-matching, resolution scoring etc. are now
        module-level constants under `core/constants.py` and the resolution
        strategy modules.
        """
        loader = ConfigLoader.get_instance()
        return loader.get_ai_config()

    def _get_auto_resolve_threshold(self) -> float:
        """Get the confidence threshold for auto-resolving matches.

        Matches with confidence >= threshold are auto-resolved (status=RESOLVED).
        Matches with confidence < threshold stay PENDING for staff confirmation.
        """
        return float(CONFIDENCE_THRESHOLDS["resolved"])

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

        # Track declined reasons using the structured disposition_reason field
        if request.status == RequestStatus.DECLINED:
            reason = request.disposition_reason
            if reason == "session_mismatch":
                self._stats["declined_cross_session"] += 1
            elif reason == "target_not_attending":
                self._stats["declined_not_attending"] += 1
            elif reason == "target_not_enrolled":
                self._stats["declined_not_enrolled"] += 1
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

            # ADR 4: Temporal conflicts only occur in notes fields — skip for structured fields
            source_field = result.parse_request.field_name if result.parse_request else None
            if source_field is not None and source_field not in NOTES_FIELDS:
                kept_count += len(result.parsed_requests)
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

    def _validate_target_names_in_source(self, parse_results: list[ParseResult]) -> tuple[int, int]:
        """Validate that AI-returned target names appear in the source text.

        Catches two failure modes:
        1. AI hallucinating names from prompt examples (not in input text)
        2. AI returning unit/cabin names as person targets

        Runs after _validate_request_types() and _filter_temporal_conflicts(),
        before Phase 2 (local resolution).

        Modifies parse_results in place — invalid requests are filtered out.

        Args:
            parse_results: List of ParseResult objects from Phase 1

        Returns:
            Tuple of (kept_count, rejected_count)
        """
        kept_count = 0
        rejected_count = 0

        for result in parse_results:
            if not result.is_valid or not result.parsed_requests:
                continue

            source_text = ""
            if result.parse_request:
                source_text = result.parse_request.request_text.lower()
            # Strip punctuation for matching
            source_text_clean = re.sub(r"[^\w\s]", " ", source_text)

            validated_requests = []
            for parsed_req in result.parsed_requests:
                # Skip age_preference request types (target_name is None)
                if parsed_req.request_type == RequestType.AGE_PREFERENCE:
                    validated_requests.append(parsed_req)
                    kept_count += 1
                    continue

                # Skip if no target name
                if not parsed_req.target_name:
                    validated_requests.append(parsed_req)
                    kept_count += 1
                    continue

                target = parsed_req.target_name.strip()
                target_lower = target.lower()

                # Skip valid age target names (older, younger, unclear)
                if target_lower in VALID_AGE_TARGETS:
                    validated_requests.append(parsed_req)
                    kept_count += 1
                    continue

                # Reject unit/cabin names
                if target_lower in UNIT_NAMES:
                    logger.warning(f"Rejected unit name target '{target}' — this is a cabin unit, not a person")
                    self._stats["unit_name_rejected"] += 1
                    rejected_count += 1
                    continue

                # Check if any part of the name appears as a whole word in source
                name_parts = target_lower.split()
                source_words = source_text_clean.split()
                found = False

                for part in name_parts:
                    if len(part) > 1 and part in source_words:
                        found = True
                        break

                if found:
                    validated_requests.append(parsed_req)
                    kept_count += 1
                else:
                    logger.warning(
                        f"Rejected hallucinated target: "
                        f"requester={result.parse_request.requester_cm_id if result.parse_request else 'unknown'}, "
                        f"field={parsed_req.source_field}"
                    )
                    logger.debug(
                        f"Rejected hallucinated target '{target}' — "
                        f"not found in source text: "
                        f"'{result.parse_request.request_text if result.parse_request else ''}'"
                    )
                    self._stats["hallucination_rejected"] += 1
                    rejected_count += 1

            result.parsed_requests = validated_requests
            if not validated_requests and result.is_valid:
                result.is_valid = False

        return kept_count, rejected_count

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

        # Load person-session mapping and pass to resolution pipeline
        self._load_person_sessions()
        self.resolution_pipeline.set_person_sessions(self._person_sessions)

        logger.info(
            f"Initialized RequestOrchestrator for year {self.year}, "
            f"sessions {self.session_cm_ids} with AI provider {self.ai_config['provider']}"
        )

        # Log cache configuration
        if self.cache_monitor:
            logger.info("Cache monitoring enabled")

    def _init_cache_system(self) -> None:
        """Initialize cache manager and temporal name cache.

        Cache configuration (`ai.cache.*`) was a phantom dict-key path in the
        AI config — it was never seeded as a PB row, so `CacheManager` always
        ran with an empty config. Cache monitoring (`enable_monitoring`) was
        likewise never reachable. Both lookups removed in the AI Config Phase 2
        cleanup.
        """

        self.cache_manager = CacheManager({})
        self.cache_monitor: CacheMonitor | None = None

        # Create temporal name cache for O(1) name lookups
        # Initialized lazily before Phase 2 resolution
        self.temporal_name_cache = TemporalNameCache(self.pb, self.year)

    def _init_repositories(self) -> None:
        """Initialize data repositories."""
        self._attendee_repo = AttendeeRepository(self.pb)
        self._person_repo = PersonRepository(self.pb, name_cache=self.temporal_name_cache)

    def _init_ai_provider(self) -> None:
        """Initialize AI provider, context builder, and batch processor.

        `endpoint` was a phantom dict-key (`ai.endpoint` was never seeded);
        `base_url` always defaulted to None. Removed in the AI Config Phase 2
        cleanup. If a non-default OpenAI endpoint is needed in the future, add
        it as an env var, not a PB row.
        """
        # Create AI provider using factory
        provider_factory = ProviderFactory()
        ai_service_config = AIServiceConfig(
            provider=self.ai_config.get("provider", "openai"),
            api_key=self.ai_config.get("api_key"),
            model=self.ai_config.get("model", "gpt-4o-mini"),
            base_url=None,
            debug=self.debug,
        )
        self.ai_provider = provider_factory.create(ai_service_config)

        # Create context builder
        self.context_builder = ContextBuilder()

        # Create staff name detector for filtering staff/parent names from targets
        self.staff_name_detector = StaffNameDetector()

        # Create native V2 batch processor
        self.batch_processor = BatchProcessor(
            ai_provider=self.ai_provider,
            config={"batch_processing": self.ai_config.get("batch_processing", {})},
        )

    def _init_scoring_components(self) -> None:
        """Initialize conflict detector, social-graph signals, and spread filter.

        Both `conflict_detection.*` and `spread_validation.*` were AI Config
        Phase 2 cleanup targets:
        - `conflict_detection.*` was a phantom dict-key path — never seeded,
          ConflictDetector always ran with `{}`.
        - `spread_validation.enabled` was an always-on toggle — inline the True
          branch and always construct the filter. Pattern-matched from Cabin
          Capacity `mode`, Cabin Min Occupancy `enabled`, Grade Spread `mode`.
        """
        # Social graph signals will be linked after social graph init
        self.social_graph_signals: SocialGraphSignalsAdapter | None = None

        # Create native V2 conflict detector
        self.conflict_detector = ConflictDetector(
            config={},
            attendee_repo=self._attendee_repo,
            year=self.year,
        )

        # Spread filter is always constructed — bounded by the unified
        # solver-side constants.
        self.spread_filter = SpreadFilter(
            grade_spread=MAX_UNIQUE_GRADES_PER_BUNK,
            age_spread_months=MAX_AGE_SPREAD_MONTHS,
        )

    def _init_social_graph(self) -> None:
        """Initialize social graph service.

        The old `smart_local_resolution.enabled` toggle lived in the
        `smart_local_resolution` PB category — but `get_ai_config()` only ever
        loaded `category='ai'`, so the toggle was unreachable and always
        defaulted to True. Removed in the AI Config Phase 2 cleanup; the
        social graph is now always constructed. (The full
        `smart_local_resolution` PB category is queued for its own cleanup —
        runtime values are already hardcoded in `phase2_resolution_service.py`.)
        """
        # SocialGraph expects PocketBase - use the underlying client
        self.social_graph = SocialGraph(pb=self.pb, year=self.year, session_cm_ids=self.session_cm_ids)  # type: ignore[arg-type]

        # Create adapter that wraps SocialGraph for social signal lookups
        # Pass a getter so adapter always sees current _person_sessions
        signals_adapter = SocialGraphSignalsAdapter(
            self.social_graph, person_sessions_getter=lambda: self._person_sessions
        )
        # SocialGraphSignalsAdapter implements SocialGraphSignals interface via duck typing
        self.social_graph_signals = signals_adapter

    def _init_resolution_pipeline(self) -> None:
        """Initialize resolution pipeline with strategies.

        Strategies no longer take a `config` arg — confidence values are
        module-level constants on the strategy modules. Cleaned up in the
        AI Config Phase 2 cleanup.
        """

        self.resolution_pipeline = ResolutionPipeline(self._person_repo, self._attendee_repo)
        self.resolution_pipeline.add_strategy(ExactMatchStrategy(self._person_repo, self._attendee_repo))
        self.resolution_pipeline.add_strategy(FuzzyMatchStrategy(self._person_repo, self._attendee_repo))
        self.resolution_pipeline.add_strategy(PhoneticMatchStrategy(self._person_repo, self._attendee_repo))
        self.resolution_pipeline.add_strategy(SchoolDisambiguationStrategy(self._person_repo, self._attendee_repo))

        # Spread filter is always constructed — wire it in.
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
            staff_name_filter=self.is_staff_name,  # Filter detected staff names from resolution
            attendee_repository=self._attendee_repo,  # For prior bunkmate resolution
            person_repository=self._person_repo,  # For prior bunkmate name matching
        )

        self.phase3_service = Phase3DisambiguationService(
            ai_provider=self.ai_provider,
            context_builder=self.context_builder,
            batch_processor=self.batch_processor,
            spread_filter=self.spread_filter,
            cache_manager=self.cache_manager,
        )

    def _init_validation_components(self) -> None:
        """Initialize request repository and validation pipeline components."""
        self.request_repository = RequestRepository(self.pb)
        self.source_link_repository = SourceLinkRepository(self.pb)
        self.self_reference_rule = SelfReferenceRule()
        self.deduplicator = Deduplicator()
        # Create request builder for constructing BunkRequest objects
        self.request_builder = RequestBuilder(
            temporal_name_cache=self.temporal_name_cache,
            year=self.year,
            auto_resolve_threshold=self._get_auto_resolve_threshold(),
        )

    def _init_extracted_services(self) -> None:
        """Initialize services extracted from orchestrator for reduced complexity.

        These services encapsulate specific orchestrator functionality:
        - HistoricalVerificationService: Verifies historical bunking groups
        """
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

        # #943: capture OBR input count for the end-of-pipeline reconciliation log
        self._stats["obr_input"] = len(raw_requests)

        # First pass: detect staff names from all records BEFORE processing
        # This builds a global set for filtering during resolution
        self._detect_staff_names(raw_requests)

        # Clear existing if requested
        if clear_existing:
            await self._clear_existing_requests(raw_requests)

        # Convert raw requests to ParseRequest objects
        parse_requests, pre_parsed_results = await self._prepare_parse_requests(raw_requests)

        return await self._execute_pipeline(
            parse_requests=parse_requests,
            pre_parsed_results=pre_parsed_results,
            progress_callback=progress_callback,
        )

    async def process_from_parse_requests(
        self,
        parse_requests: list[ParseRequest],
        stop_at_phase: str | None = None,
        dry_run: bool = True,
    ) -> dict[str, Any]:
        """Run the pipeline from pre-prepared ParseRequest objects (debug use).

        Called by PhaseRunner for full debug traces. Skips raw-request preparation
        and database clearing; starts directly at Phase 1 parse.

        Args:
            parse_requests: Pre-prepared ParseRequest objects to run through the pipeline.
            stop_at_phase: If set, stop after this phase (e.g. "phase1", "phase2").
                Downstream phases will not execute. None runs all phases.
            dry_run: If True (default), skip writing bunk requests to the database.

        Returns:
            Dict with pipeline results and dry_run flag.
        """
        return await self._execute_pipeline(
            parse_requests=parse_requests,
            pre_parsed_results=[],
            stop_at_phase=stop_at_phase,
            dry_run=dry_run,
        )

    async def run_historical_verification(
        self,
        resolution_results: list[tuple[ParseResult, list[ResolutionResult]]],
    ) -> list[tuple[ParseResult, list[ResolutionResult]]]:
        """Phase 2.5: Historical Group Verification.

        Snapshots pre-verification confidences, runs the verification service,
        and records per-request trace events (boost applied, original and boosted
        confidences). Shared by the full pipeline and PhaseRunner debug cascades
        so both paths produce identical traces and confidence values.

        Boosts confidence by +0.10 (capped at 0.95) for targets verified to have
        been in the same bunk in a prior year.

        Args:
            resolution_results: Phase 2 output (parse result + candidate list pairs).
                An empty list is a no-op (returns immediately with no side effects).

        Returns:
            Resolution results with historical boosts applied.
        """
        logger.info("=== Phase 2.5: Historical Group Verification ===")

        # Snapshot confidence values before historical verification for trace comparison.
        # Skipped in production (NoOpTraceCollector) to avoid per-request iteration (#923).
        pre_historical_confidences: dict[str, list[float]] = {}
        if self.trace_collector.enabled:
            for pr, res_list in resolution_results:
                trace_key = _get_trace_key(pr)
                if trace_key:
                    pre_historical_confidences[trace_key] = [rr.confidence for rr in res_list]

        verified_results = await self.historical_verification_service.verify(resolution_results)

        # --- Trace: Historical verification results ---
        if self.trace_collector.enabled:
            for pr, res_list in verified_results:
                trace_key = _get_trace_key(pr)
                if not trace_key:
                    continue
                boost_applied = any(rr.metadata and rr.metadata.get("historical_verified") is True for rr in res_list)
                pre_confs = pre_historical_confidences.get(trace_key, [])
                original_conf = max(pre_confs) if pre_confs else None
                boosted_conf = max(rr.confidence for rr in res_list) if res_list else None
                self.trace_collector.record_historical(
                    key=trace_key,
                    ran=True,
                    boost_applied=boost_applied,
                    original_confidence=original_conf if boost_applied else None,
                    boosted_confidence=boosted_conf if boost_applied else None,
                )

        return verified_results

    async def _execute_pipeline(
        self,
        parse_requests: list[ParseRequest],
        pre_parsed_results: list[ParseResult],
        stop_at_phase: str | None = None,
        dry_run: bool = False,
        progress_callback: Callable[..., Any] | None = None,
    ) -> dict[str, Any]:
        """Run all pipeline phases with trace recording.

        Shared implementation for process_requests and process_from_parse_requests.

        Args:
            parse_requests: ParseRequest objects to process through Phase 1.
            pre_parsed_results: ParseResult objects already parsed (skips Phase 1 AI).
            stop_at_phase: If set, stop after this phase. None runs all phases.
            dry_run: If True, skip writing bunk requests to the database.
            progress_callback: Optional callback for progress updates.

        Returns:
            Dict with pipeline results and statistics.
        """
        valid_stop_phases = {
            None,
            "pre_phase1",
            "phase1",
            "validation",
            "phase2",
            "historical",
            "phase3",
            "post_pipeline",
        }
        if stop_at_phase not in valid_stop_phases:
            raise ValueError(f"Unknown stop_at_phase '{stop_at_phase}'")

        if stop_at_phase == "pre_phase1":
            return {"dry_run": dry_run, "phase": "pre_phase1"}

        # Phase 1: AI Parse-Only (skip if no requests need AI)
        if parse_requests:
            logger.info(f"=== Phase 1: AI Parse-Only ({len(parse_requests)} requests) ===")
            ai_parse_results = await self.phase1_service.batch_parse(parse_requests, progress_callback)
        else:
            logger.info("=== Phase 1: Skipped (no AI parsing needed) ===")
            ai_parse_results = []

        # Join phase1 service failure stats into orchestrator stats
        phase1_stats = self.phase1_service.get_stats()
        self._stats["phase1_failed"] = phase1_stats["failed_parses"]
        self._stats["phase1_successful"] = phase1_stats["successful_parses"]
        self._phase1_first_error = phase1_stats.get("first_failure_reason")

        # Combine AI-parsed and pre-parsed results
        parse_results = ai_parse_results + pre_parsed_results
        self._stats["phase1_parsed"] = len([r for r in parse_results if r.is_valid])

        # Log pre-parsed stats
        if pre_parsed_results:
            logger.info(f"Pre-parsed {len(pre_parsed_results)} requests without AI (e.g., socialize preferences)")

        # --- Trace: Phase 1 results ---
        # Skipped under NoOpTraceCollector (#923) — avoids per-request dict builds.
        if self.trace_collector.enabled:
            pre_parsed_ids = {id(r) for r in pre_parsed_results}
            for pr in parse_results:
                trace_key = _get_trace_key(pr)
                if not trace_key:
                    continue
                ran = id(pr) not in pre_parsed_ids  # AI-parsed vs pre-parsed
                parsed_intents = [
                    {
                        "target_name": req.target_name or "",
                        "request_type": req.request_type.value if req.request_type else "",
                        "confidence": req.confidence,
                        "keywords_found": req.metadata.get("keywords_found", []) if req.metadata else [],
                        "reasoning": req.metadata.get("reasoning", "") if req.metadata else "",
                        "parse_notes": req.metadata.get("parse_notes", "") if req.metadata else "",
                        "csv_position": req.csv_position,
                    }
                    for req in pr.parsed_requests
                ]
                pr_meta = pr.metadata or {}
                security_meta = pr_meta.get("security_metadata") or {}
                sanitization_info = (
                    {
                        "is_suspicious": security_meta.get("is_suspicious", False),
                        "risk_level": security_meta.get("risk_level"),
                        "confidence_penalty": security_meta.get("confidence_penalty", 0.0),
                    }
                    if security_meta
                    else None
                )
                self.trace_collector.record_phase1(
                    key=trace_key,
                    ran=ran,
                    parsed_intents=parsed_intents,
                    is_valid=pr.is_valid,
                    error_message=pr_meta.get("failure_reason"),
                    token_count=pr_meta.get("token_count"),
                    processing_time_ms=pr_meta.get("processing_time_ms"),
                    ai_raw_response=pr_meta.get("ai_raw_response"),
                    ai_reasoning_summary=pr_meta.get("ai_reasoning_summary"),
                    sanitization=sanitization_info,
                    parse_request={"field_name": pr.parse_request.field_name} if pr.parse_request else {},
                )

        if stop_at_phase == "phase1":
            return {"dry_run": dry_run, "phase": "phase1"}

        # This catches AI errors where wrong request type is returned for strict fields
        validated_count, rejected_count = self._validate_request_types(parse_results)
        if rejected_count > 0:
            logger.info(f"Validated {validated_count} requests, rejected {rejected_count} invalid")

        # Filter temporal conflicts (e.g., "6/4 separate | 6/5 together" keeps only most recent)
        kept_count, conflict_filtered = self._filter_temporal_conflicts(parse_results)
        if conflict_filtered > 0:
            logger.info(f"Temporal conflict filter: kept {kept_count} requests, filtered {conflict_filtered} stale")

        # Validate target names appear in source text (catches AI hallucinations and unit names)
        source_kept, source_rejected = self._validate_target_names_in_source(parse_results)
        if source_rejected > 0:
            logger.info(
                f"Source text validation: kept {source_kept}, "
                f"rejected {source_rejected} "
                f"(hallucinated={self._stats.get('hallucination_rejected', 0)}, "
                f"unit_names={self._stats.get('unit_name_rejected', 0)})"
            )

        # --- Trace: Validation results ---
        # Gated on trace_collector.enabled to skip per-request trace work in prod (#923).
        if self.trace_collector.enabled:
            for pr in parse_results:
                trace_key = _get_trace_key(pr)
                if not trace_key:
                    continue
                self.trace_collector.record_validation(
                    key=trace_key,
                    type_validation={"passed": pr.is_valid, "rejected": []},
                    temporal_conflicts={
                        "batch_filtered": conflict_filtered,
                        "details": [],
                        "note": "batch-level aggregate, not per-request",
                    },
                    source_text_validation={
                        "batch_rejected": source_rejected,
                        "hallucinated_names": [],
                        "unit_names": [],
                        "note": "batch-level aggregate, not per-request",
                    },
                )

        if stop_at_phase == "validation":
            return {"dry_run": dry_run, "phase": "validation"}

        # Initialize temporal name cache before Phase 2
        logger.info("=== Initializing Temporal Name Cache ===")
        self.temporal_name_cache.initialize()  # Sync - PocketBase SDK is synchronous
        cache_stats = self.temporal_name_cache.get_stats()
        logger.info(f"Cache ready: {cache_stats['persons_loaded']} persons, {cache_stats['unique_names']} name keys")

        # Initialize social graph between Phase 1 and Phase 2 — needed for
        # confidence scoring and resolution. Always-on since the AI Config
        # Phase 2 cleanup removed the unreachable smart_local_resolution
        # toggle.
        if self.social_graph:
            logger.info("=== Initializing Social Graph ===")
            await self.social_graph.initialize()

        # Phase 2: Local Resolution
        logger.info("=== Phase 2: Local Resolution ===")
        resolution_results = await self.phase2_service.batch_resolve(parse_results)

        # --- Trace: Phase 2 results ---
        # Gated on trace_collector.enabled — candidate_factors dict construction
        # is pure overhead under NoOpTraceCollector (#923).
        if self.trace_collector.enabled:
            for pr, res_list in resolution_results:
                trace_key = _get_trace_key(pr)
                if not trace_key:
                    continue
                for intent_idx, rr in enumerate(res_list):
                    rr_meta = rr.metadata or {}
                    candidate_factors: dict[int, dict[str, float]] = rr_meta.get("candidate_factors", {})
                    candidates_trace = [
                        CandidateTrace(
                            person_cm_id=c.cm_id,
                            name=c.full_name if hasattr(c, "full_name") else f"{c.first_name} {c.last_name}",
                            session_cm_id=c.session_cm_id,
                            grade=c.grade,
                            school=c.school,
                            score_breakdown=candidate_factors.get(c.cm_id, {}),
                        )
                        for c in (rr.candidates or [])
                    ]
                    winning_factors: dict[str, float] = (
                        candidate_factors.get(rr.person.cm_id, {}) if rr.person and candidate_factors else {}
                    )
                    self.trace_collector.record_phase2(
                        key=trace_key,
                        intent_idx=intent_idx,
                        intent_trace=Phase2IntentTrace(
                            target_name=rr.target_name or "",
                            all_candidates=candidates_trace,
                            pipeline_strategies_tried=list(rr_meta.get("pipeline_strategies_tried", [])),
                            staff_filtered=rr.method == "staff_filtered",
                            hallucination_detected=bool(rr_meta.get("below_threshold")),
                            final_result=Phase2FinalResult(
                                person_cm_id=rr.person.cm_id if rr.person else None,
                                person_name=rr.person.full_name if rr.person else None,
                                confidence=rr.confidence,
                                method=rr.method,
                                is_resolved=rr.is_resolved,
                                is_ambiguous=rr.is_ambiguous,
                                confidence_factors=winning_factors,
                            ),
                        ),
                    )

        if stop_at_phase == "phase2":
            return {"dry_run": dry_run, "phase": "phase2"}

        resolution_results = await self.run_historical_verification(resolution_results)

        if stop_at_phase == "historical":
            return {"dry_run": dry_run, "phase": "historical"}

        # Count Phase 2 results
        for _, resolution_list in resolution_results:
            for res_result in resolution_list:
                if res_result.is_resolved:
                    self._stats["phase2_resolved"] += 1
                elif res_result.is_ambiguous:
                    self._stats["phase2_ambiguous"] += 1

        # Snapshot confidence values before Phase 3 (after historical verification).
        # Skipped under NoOpTraceCollector to avoid per-request iteration (#923).
        pre_phase3_confidences: dict[str, list[float]] = {}
        if self.trace_collector.enabled:
            for pr, res_list in resolution_results:
                trace_key = _get_trace_key(pr)
                if trace_key:
                    pre_phase3_confidences[trace_key] = [rr.confidence for rr in res_list]

        # Phase 3: AI Disambiguation (for unresolved cases)
        unresolved_cases = []
        unresolved_indices = []
        phase3_processed = set()  # Track which indices went through Phase 3

        # Debug logging for Phase 3 decision
        total_unresolved = 0
        for idx, (pr, resolution_list) in enumerate(resolution_results):
            unresolved_in_this = sum(1 for rr in resolution_list if needs_phase3(rr))
            if unresolved_in_this > 0:
                total_unresolved += unresolved_in_this
                logger.debug(f"ParseResult {idx} has {unresolved_in_this} unresolved requests")

        logger.info(
            f"Phase 3 check: Found {total_unresolved} total unresolved requests across {len(resolution_results)} ParseResults"
        )

        for idx, (pr, resolution_list) in enumerate(resolution_results):
            # Check if any resolutions in this ParseResult are unresolved
            # Skip pre-parsed requests (like age preferences from dropdowns)
            has_unresolved = any(needs_phase3(rr) for rr in resolution_list)
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

        # --- Batch Signal Detection (reciprocal + household co-request) ---
        batch_requests = []
        for pr, resolution_list in resolution_results:
            if not pr.parsed_requests or not pr.parse_request:
                continue
            requester_person = (
                self.temporal_name_cache.get_person(pr.parse_request.requester_cm_id)
                if self.temporal_name_cache
                else None
            )
            requester_household_id = requester_person.household_id if requester_person else None
            for rr_idx, rr in enumerate(resolution_list):
                if rr.is_resolved and rr.person:
                    req_type = RequestType.BUNK_WITH
                    if rr_idx < len(pr.parsed_requests):
                        req_type = pr.parsed_requests[rr_idx].request_type
                    batch_requests.append(
                        BSResolvedRequest(
                            requester_cm_id=pr.parse_request.requester_cm_id,
                            target_cm_id=rr.person.cm_id,
                            request_type=req_type,
                            session_cm_id=pr.parse_request.session_cm_id,
                            household_id=requester_household_id,
                        )
                    )

        batch_signals = detect_batch_signals(batch_requests)

        # Annotate resolution results with batch signals
        for pr, resolution_list in resolution_results:
            if not pr.parse_request:
                continue
            for rr in resolution_list:
                if rr.is_resolved and rr.person:
                    key = (pr.parse_request.requester_cm_id, rr.person.cm_id, pr.parse_request.session_cm_id)
                    if key in batch_signals:
                        if rr.metadata is None:
                            rr.metadata = {}
                        rr.metadata["is_reciprocal"] = batch_signals[key].is_reciprocal
                        rr.metadata["reciprocal_with"] = batch_signals[key].reciprocal_with
                        rr.metadata["household_co_request"] = batch_signals[key].household_co_request

        self._stats["reciprocal_pairs"] = sum(1 for s in batch_signals.values() if s.is_reciprocal) // 2

        # --- Trace: Phase 3 results ---
        # Gated on trace_collector.enabled — the ranked_lookup dict and
        # per-candidate trace construction are pure overhead in production (#923).
        if self.trace_collector.enabled:
            for idx, (pr, res_list) in enumerate(resolution_results):
                trace_key = _get_trace_key(pr)
                if not trace_key:
                    continue
                ran_phase3 = idx in phase3_processed
                pre_confs = pre_phase3_confidences.get(trace_key, [])
                for intent_idx, rr in enumerate(res_list):
                    rr_meta = rr.metadata or {}
                    # Build candidates sent to AI from the ResolutionResult's candidate list
                    ranked_sel = rr_meta.get("ranked_selections") or []
                    ranked_lookup: dict[int, float] = {
                        s["person_id"]: s["confidence"]
                        for s in ranked_sel
                        if isinstance(s, dict) and "person_id" in s and "confidence" in s
                    }
                    candidates_sent = (
                        [
                            {
                                "person_cm_id": c.cm_id,
                                "name": c.full_name if hasattr(c, "full_name") else f"{c.first_name} {c.last_name}",
                                **({"grade": c.grade} if hasattr(c, "grade") and c.grade is not None else {}),
                                **({"ai_confidence": ranked_lookup[c.cm_id]} if c.cm_id in ranked_lookup else {}),
                            }
                            for c in (rr.candidates or [])
                        ]
                        if ran_phase3
                        else []
                    )
                    # Phase 3 metadata: ai_confidence, reason, candidates_considered
                    ai_reasoning = rr_meta.get("reason")
                    confidence_before = pre_confs[intent_idx] if intent_idx < len(pre_confs) else None
                    self.trace_collector.record_phase3(
                        key=trace_key,
                        intent_idx=intent_idx,
                        intent_trace=Phase3IntentTrace(
                            target_name=rr.target_name or "",
                            ran=ran_phase3,
                            candidates_sent=candidates_sent,
                            ai_reasoning=ai_reasoning,
                            confidence_before=confidence_before,
                            result=(
                                "resolved"
                                if rr.is_resolved
                                else (
                                    "not_needed"
                                    if not ran_phase3
                                    else rr_meta.get("disambiguation_status", "still_ambiguous")
                                )
                            ),
                            confidence_after=rr.confidence,
                            reranked=rr_meta.get("reranked", False),
                            jw_score=rr_meta.get("jw_score"),
                            ai_confidence=rr_meta.get("ai_confidence"),
                            no_match_signal=(
                                rr_meta.get("disambiguation_status") == "no_match" if ran_phase3 else False
                            ),
                        ),
                    )

        if stop_at_phase == "phase3":
            return {"dry_run": dry_run, "phase": "phase3"}

        # Convert to request format for conflict detection
        resolved_requests = self._prepare_for_conflict_detection(resolution_results)

        # Detect conflicts
        logger.info("=== Conflict Detection ===")
        conflict_result = self.conflict_detector.detect_conflicts(resolved_requests)
        self._stats["conflicts_detected"] = len(conflict_result.conflicts)

        if conflict_result.has_conflicts:
            logger.info(self.conflict_detector.get_conflict_summary(conflict_result))

        # Always apply — even without conflicts, this annotates pending enrollment (waitlisted targets)
        resolved_requests = self.conflict_detector.apply_conflict_resolution(resolved_requests, conflict_result)

        # Create bunk requests (skipped in dry_run mode)
        deduped_keys: set[tuple[int, int | None, str]] = set()
        if dry_run:
            logger.info("=== Skipping Bunk Request Creation (dry_run=True) ===")
            created_requests: list[Any] = []
        else:
            logger.info("=== Creating Bunk Requests ===")
            created_requests, deduped_keys = await self._create_bunk_requests(resolved_requests)
        self._stats["requests_created"] = len(created_requests)

        # --- Trace: Post-Pipeline results ---
        # Entire block is gated on trace_collector.enabled — building the
        # created_by_key map and the per-intent final_bunk_requests list is
        # wasted work under NoOpTraceCollector (#923).
        if not self.trace_collector.enabled:
            resolution_results_for_trace: list[Any] = []
        else:
            resolution_results_for_trace = list(resolution_results)

        # Build a map from (requester_cm_id, requested_cm_id, target_name) to created BunkRequest for trace linking
        # Key includes requested_cm_id to avoid collisions when different targets share the same name (#788)
        created_by_key: dict[tuple[int, int | None, str], Any] = {}
        if self.trace_collector.enabled:
            for req in created_requests:
                req_key = (req.requester_cm_id, req.requested_cm_id, getattr(req, "requested_name", "") or "")
                created_by_key.setdefault(req_key, req)

        for pr, res_list in resolution_results_for_trace:
            trace_key = _get_trace_key(pr)
            if not trace_key:
                continue
            requester_cm_id = pr.parse_request.requester_cm_id if pr.parse_request else 0
            final_bunk_requests = []
            # Track post-pipeline enrichments across all intents for this trace
            any_self_ref = False
            any_reciprocal = False
            reciprocal_pair_cm_id: int | None = None
            any_dedup = False
            for req_idx, (parsed_req, rr) in enumerate(zip(pr.parsed_requests, res_list, strict=False)):
                # Find the matching created BunkRequest (if any)
                target_name = parsed_req.target_name or ""
                resolved_cm_id = rr.person.cm_id if rr.person else None
                matched_br = created_by_key.get((requester_cm_id, resolved_cm_id, target_name))
                br_meta = matched_br.metadata if matched_br and hasattr(matched_br, "metadata") else {}
                br_meta = br_meta or {}

                # Detect post-pipeline flags from BunkRequest metadata
                if br_meta.get("self_referential"):
                    any_self_ref = True
                if br_meta.get("is_reciprocal"):
                    any_reciprocal = True
                    reciprocal_pair_cm_id = matched_br.requested_cm_id if matched_br else None

                # Check if this request was removed by deduplication
                # Key includes requested_cm_id to avoid collisions when different targets share the
                # same name (#788) — without it, a surviving request could be marked as DEDUPED
                resolved_name = rr.person.full_name if rr.person and hasattr(rr.person, "full_name") else target_name
                is_deduped = (requester_cm_id, resolved_cm_id, resolved_name or "") in deduped_keys
                if is_deduped:
                    any_dedup = True

                # Determine final status from BunkRequest if available
                # Always UPPERCASE for debug traces (bunk_requests.status is lowercase,
                # but debug_pipeline_summary.final_status uses UPPERCASE by convention)
                if is_deduped:
                    final_status = "DEDUPED"
                    final_confidence = rr.confidence
                elif matched_br:
                    final_status = "RESOLVED" if rr.is_resolved else "PENDING"
                    final_confidence = rr.confidence
                    if hasattr(matched_br, "status") and matched_br.status:
                        raw_status = (
                            matched_br.status.value if hasattr(matched_br.status, "value") else str(matched_br.status)
                        )
                        final_status = raw_status.upper()
                    if hasattr(matched_br, "confidence_score"):
                        final_confidence = matched_br.confidence_score
                else:
                    final_status = "RESOLVED" if rr.is_resolved else "PENDING"
                    final_confidence = rr.confidence

                # Dual-source pattern: is_reciprocal and disposition_reason appear together
                # on the trace but originate from different pipeline stages:
                #   - is_reciprocal: detection signal from batch_signals.detect_batch_signals(),
                #     stored in BunkRequest.metadata JSON. It's an INPUT to disposition rules.
                #   - disposition_reason: business decision OUTPUT from disposition_rules.determine_disposition(),
                #     stored as a dedicated BunkRequest DB column.
                # A request can be is_reciprocal=True with disposition_reason="target_not_enrolled"
                # when the reciprocal signal was detected but a business gate overrode it.
                final_bunk_requests.append(
                    FinalBunkRequestTrace(
                        bunk_request_id=getattr(matched_br, "id", None) if matched_br else None,
                        requester_cm_id=requester_cm_id,
                        requested_cm_id=rr.person.cm_id if rr.person else None,
                        requested_name=target_name,
                        request_type=parsed_req.request_type.value if parsed_req.request_type else "",
                        status=final_status,
                        confidence=final_confidence,
                        is_first_requested=bool(getattr(matched_br, "is_first_requested", False))
                        if matched_br
                        else False,
                        resolution_method=rr.method,
                        declined_reason=br_meta.get("declined_reason"),
                        disposition_reason=getattr(matched_br, "disposition_reason", "") if matched_br else "",
                        is_reciprocal=bool(br_meta.get("is_reciprocal", False)),
                    )
                )
            # Filter conflicts relevant to this requester's targets
            target_cm_ids = {rr.person.cm_id for _, rr in zip(pr.parsed_requests, res_list, strict=False) if rr.person}
            relevant_conflicts = [
                c
                for c in conflict_result.conflicts
                if c.person_a_cm_id == requester_cm_id
                or c.person_b_cm_id == requester_cm_id
                or c.person_a_cm_id in target_cm_ids
                or c.person_b_cm_id in target_cm_ids
            ]
            # Flattened post-pipeline trace (issue #877): each of the four
            # finalization stages owns its own typed trace. `self_reference`
            # lives on dedup_save (matches the UI's DedupDetail panel), NOT on
            # batch_signals.
            self.trace_collector.record_batch_signals(
                key=trace_key,
                reciprocal=ReciprocalSignal(
                    detected=any_reciprocal,
                    pair_cm_id=reciprocal_pair_cm_id,
                ),
            )
            self.trace_collector.record_conflict_detection(
                key=trace_key,
                conflict_detection=ConflictDetectionTrace(
                    has_conflict=len(relevant_conflicts) > 0,
                    details=[
                        {
                            "conflict_type": c.conflict_type.value,
                            "person_a_cm_id": c.person_a_cm_id,
                            "person_b_cm_id": c.person_b_cm_id,
                            "description": c.description,
                            "severity": c.severity,
                            "auto_resolvable": c.auto_resolvable,
                        }
                        for c in relevant_conflicts
                    ],
                ),
            )
            self.trace_collector.record_disposition(
                key=trace_key,
                disposition=DispositionTrace(final_bunk_requests=final_bunk_requests),
            )
            self.trace_collector.record_dedup_save(
                key=trace_key,
                dedup_save=DedupSaveTrace(
                    was_duplicate=any_dedup,
                    kept_over=None,
                    self_reference=SelfReferenceSignal(detected=any_self_ref),
                ),
            )

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
                    f"not_enrolled={self._stats['declined_not_enrolled']}, "
                    f"other={self._stats['declined_other']}"
                )
            logger.info(
                f"AI quality: "
                f"high_confidence={self._stats['ai_high_confidence']}, "
                f"manual_review={self._stats['ai_manual_review']}"
            )

        # #943: emit a single top-level OBR -> BR reconciliation line so the
        # full pipeline math is verifiable from the log alone.
        log_obr_reconciliation(self._stats)

        # Phase C (#1069, #1375): bidirectional enrollment reconciliation.
        # Forward: sweep non-declined BRs whose requestee is no longer attending
        # or now in a different session → decline in place.
        # Reverse: sweep eligible declined BRs whose target is now actively
        # enrolled in the BR's session → reopen with disposition_reason=
        # "enrollment_change". Sidecar: usually empty, never fails the pipeline.
        # Skipped under dry_run since it issues real writes.
        if dry_run:
            logger.info("=== Skipping Phase C target-reconcile (dry_run=True) ===")
        else:
            try:
                target_reconcile_stats = run_target_reconcile_phase(self.pb, self.year)
                self._stats["target_declined_count"] = target_reconcile_stats.get("declined_count", 0)
                self._stats["target_reopened_count"] = target_reconcile_stats.get("reopened_count", 0)
                self._stats["target_declined_errors"] = target_reconcile_stats.get("error_count", 0)
            except Exception:
                logger.exception("target_reconcile phase raised; continuing")
                self._stats["target_declined_errors"] = 1
                self._stats["target_reopened_count"] = 0
            logger.info(
                f"Phase C target-reconcile: "
                f"declined={self._stats['target_declined_count']}, "
                f"reopened={self._stats['target_reopened_count']}, "
                f"errors={self._stats['target_declined_errors']}"
            )

        # Log cache statistics if monitor is available
        if self.cache_monitor:
            self.cache_monitor.log_statistics()
            self.cache_monitor.log_cache_recommendation()

        # Merge phase1_first_error into stats (kept separate for type safety)
        stats: dict[str, Any] = dict(self._stats)
        stats["phase1_first_error"] = self._phase1_first_error

        return {
            "success": True,
            "requests_created": created_requests,
            "statistics": stats,
            "conflicts": conflict_result.conflicts if conflict_result.has_conflicts else [],
        }

    def _parse_socialize_preference(self, value: str) -> ParsedRequest | None:
        """Parse the socialize_with field directly without AI.

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
            source_field=SourceField.SOCIALIZE_WITH,
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

        Includes FC content filtering for bunking_notes and internal_notes
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
            # Common per-row params (hoisted out of inner loop — same for every field)
            requester_cm_id = int(row.get("requester_cm_id", row.get("PersonID", 0)))
            first_name = row.get("first_name", row.get("First", ""))
            last_name = row.get("last_name", row.get("Last", ""))
            requester_name = f"{first_name} {last_name}".strip()
            requester_grade = str(row.get("Grade", 0))

            # Extract request texts from various fields (defined in constants.py)
            for field_name in ALL_PROCESSING_FIELDS:
                total_fields_checked += 1
                request_text = row.get(field_name, "").strip()

                # Resolve trace key: V2 field name directly in _original_request_ids
                trace_key = row.get("_original_request_ids", {}).get(field_name, "")

                if not request_text:
                    skipped_no_text += 1
                    if trace_key:
                        self.trace_collector.record_pre_phase1(
                            key=trace_key,
                            action="skipped_empty",
                            original_text="",
                            requester_cm_id=requester_cm_id,
                            year=self.year,
                            session_cm_id=0,
                            source_field=field_name,
                            skip_reason="empty_text",
                            requester_name=requester_name,
                            requester_grade=requester_grade,
                        )
                    continue

                # Track original text before any modifications
                original_text = request_text
                na_stripped = False

                # ADR 5: NA/no-preference stripping only applies to bunk_with field
                if field_name == SourceField.BUNK_REQUEST_FORM:
                    # Check for "no preference" indicators before processing
                    if self._is_no_preference(request_text):
                        self._stats["no_preference_skipped"] += 1
                        self._stats["no_preference_only"] += 1  # #943: split out NA-only
                        if trace_key:
                            self.trace_collector.record_pre_phase1(
                                key=trace_key,
                                action="skipped_no_preference",
                                original_text=original_text,
                                requester_cm_id=requester_cm_id,
                                year=self.year,
                                session_cm_id=0,
                                source_field=field_name,
                                skip_reason="no_preference",
                                requester_name=requester_name,
                                requester_grade=requester_grade,
                            )
                        continue

                    # Strip N/A prefix if present (e.g., "N/A; their grade" -> "their grade")
                    stripped = strip_na_prefix(request_text)
                    if stripped is not None:
                        logger.debug(f"Stripped N/A prefix: '{request_text}' -> '{stripped}'")
                        self._stats["na_prefix_stripped"] += 1
                        request_text = stripped
                        na_stripped = True
                    elif re.match(r"^n/?a[\s\W]*$", request_text, re.IGNORECASE):
                        # N/A with only punctuation/whitespace after (e.g., "N/A -", "NA.")
                        self._stats["no_preference_skipped"] += 1
                        self._stats["na_only"] += 1  # #943: split out from no_preference
                        if trace_key:
                            self.trace_collector.record_pre_phase1(
                                key=trace_key,
                                action="skipped_na_only",
                                original_text=original_text,
                                requester_cm_id=requester_cm_id,
                                year=self.year,
                                session_cm_id=0,
                                source_field=field_name,
                                skip_reason="na_only",
                                requester_name=requester_name,
                                requester_grade=requester_grade,
                            )
                        continue

                # Extract staff signatures from bunking_notes before AI parsing
                # bunking_notes has STAFFNAME (DATETIME) patterns; internal_notes does not
                staff_metadata = None
                if field_name == SourceField.BUNKING_NOTES:
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
                        if trace_key:
                            self.trace_collector.record_pre_phase1(
                                key=trace_key,
                                action="skipped_staff_signatures_only",
                                original_text=original_text,
                                requester_cm_id=requester_cm_id,
                                year=self.year,
                                session_cm_id=0,
                                source_field=field_name,
                                skip_reason="staff_signatures_only",
                                staff_metadata=staff_metadata,
                                requester_name=requester_name,
                                requester_grade=requester_grade,
                            )
                        continue

                # Look up sessions from person_sessions mapping
                person_sessions = self._person_sessions.get(requester_cm_id, [])
                if not person_sessions:
                    # Person not enrolled or not in filtered session
                    skipped_no_session += 1
                    logger.debug(f"Skipping request for person {requester_cm_id} - not enrolled")
                    if trace_key:
                        self.trace_collector.record_pre_phase1(
                            key=trace_key,
                            action="skipped_no_session",
                            original_text=original_text,
                            requester_cm_id=requester_cm_id,
                            year=self.year,
                            session_cm_id=0,
                            source_field=field_name,
                            skip_reason="not_enrolled",
                            cleaned_text=request_text,
                            na_prefix_stripped=na_stripped,
                            staff_metadata=staff_metadata,
                            requester_name=requester_name,
                            requester_grade=requester_grade,
                        )
                    continue

                # Use the first valid session for this person
                # TODO: In future, could match based on request context
                person_session_cm_id = person_sessions[0]

                # Handle socialize_with without AI (dropdown field)
                if field_name == SourceField.SOCIALIZE_WITH:
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

                        # Trace: direct mapped (socialize dropdown)
                        if trace_key:
                            self.trace_collector.record_pre_phase1(
                                key=trace_key,
                                action="direct_mapped",
                                original_text=original_text,
                                requester_cm_id=requester_cm_id,
                                year=self.year,
                                session_cm_id=person_session_cm_id,
                                source_field=field_name,
                                field_path="socialize_direct_map",
                                socialize_mapped_value=parsed_req.age_preference.value
                                if parsed_req.age_preference
                                else None,
                                session_cm_ids=person_sessions,
                                requester_name=requester_name,
                                requester_grade=requester_grade,
                            )

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

                # Trace: parsed (going to AI)
                if trace_key:
                    self.trace_collector.record_pre_phase1(
                        key=trace_key,
                        action="parsed",
                        original_text=original_text,
                        requester_cm_id=requester_cm_id,
                        year=self.year,
                        session_cm_id=person_session_cm_id,
                        source_field=field_name,
                        field_path="ai_parse",
                        cleaned_text=request_text,
                        na_prefix_stripped=na_stripped,
                        staff_metadata=staff_metadata,
                        session_cm_ids=person_sessions,
                        requester_name=requester_name,
                        requester_grade=requester_grade,
                    )

        # Diagnostic: Log summary
        logger.info(
            f"_prepare_parse_requests summary: "
            f"fields_checked={total_fields_checked}, "
            f"skipped_no_text={skipped_no_text}, "
            f"skipped_no_session={skipped_no_session}, "
            f"no_preference={self._stats.get('no_preference_skipped', 0)}, "
            f"na_prefix_stripped={self._stats.get('na_prefix_stripped', 0)}, "
            f"parse_requests={len(parse_requests)}, "
            f"pre_parsed={len(pre_parsed_results)}"
        )

        # #943: capture top-level reconciliation counters for the end-of-pipeline log
        self._stats["skipped_empty_field"] = skipped_no_text
        self._stats["ai_parse_requests"] = len(parse_requests)
        self._stats["direct_mapped"] = len(pre_parsed_results)

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
            bunking_notes = (req.get("bunking_notes") or "").strip()
            internal_notes = (req.get("internal_notes") or "").strip()
            combined = f"{bunking_notes} {internal_notes}".strip()
            if combined:
                notes_texts.append(combined)

        # Build global set of detected staff names (build_global_set logs internally)
        detected = self.staff_name_detector.build_global_set(notes_texts)
        self.staff_name_detector.detected_staff_names = detected

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
                    # Pass along resolution metadata (includes Phase 3 reasoning if applicable)
                    if resolution_result.metadata:
                        resolution_info["resolution_metadata"] = resolution_result.metadata
                    # Thread batch signals to request_builder
                    resolution_info["is_reciprocal"] = (
                        resolution_result.metadata.get("is_reciprocal", False) if resolution_result.metadata else False
                    )
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
        # V2: field names are used directly as source_field values

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
                if field_name in ALL_PROCESSING_FIELDS:
                    person_source_fields[person_id].add(field_name)

            # Method 2: Check which data fields are present in the row
            # This handles direct CSV processing
            for field_name in ALL_PROCESSING_FIELDS:
                if row.get(field_name):
                    person_source_fields[person_id].add(field_name)

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
    ) -> tuple[list[BunkRequest], set[tuple[int, int | None, str]]]:
        """Create bunk request records in the database.

        This method:
        1. Builds BunkRequest objects from resolved requests (via RequestBuilder)
        2. Applies the validation pipeline (self-ref, dedup, reciprocal)
        3. Persists validated requests to the database

        Returns:
            Tuple of (saved_requests, deduped_keys) where deduped_keys is a set of
            (requester_cm_id, requested_cm_id, requested_name) tuples for requests
            removed by dedup. Includes requested_cm_id to avoid trace key collisions
            when different targets share the same name (#788).
        """
        # Build BunkRequest objects using the request builder
        pending_requests = self.request_builder.build_requests(resolved_requests)

        # #943: capture pre-dedup count for the end-of-pipeline reconciliation log
        self._stats["pre_dedup_requests"] = len(pending_requests)

        # Apply validation pipeline to all requests
        deduped_keys: set[tuple[int, int | None, str]] = set()
        if pending_requests:
            logger.info(f"=== Applying Validation Pipeline to {len(pending_requests)} requests ===")
            validated_requests, deduped_keys = self._apply_validation_pipeline(pending_requests)
        else:
            validated_requests = []

        # Save validated requests to database
        return self._save_bunk_requests(validated_requests), deduped_keys

    def _save_bunk_requests(self, validated_requests: list[BunkRequest]) -> list[BunkRequest]:
        """Save validated bunk requests to the database.

        Handles both new requests and cross-run merge scenarios:
        - New requests: Create record and primary source link
        - Database match: Merge into existing, add source link

        Args:
            validated_requests: List of validated BunkRequest objects

        Returns:
            List of successfully saved requests
        """
        saved_requests = []

        for bunk_request in validated_requests:
            try:
                # Create new request with primary source link. Cross-run DB merge is
                # intentionally unsupported: duplicate avoidance is handled upstream by
                # content-hash change detection (clears `processed` on change) plus granular
                # clear-then-recreate, so the deduplicator never flags a DB match to merge.
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

    def _apply_validation_pipeline(
        self, requests: list[BunkRequest]
    ) -> tuple[list[BunkRequest], set[tuple[int, int | None, str]]]:
        """Apply the validation pipeline to a list of BunkRequest objects.

        This pipeline runs in order:
        1. Self-reference validation (mark and modify, keep for staff review)
        2. Deduplication (remove duplicate requests, keep highest priority)

        Args:
            requests: List of BunkRequest objects to validate

        Returns:
            Tuple of (validated_requests, deduped_keys) where deduped_keys is a set of
            (requester_cm_id, requested_cm_id, requested_name) tuples for requests
            removed by dedup. Includes requested_cm_id to avoid trace key collisions
            when different targets share the same name (#788).
        """
        if not requests:
            return requests, set()

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

                # Surface the self-ref flag in the existing Status column (#941).
                # The `manual_review_reason` metadata field is persisted but not
                # rendered anywhere in the frontend, so also overwrite the
                # promoted `disposition_reason`/`status` fields that are.
                request.status = RequestStatus.PENDING
                request.disposition_reason = "self_referential"

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

        # Build set of deduped-out request keys for trace accuracy
        # Key includes requested_cm_id to avoid collisions when different targets
        # share the same name (#788)
        deduped_keys: set[tuple[int, int | None, str]] = set()
        for group in dedup_result.duplicate_groups:
            for dup in group.duplicates:
                deduped_keys.add((dup.requester_cm_id, dup.requested_cm_id, dup.requested_name or ""))

        duplicates_removed = dedup_result.statistics.get("duplicates_removed", 0)
        self._stats["duplicates_removed"] = duplicates_removed

        if duplicates_removed > 0:
            logger.info(f"Removed {duplicates_removed} duplicate request(s)")

        # Reciprocal detection now happens in batch_signals stage before request building.
        # Stats are recorded there.

        return deduplicated_requests, deduped_keys

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
