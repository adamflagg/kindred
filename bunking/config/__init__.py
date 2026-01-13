"""
Unified configuration management for bunking system.

This module provides a fast-fail configuration system that requires
database access and properly populated config values.

Usage:
    from bunking.config import ConfigLoader, ConfigError

    # Initialize at application startup
    ConfigLoader.initialize(pocketbase_url="http://127.0.0.1:8090")

    # Get singleton instance
    config = ConfigLoader.get_instance()

    # Typed accessors
    timeout = config.get_int("solver.time_limit.seconds")
    enabled = config.get_bool("smart_local_resolution.enabled")
"""

from __future__ import annotations

from .errors import (
    ConfigError,
    DatabaseUnavailableError,
    MissingKeyError,
    UnknownKeyError,
    ValidationError,
)
from .loader import ConfigLoader
from .schema import CONFIG_SCHEMA, get_all_required_keys, get_schema_key, validate_key
from .types import ConfigKey, ConfigType

__all__ = [
    # Main loader
    "ConfigLoader",
    # Error classes
    "ConfigError",
    "MissingKeyError",
    "ValidationError",
    "DatabaseUnavailableError",
    "UnknownKeyError",
    # Schema
    "CONFIG_SCHEMA",
    "ConfigKey",
    "ConfigType",
    "get_schema_key",
    "get_all_required_keys",
    "validate_key",
]
