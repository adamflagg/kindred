#!/usr/bin/env python3
"""Process Bunk Requests - Main entry point for V2 bunk request processing

This script provides a clean interface to the three-phase bunk request processor.
It handles configuration, initialization, and execution of the request processing pipeline."""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import sys
from pathlib import Path
from typing import Any

from bunking.logging_config import TRACE, get_logger

# Add parent directories to path
sys.path.insert(0, str(Path(__file__).parent.parent.parent.parent))

from uuid import uuid4

from pocketbase import PocketBase

from .data.data_access_context import DataAccessContext
from .data.pocketbase_wrapper import PocketBaseWrapper
from .data.repositories import SessionRepository
from .debug.trace_collector import NoOpTraceCollector, TraceCollector
from .orchestrator import RequestOrchestrator
from .shared.constants import ALL_PROCESSING_FIELDS, validate_source_fields

# Setup logging
logger = get_logger(__name__)


def load_configuration() -> dict[str, Any]:
    """Load configuration from environment and config files.

    Required environment variables:
    - POCKETBASE_ADMIN_EMAIL: Admin email for PocketBase authentication
    - POCKETBASE_ADMIN_PASSWORD: Admin password for PocketBase authentication
    - AI_API_KEY: API key for AI provider (optional - disables AI if not set)
    """
    config: dict[str, Any] = {
        "pb_url": os.getenv("POCKETBASE_URL", "http://127.0.0.1:8090"),
        "pb_email": os.getenv("POCKETBASE_ADMIN_EMAIL"),
        "pb_password": os.getenv("POCKETBASE_ADMIN_PASSWORD"),
        "ai_provider": os.getenv("AI_PROVIDER", "openai"),
        "ai_api_key": os.getenv("AI_API_KEY"),
        "ai_model": os.getenv("AI_MODEL", "gpt-4o-mini"),
        "year": int(os.getenv("CURRENT_YEAR", "2025")),
    }

    # Validate required configuration
    if not config["pb_email"] or not config["pb_password"]:
        raise ValueError(
            "Missing required PocketBase credentials. "
            "Set POCKETBASE_ADMIN_EMAIL and POCKETBASE_ADMIN_PASSWORD environment variables."
        )

    if not config["ai_api_key"]:
        logger.warning("AI_API_KEY not set - AI features will be disabled")

    return config


async def process_bunk_requests(
    data_source: str,
    year: int,
    session_cm_ids: list[int],
    test_limit: int | None = None,
    clear_existing: bool = False,
    dry_run: bool = False,
    source_fields: list[str] | None = None,
    force: bool = False,
    debug: bool = False,
    collect_traces: bool = False,
) -> dict[str, Any]:
    """Process bunk requests from a data source.

    Args:
        data_source: Path to data file or 'database' for direct DB access
        year: Year to process
        session_cm_ids: List of Session CM IDs to process (including related sessions)
        test_limit: Optional limit for testing
        clear_existing: Whether to clear existing requests
        dry_run: If True, don't save to database
        source_fields: Optional list of source fields to filter by
        force: If True, clear processed flags before fetching (enables reprocessing)
        debug: If True, enable verbose AI parse logging
        collect_traces: If True, enable pipeline trace collection for debugging

    Returns:
        Processing results
    """
    # Create trace collector based on flag
    trace_collector: TraceCollector
    if collect_traces:
        run_id = uuid4().hex
        trace_collector = TraceCollector(run_id=run_id)
    else:
        trace_collector = NoOpTraceCollector()

    # Create DataAccessContext - handles PocketBase connection and authentication
    # ConfigLoader (used by orchestrator) will load AI config from PocketBase
    data_context = DataAccessContext(year=year)
    data_context.initialize_sync()  # Initialize connection before use

    # Create orchestrator with data context (new pattern)
    orchestrator = RequestOrchestrator(
        year=year,
        session_cm_ids=session_cm_ids,
        data_context=data_context,
        debug=debug,
        trace_collector=trace_collector,
    )

    # Get pb reference for database loading (DataAccessContext provides it)
    pb = data_context.pb_client

    try:
        # Load data
        if data_source == "database":
            # Load from bunk_requests table
            raw_requests = await load_from_database(pb, year, session_cm_ids, test_limit, source_fields, force)
        else:
            # Load from file (CSV, etc.)
            raw_requests = await load_from_file(data_source, test_limit)

        # Extract already_processed count from metadata (if present)
        already_processed_count = 0
        if raw_requests:
            already_processed_count = raw_requests[0].get("_already_processed_count", 0)

        # Check if this is an empty result with only metadata
        if raw_requests and len(raw_requests) == 1 and raw_requests[0].get("_empty"):
            logger.info("No new requests to process (all already processed)")
            return {
                "success": True,
                "statistics": {"requests_created": 0},
                "already_processed": already_processed_count,
            }

        logger.info(f"Loaded {len(raw_requests)} requests to process")

        # Diagnostic: Log field breakdown
        field_counts: dict[str, int] = {}
        for row in raw_requests:
            for key in row.get("_original_request_ids", {}):
                field_counts[key] = field_counts.get(key, 0) + 1
        logger.info(f"Field breakdown: {field_counts}")

        # Diagnostic: Log AI config (without exposing full API key)
        ai_config = orchestrator.ai_config
        api_key = ai_config.get("api_key", "")
        key_preview = f"{api_key[:8]}...{api_key[-4:]}" if api_key and len(api_key) > 12 else "(not set)"
        logger.info(
            f"AI config: provider={ai_config.get('provider')}, model={ai_config.get('model')}, api_key={key_preview}"
        )

        # Process requests
        result = await orchestrator.process_requests(
            raw_requests=raw_requests,
            clear_existing=clear_existing,
            progress_callback=lambda current, total, message: logger.info(f"Progress: {current}/{total} - {message}"),
        )

        # Add already_processed count to result
        result["already_processed"] = already_processed_count

        # Mark original_bunk_requests as processed (unless dry run)
        if not dry_run and result.get("success") and raw_requests:
            # Get loader from first row metadata
            loader = raw_requests[0].get("_loader")
            if loader:
                # Collect all original request IDs that were processed
                processed_ids = []
                for row in raw_requests:
                    ids = row.get("_original_request_ids", {})
                    processed_ids.extend(ids.values())

                if processed_ids:
                    marked = loader.mark_as_processed(processed_ids)
                    logger.info(f"Marked {marked} original_bunk_requests as processed")
                    result["original_requests_marked"] = marked

        # Handle dry run
        if dry_run:
            logger.info("Dry run mode - not saving to database")
            result["dry_run"] = True

        return result

    finally:
        # Flush traces after processing (fire-and-forget on failure)
        # In finally block so partial traces are preserved even if processing fails
        if trace_collector.enabled:
            try:
                await trace_collector.flush(
                    data_context.pb_client,
                    run_metadata={
                        "year": year,
                        "session": ",".join(str(s) for s in session_cm_ids),
                        "source_fields": source_fields or [],
                        "limit": test_limit or 0,
                        "force": force,
                    },
                )
            except Exception as e:
                logger.warning("Failed to flush traces: %s", e, exc_info=True)

        # Clean up resources (closes AI provider HTTP client)
        await orchestrator.close()
        # DataAccessContext cleanup
        data_context.close()


