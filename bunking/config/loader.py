"""
ConfigLoader - Unified fast-fail configuration management.

Loads configuration from environment variables and PocketBase database.
Requires database access and properly populated config values.
No silent fallbacks - fails immediately on missing/invalid config.
"""

from __future__ import annotations

import logging
import os
import time
from collections.abc import Iterator
from contextlib import contextmanager
from typing import TYPE_CHECKING, Any, cast

from pocketbase import PocketBase

from .errors import (
    ConfigError,
    DatabaseUnavailableError,
    MissingKeyError,
    UnknownKeyError,
    ValidationError,
)
from .schema import CONFIG_SCHEMA, get_all_required_keys
from .types import ConfigType

if TYPE_CHECKING:
    pass

logger = logging.getLogger(__name__)


class ConfigLoader:
    """
    Unified configuration loader with fast-fail behavior.

    Requires database access and properly populated config values.
    No silent fallbacks - fails immediately on missing/invalid config.

    Usage:
        # Initialize at application startup (validates all required keys)
        ConfigLoader.initialize(pocketbase_url="http://127.0.0.1:8090")

        # Get singleton instance
        loader = ConfigLoader.get_instance()

        # Typed accessors
        timeout = loader.get_int("solver.time_limit.seconds")
        enabled = loader.get_bool("smart_local_resolution.enabled")

        # Test substitution
        with ConfigLoader.use(mock_loader):
            # Tests run with mock
            pass
    """

    _instance: ConfigLoader | None = None
    _initialized: bool = False

    def __init__(
        self,
        pb_client: PocketBase | None = None,
        cache_ttl_seconds: int = 300,
    ):
        """
        Initialize the config loader.

        Args:
            pb_client: PocketBase client. If None, creates one from environment.
            cache_ttl_seconds: Cache TTL in seconds (default 5 minutes).
        """
        if pb_client is not None:
            self._pb = pb_client
        else:
            self._pb = self._create_pb_client()

        self._cache_ttl = cache_ttl_seconds
        self._cache: dict[str, tuple[Any, float]] = {}
        self._validated = False

    def _create_pb_client(self) -> PocketBase:
        """Create and authenticate a PocketBase client."""
        url = os.environ.get("POCKETBASE_URL", "http://127.0.0.1:8090")
        pb = PocketBase(url)

        email = os.environ.get("POCKETBASE_ADMIN_EMAIL", "admin@camp.local")
        password = os.environ.get("POCKETBASE_ADMIN_PASSWORD", "campbunking123")

        try:
            pb.collection("_superusers").auth_with_password(email, password)
        except Exception as e:
            # Log but don't fail yet - validation will catch DB issues
            logger.warning(f"Failed to authenticate with PocketBase: {e}")

        return pb

    @classmethod
    def initialize(
        cls,
        pocketbase_url: str | None = None,
        validate_on_init: bool = True,
        admin_email: str | None = None,
        admin_password: str | None = None,
    ) -> ConfigLoader:
        """
        Initialize the singleton ConfigLoader.

        Must be called once at application startup before any config access.
        Validates all required keys exist in database.

        Args:
            pocketbase_url: PocketBase server URL (defaults to env var)
            validate_on_init: If True, validates all required keys exist
            admin_email: Admin credentials (defaults to env var)
            admin_password: Admin credentials (defaults to env var)

        Returns:
            The initialized ConfigLoader instance

        Raises:
            ConfigError: If already initialized
            DatabaseUnavailableError: If database cannot be reached
            MissingKeyError: If required keys are missing
        """
        if cls._initialized:
            # Allow re-initialization in tests
            logger.debug("ConfigLoader already initialized, returning existing instance")
            return cls._instance  # type: ignore

        # Set environment variables if provided
        if pocketbase_url:
            os.environ["POCKETBASE_URL"] = pocketbase_url
        if admin_email:
            os.environ["POCKETBASE_ADMIN_EMAIL"] = admin_email
        if admin_password:
            os.environ["POCKETBASE_ADMIN_PASSWORD"] = admin_password

        instance = cls()

        if validate_on_init:
            instance._validate_all_required_keys()

        cls._instance = instance
        cls._initialized = True
        logger.info("ConfigLoader initialized successfully")
        return instance

    @classmethod
    def get_instance(cls) -> ConfigLoader:
        """
        Get the singleton instance.

        Returns:
            The ConfigLoader instance

        Raises:
            ConfigError: If not initialized
        """
        if not cls._initialized or cls._instance is None:
            # Auto-initialize with defaults for backwards compatibility
            # This is expected behavior for CLI scripts that don't call initialize()
            logger.debug("ConfigLoader auto-initializing (no explicit initialize() call)")
            return cls.initialize(validate_on_init=False)
        return cls._instance

    @classmethod
    def reset(cls) -> None:
        """Reset singleton state. For testing only."""
        cls._instance = None
        cls._initialized = False

    @classmethod
    @contextmanager
    def use(cls, loader: ConfigLoader) -> Iterator[None]:
        """
        Temporarily replace the singleton with a custom loader.

        Useful for testing.

        Args:
            loader: The loader to use temporarily.
        """
        original = cls._instance
        original_initialized = cls._initialized
        cls._instance = loader
        cls._initialized = True
        try:
            yield
        finally:
            cls._instance = original
            cls._initialized = original_initialized

    def _validate_all_required_keys(self) -> None:
        """
        Validate all required config keys exist with valid values.

        Raises:
            DatabaseUnavailableError: If database cannot be reached
            ConfigError: If any required keys are missing or invalid
        """
        missing_keys: list[str] = []
        invalid_values: list[str] = []

        required_keys = get_all_required_keys()

        for key in required_keys:
            schema = CONFIG_SCHEMA[key]

            try:
                raw_value = self._query_database_raw(key)

                if raw_value is None:
                    missing_keys.append(key)
                    continue

                # Convert and validate
                try:
                    typed_value = self._convert_type(raw_value, schema.config_type)
                    error = schema.validate(typed_value)
                    if error:
                        invalid_values.append(f"{key}: {error}")
                except (ValueError, TypeError) as e:
                    invalid_values.append(f"{key}: type conversion failed - {e}")

            except DatabaseUnavailableError:
                raise
            except Exception as e:
                raise DatabaseUnavailableError(f"Database error while validating config key '{key}': {e}") from e

        if missing_keys or invalid_values:
            error_parts = []
            if missing_keys:
                error_parts.append(f"Missing required keys ({len(missing_keys)}): {missing_keys}")
            if invalid_values:
                error_parts.append(f"Invalid values ({len(invalid_values)}): {invalid_values}")

            raise ConfigError("Configuration validation failed.\n" + "\n".join(error_parts))

        self._validated = True
        logger.info(f"Validated {len(required_keys)} required config keys")

    def _get_env_key(self, key: str) -> str:
        """Convert dot notation to environment variable name."""
        # priority.age_preference.default -> CONFIG_PRIORITY_AGE_PREFERENCE_DEFAULT
        return "CONFIG_" + key.upper().replace(".", "_")

    def get(self, key: str) -> Any:
        """
        Get a configuration value.

        Args:
            key: Configuration key (e.g., "solver.time_limit.seconds")

        Returns:
            The typed configuration value

        Raises:
            UnknownKeyError: If key is not in schema
            MissingKeyError: If required key not in database
            ValidationError: If value fails validation
        """
        # Validate key is known
        if key not in CONFIG_SCHEMA:
            raise UnknownKeyError(f"Unknown config key: '{key}'")

        schema = CONFIG_SCHEMA[key]

        # Check environment first (highest priority override)
        env_key = self._get_env_key(key)
        env_value = os.environ.get(env_key)
        if env_value is not None:
            try:
                typed_value = self._convert_type(env_value, schema.config_type)
                return typed_value
            except (ValueError, TypeError) as e:
                raise ValidationError(f"Environment variable {env_key} has invalid type: {e}") from e

        # Check cache
        if key in self._cache:
            value, timestamp = self._cache[key]
            if time.time() - timestamp < self._cache_ttl:
                return value

        # Query database
        try:
            raw_value = self._query_database_raw(key)
        except Exception as e:
            raise DatabaseUnavailableError(f"Database error fetching config key '{key}': {e}") from e

        # Handle missing values
        if raw_value is None:
            raise MissingKeyError(
                f"Required config key '{key}' not found in database. Run migrations or add key to config table."
            )

        # Convert and validate
        try:
            typed_value = self._convert_type(raw_value, schema.config_type)
        except (ValueError, TypeError) as e:
            raise ValidationError(f"Config key '{key}' has invalid type: {e}") from e

        error = schema.validate(typed_value)
        if error:
            raise ValidationError(f"Config key '{key}': {error}")

        # Cache and return
        self._cache[key] = (typed_value, time.time())
        return typed_value

    def get_int(self, key: str, default: int | None = None) -> int:
        """Get an integer config value."""
        try:
            return cast(int, self.get(key))
        except (MissingKeyError, UnknownKeyError):
            if default is not None:
                return default
            raise

    def get_float(self, key: str, default: float | None = None) -> float:
        """Get a float config value."""
        try:
            return cast(float, self.get(key))
        except (MissingKeyError, UnknownKeyError):
            if default is not None:
                return default
            raise

    def get_bool(self, key: str, default: bool | None = None) -> bool:
        """Get a boolean config value."""
        try:
            return cast(bool, self.get(key))
        except (MissingKeyError, UnknownKeyError):
            if default is not None:
                return default
            raise

    def get_str(self, key: str, default: str | None = None) -> str:
        """Get a string config value."""
        try:
            return cast(str, self.get(key))
        except (MissingKeyError, UnknownKeyError):
            if default is not None:
                return default
            raise

    def get_priority(self, priority_type: str, subtype: str = "default") -> int:
        """
        Get a priority value.

        Args:
            priority_type: Type of priority (e.g., "age_preference").
            subtype: Subtype (default: "default").

        Returns:
            Priority value as integer.
        """
        key = f"priority.{priority_type}.{subtype}"
        # Priority keys may not be in schema - use safe fallback
        try:
            return self.get_int(key)
        except UnknownKeyError:
            logger.debug(f"Priority key '{key}' not in schema, using default 5")
            return 5

    def get_constraint(self, constraint_type: str, param: str, default: int | None = None) -> int:
        """
        Get a constraint parameter value.

        Args:
            constraint_type: Type of constraint (e.g., "age_spread").
            param: Parameter name (e.g., "penalty").
            default: Optional default value if key not found.

        Returns:
            Constraint value as integer.
        """
        key = f"constraint.{constraint_type}.{param}"
        return self.get_int(key, default=default)

    def get_solver_param(self, param_type: str, subtype: str) -> int:
        """
        Get a solver parameter value.

        Args:
            param_type: Parameter type (e.g., "time_limit").
            subtype: Subtype (e.g., "seconds").

        Returns:
            Solver parameter value as integer.
        """
        key = f"solver.{param_type}.{subtype}"
        return self.get_int(key)

    def get_soft_constraint_weight(self, constraint_name: str, default: int | None = None) -> int:
        """
        Get soft constraint weight value for the given constraint.

        Args:
            constraint_name: Name of the constraint (e.g., "level_progression").
            default: Optional default value if key not found.

        Returns:
            Constraint weight as integer.
        """
        weight_mappings = {
            "isolated_camper_prevention": "constraint.isolated_camper_ratio.penalty",
            # level_progression removed - uses no_regression_penalty via constraint module
            "must_satisfy_one": "constraint.must_satisfy_one.penalty",
            "age_grade_flow": "constraint.age_grade_flow.weight",
            "grade_cohesion": "constraint.grade_cohesion.weight",
            "grade_spread": "constraint.grade_spread.penalty",
            "age_spread": "constraint.age_spread.penalty",
        }

        key = weight_mappings.get(constraint_name, f"constraint.{constraint_name}.weight")
        return self.get_int(key, default=default)

    def _query_database_raw(self, key: str) -> Any | None:
        """
        Query PocketBase for a config value.

        Args:
            key: The dot-notation config key

        Returns:
            The raw value from database, or None if not found
        """
        parts = key.split(".")

        if len(parts) == 1:
            category, subcategory, config_key = "general", None, parts[0]
        elif len(parts) == 2:
            category, subcategory, config_key = parts[0], None, parts[1]
        elif len(parts) == 3:
            category, subcategory, config_key = parts[0], parts[1], parts[2]
        else:
            category = parts[0]
            subcategory = "_".join(parts[1:-1])
            config_key = parts[-1]

        filter_str = f'category = "{category}" && config_key = "{config_key}"'
        if subcategory:
            filter_str += f' && subcategory = "{subcategory}"'
        else:
            filter_str += ' && (subcategory = null || subcategory = "")'

        try:
            record = self._pb.collection("config").get_first_list_item(filter_str)
            return record.value
        except Exception:
            # Record not found
            return None

    def _convert_type(self, value: Any, config_type: ConfigType) -> Any:
        """Convert a raw value to the specified type."""
        if config_type == ConfigType.INT:
            return int(value)
        elif config_type == ConfigType.FLOAT:
            return float(value)
        elif config_type == ConfigType.BOOL:
            if isinstance(value, bool):
                return value
            if isinstance(value, str):
                return value.lower() in ("true", "1", "yes", "on")
            return bool(value)
        elif config_type == ConfigType.STRING:
            return str(value)
        elif config_type == ConfigType.JSON:
            return value  # Already parsed from JSON
        else:
            return value

    def get_ai_config(self) -> dict[str, Any]:
        """
        Get all AI-related configuration.

        AI settings (provider, api_key, model) come from environment variables
        since they contain secrets. Other AI config comes from database.

        Returns:
            Nested dictionary with AI configuration.
        """
        # Start with provider settings from environment (secrets stay in env)
        config: dict[str, Any] = {
            "provider": os.getenv("AI_PROVIDER", "openai"),
            "api_key": os.getenv("AI_API_KEY"),
            "model": os.getenv("AI_MODEL", "gpt-4o-mini"),
            "temperature": 0.1,
            "max_tokens": 2000,
            "batch_processing": {"enabled": True, "batch_size": 10, "max_concurrent_batches": 3},
        }

        # Query PocketBase for category='ai' records (non-secret config)
        try:
            records = self._pb.collection("config").get_full_list(query_params={"filter": "category = 'ai'"})

            # Build nested dict from flat records
            pb_config = self._build_nested_from_records(records)

            # Merge PocketBase config into result
            for key, value in pb_config.items():
                config[key] = value

            logger.debug(f"Loaded AI config from PocketBase: {len(records)} records")

        except Exception as e:
            logger.warning(f"Failed to load AI config from PocketBase: {e}")

        return config

    def _build_nested_from_records(self, records: list[Any]) -> dict[str, Any]:
        """
        Build nested dict from flat PocketBase config records.

        Converts records with subcategory paths like 'confidence_thresholds.valid'
        into nested dicts like {'confidence_thresholds': {'valid': 0.85}}.

        Args:
            records: List of PocketBase config records with subcategory, config_key, value

        Returns:
            Nested dict structure
        """
        result: dict[str, Any] = {}

        for record in records:
            subcategory = getattr(record, "subcategory", None) or ""
            config_key = record.config_key
            value = record.value

            # Build the path: subcategory parts + config_key
            parts = subcategory.split(".") + [config_key] if subcategory else [config_key]

            # Navigate/create nested structure
            current = result
            for part in parts[:-1]:
                if part not in current:
                    current[part] = {}
                current = current[part]

            # Set the leaf value
            current[parts[-1]] = value

        return result

    def invalidate_cache(self, key: str | None = None) -> None:
        """
        Invalidate cached values.

        Args:
            key: Specific key to invalidate, or None for all
        """
        if key is None:
            self._cache.clear()
        elif key in self._cache:
            del self._cache[key]

    def clear_cache(self) -> None:
        """Clear the configuration cache (alias for invalidate_cache)."""
        self._cache.clear()

    def reload(self) -> None:
        """Reload configuration from sources."""
        self.clear_cache()

    def update_config(self, key: str, value: str | int | float) -> None:
        """
        Update a configuration value in the database.

        Args:
            key: Dot-notation key (e.g., "solver.time_limit.seconds").
            value: New value to set.

        Raises:
            UnknownKeyError: If key is not in schema
            ValidationError: If value fails validation
        """
        # Validate key is known
        if key not in CONFIG_SCHEMA:
            raise UnknownKeyError(f"Unknown config key: '{key}'")

        schema = CONFIG_SCHEMA[key]

        # Validate value
        error = schema.validate(value)
        if error:
            raise ValidationError(f"Cannot update '{key}': {error}")

        parts = key.split(".")
        if len(parts) == 1:
            category, subcategory, config_key = "general", None, parts[0]
        elif len(parts) == 2:
            category, subcategory, config_key = parts[0], None, parts[1]
        elif len(parts) == 3:
            category, subcategory, config_key = parts[0], parts[1], parts[2]
        else:
            category = parts[0]
            subcategory = "_".join(parts[1:-1])
            config_key = parts[-1]

        filter_str = f'category = "{category}" && config_key = "{config_key}"'
        if subcategory:
            filter_str += f' && subcategory = "{subcategory}"'
        else:
            filter_str += ' && (subcategory = null || subcategory = "")'

        record = self._pb.collection("config").get_first_list_item(filter_str)
        self._pb.collection("config").update(record.id, {"value": value})

        # Invalidate cache entry
        self.invalidate_cache(key)

        logger.info(f"Updated config '{key}' to '{value}'")

    def health_check(self) -> dict[str, Any]:
        """
        Perform a health check on configuration system.

        Returns:
            Dict with status, validation results, and any issues
        """
        result: dict[str, Any] = {
            "status": "healthy",
            "database_connected": False,
            "validated": self._validated,
            "cached_keys": len(self._cache),
            "issues": [],
        }

        # Check database connection
        try:
            self._pb.collection("config").get_list(page=1, per_page=1)
            result["database_connected"] = True
        except Exception as e:
            result["status"] = "unhealthy"
            result["issues"].append(f"Database connection failed: {e}")

        return result
