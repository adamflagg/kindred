#!/usr/bin/env python3
"""
Centralized logging configuration for sync scripts.

Uses the unified logging format from bunking.logging_config.
Format: 2026-01-06T14:05:52Z [sync/layer_name] LEVEL message
"""

from __future__ import annotations

import inspect
import logging

from bunking.logging_config import configure_logging, get_logger


def setup_logging(
    layer_name: str | None = None,
    level: int = logging.INFO,
    debug_override: bool | None = None,
) -> logging.Logger:
    """
    Set up logging for a sync layer.

    Args:
        layer_name: Name of the sync layer (e.g., 'sessions', 'attendees')
        level: Base logging level (default INFO)
        debug_override: Override the default debug setting for this layer

    Returns:
        Configured logger instance
    """
    # Determine source tag for unified format
    source = f"sync/{layer_name}" if layer_name else "sync"

    # Configure using centralized logging
    # This sets up ISO8601 format with health check filtering
    configure_logging(source=source, level=level, debug=debug_override)

    # Get logger for the calling module
    frame = inspect.stack()[1]
    module = inspect.getmodule(frame[0])
    logger_name = module.__name__ if module else "sync"
    logger = get_logger(logger_name)

    # Store debug mode on logger for easy access (backward compat)
    debug_mode = debug_override if debug_override is not None else False
    logger.debug_mode = debug_mode  # type: ignore[attr-defined]

    # If debug mode, ensure bunking modules are at DEBUG level
    if debug_mode:
        logging.getLogger("bunking").setLevel(logging.DEBUG)
        logging.getLogger("bunking.sync.bunk_request_processor").setLevel(logging.DEBUG)

    return logger