async def load_from_database(
    pb: PocketBase | PocketBaseWrapper,
    year: int,
    session_cm_ids: list[int],
    limit: int | None,
    source_fields: list[str] | None = None,
    force: bool = False,
) -> list[dict[str, Any]]:
    """Load raw request data from original_bunk_requests table.

    Fetches records that need processing:
    - processed IS NULL (never processed)
    - If force=True, first clears processed flags to enable reprocessing

    Only loads and marks as processed records for people in the target sessions.

    Filter order: Year → Source Field → Session → Limit
    """
    # Initialize loader with session filter
    from .integration.original_requests_loader import (  # noqa: PLC0415 — test patches integration.original_requests_loader.OriginalRequestsLoader; top-level binding bypasses the patch
        OriginalRequestsLoader,
    )

    loader = OriginalRequestsLoader(pb, year, session_cm_ids=session_cm_ids)
    loader.load_persons_cache()

    # Determine which fields to process
    # If source_fields provided, use those; otherwise use all
    fields_to_process = source_fields or ALL_PROCESSING_FIELDS

    # Force mode: clear processed flags to enable reprocessing (same logic as Go)
    if force:
        cleared = loader.clear_processed_flags(fields=fields_to_process, limit=limit)
        logger.info(f"Force mode: cleared {cleared} processed flags")

    # Count already processed records for visibility in stats
    already_processed_count = loader.count_already_processed(fields=fields_to_process)
    if already_processed_count > 0:
        logger.info(f"Found {already_processed_count} already processed records (skipped)")

    # Fetch requests needing processing
    # AI fields (bunk_with, not_bunk_with, bunking_notes, internal_notes) go to AI
    # Direct parse fields (socialize_with) are parsed without AI in orchestrator
    original_requests = loader.fetch_requests_needing_processing(fields=fields_to_process, limit=limit)

    if not original_requests:
        logger.info("No requests need processing")
        # Return empty list but with metadata for already_processed count
        return (
            [{"_already_processed_count": already_processed_count, "_empty": True}]
            if already_processed_count > 0
            else []
        )

    logger.info(f"Found {len(original_requests)} original_bunk_requests to process")

    # Convert to orchestrator format
    raw_requests = loader.convert_to_orchestrator_input(original_requests)
    logger.info(f"Converted to {len(raw_requests)} orchestrator rows")

    # Store loader reference and already_processed count as metadata
    if raw_requests:
        raw_requests[0]["_loader"] = loader
        raw_requests[0]["_already_processed_count"] = already_processed_count

    return raw_requests


