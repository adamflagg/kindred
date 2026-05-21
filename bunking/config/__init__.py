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
    enabled = config.get_int("smart_local_resolution.enabled")
    weight = config.get_float("smart_local_resolution.connection_score_weight")
"""

from .errors import (
    ConfigError,
    DatabaseUnavailableError,
    MissingKeyError,
    UnknownKeyError,
    ValidationError,
)
from .loader import ConfigLoader
from .schema import CONFIG_SCHEMA, get_all_required_keys
from .types import ConfigKey, ConfigType

__all__ = [
    # Schema
    "CONFIG_SCHEMA",
    # Error classes
    "ConfigError",
    "ConfigKey",
    # Main loader
    "ConfigLoader",
    "ConfigType",
    "DatabaseUnavailableError",
    "MissingKeyError",
    "UnknownKeyError",
    "ValidationError",
    "get_all_required_keys",
]
