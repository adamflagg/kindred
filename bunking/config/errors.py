"""Configuration error classes.

All config-related exceptions for fast-fail behavior.
"""


class ConfigError(Exception):
    """Base exception for configuration errors."""

    pass


class MissingKeyError(ConfigError):
    """Raised when a required config key is not found in database."""

    pass


class ValidationError(ConfigError):
    """Raised when a config value fails validation."""

    pass


class DatabaseUnavailableError(ConfigError):
    """Raised when the configuration database cannot be reached."""

    pass


class UnknownKeyError(ConfigError):
    """Raised when an unknown config key is requested."""

    pass