async def load_from_file(file_path: str, limit: int | None) -> list[dict[str, Any]]:
    """Load raw request data from a file"""
    # This would load from CSV or other file formats
    # For now, return empty list
    logger.warning("File loading not yet implemented")
    return []


def main() -> None:
    """Main entry point"""
    parser = argparse.ArgumentParser(description="Process bunk requests using V2 three-phase pipeline")
    parser.add_argument("--year", type=int, default=2025, help="Year to process")
    parser.add_argument(
        "--session",
        type=str,
        required=True,
        help=("Session to process. Use 'all' for all bunking sessions, or a numeric cm_id for a specific session."),
    )
    parser.add_argument(
        "--source-field",
        type=str,
        action="append",
        default=None,
        help=(
            f"Source field(s) to process (can specify multiple). "
            f"Options: {', '.join(ALL_PROCESSING_FIELDS)}. Default: all fields"
        ),
    )
    parser.add_argument("--source", default="database", help="Data source (database or file path)")
    parser.add_argument("--test-limit", type=int, help="Limit processing for testing")
    parser.add_argument("--clear-existing", action="store_true", help="Clear existing requests first")
    parser.add_argument("--dry-run", action="store_true", help="Process without saving")
    parser.add_argument("--stats-output", type=str, help="Write JSON stats to this file (for Go integration)")
    parser.add_argument("--debug", action="store_true", help="Enable debug logging")
    parser.add_argument("--trace", action="store_true", help="Enable trace logging (very verbose)")
    parser.add_argument(
        "--force",
        action="store_true",
        help=(
            "Force reprocessing by clearing 'processed' flags in original_bunk_requests "
            "(same logic as Go API). Use with --clear-existing for full reprocess."
        ),
    )

    args = parser.parse_args()

    # Setup logging - import TRACE level for trace mode
    if args.trace:
        log_level = TRACE
    elif args.debug:
        log_level = logging.DEBUG
    else:
        log_level = logging.INFO

    logging.basicConfig(
        level=log_level,
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    )
    # Suppress noisy HTTP client logging (unless trace mode)
    if not args.trace:
        logging.getLogger("httpx").setLevel(logging.WARNING)
        logging.getLogger("httpcore").setLevel(logging.WARNING)
        logging.getLogger("openai").setLevel(logging.WARNING)

    # Validate source fields if provided
    source_fields: list[str] | None = None
    if args.source_field:
        try:
            source_fields = validate_source_fields(args.source_field)
            logger.info(f"Filtering to source fields: {source_fields}")
        except ValueError as e:
            parser.error(str(e))

    # Run processing
    try:
        # Get all related sessions using existing function
        async def process_with_related_sessions() -> dict[str, Any]:
            # Initialize PocketBase and authenticate first
            config = load_configuration()
            pb = PocketBase(config["pb_url"])

            try:
                pb.collection("_superusers").auth_with_password(config["pb_email"], config["pb_password"])
                logger.info("Authenticated with PocketBase for session lookup")
            except Exception as e:
                logger.error(f"Failed to authenticate: {e}")
                raise

            # Resolve session using dynamic lookup (supports 1, 2, 2a, 3a, toc, all, etc.)
            session_repo = SessionRepository(pb)
            try:
                session_cm_ids = session_repo.resolve_session_cm_ids(args.session, args.year)
            except ValueError as e:
                logger.error(str(e))
                raise
            logger.info(f"Session '{args.session}' resolved to: {session_cm_ids}")

            return await process_bunk_requests(
                data_source=args.source,
                year=args.year,
                session_cm_ids=session_cm_ids,
                test_limit=args.test_limit,
                clear_existing=args.clear_existing,
                dry_run=args.dry_run,
                source_fields=source_fields,
                force=args.force,
                debug=args.debug,
            )

        result = asyncio.run(process_with_related_sessions())

        # Write stats to file if requested (for Go integration)
        if args.stats_output:
            stats = result.get("statistics", {})
            stats_output = {
                "success": result.get("success", False),
                "created": stats.get("requests_created", 0),
                "updated": 0,  # Python creates, doesn't update
                "skipped": stats.get("phase2_ambiguous", 0),
                "errors": 0 if result.get("success") else 1,
                "already_processed": result.get("already_processed", 0),
            }
            with open(args.stats_output, "w") as f:
                json.dump(stats_output, f)
            logger.info(f"Wrote stats to {args.stats_output}")

        # Human-readable output
        if result["success"]:
            stats = result["statistics"]
            already_processed = result.get("already_processed", 0)
            if already_processed > 0:
                pass
        else:
            sys.exit(1)

    except Exception as e:
        logger.error(f"Fatal error: {e}")
        # Write error stats to file if requested
        if args.stats_output:
            with open(args.stats_output, "w") as f:
                json.dump({"success": False, "created": 0, "updated": 0, "skipped": 0, "errors": 1}, f)
        sys.exit(1)


if __name__ == "__main__":
    main()
