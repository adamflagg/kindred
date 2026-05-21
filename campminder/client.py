"""CampMinder API client for fetching camper data and bunking requests."""

import base64
import json
import logging
import os
import re
import time
import traceback
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, cast

import requests
from dotenv import load_dotenv

# Load environment variables
load_dotenv()


# Default function for current season
def get_current_season() -> int:
    """Get current season from environment or default to current year."""
    season_id = os.getenv("CAMPMINDER_SEASON_ID")
    return int(season_id) if season_id else datetime.now(tz=UTC).year


@dataclass
class CampMinderConfig:
    """Configuration for CampMinder API access."""

    api_key: str
    subscription_key: str
    client_id: int
    season_id: int | None = None  # Will default to get_current_season() if not specified
    base_url: str = "https://api.campminder.com"

    def __post_init__(self) -> None:
        """Set default season_id if not provided."""
        if self.season_id is None:
            self.season_id = get_current_season()


@dataclass
class CamperData:
    """Represents a camper with their bunking requests."""

    person_id: int
    name: str
    age: int
    grade: int
    gender: str
    cabin_assignment: str | None = None
    bunking_requests: list[dict[str, Any]] = field(default_factory=list)
    custom_fields: dict[str, Any] = field(default_factory=dict)


class CampMinderClient:
    """Client for interacting with CampMinder API."""

    def __init__(self, config: CampMinderConfig):
        self.config = config
        self.session = requests.Session()
        self.jwt_token: str | None = None
        self.jwt_expiry: float | None = None

        # Token cache file path - store in home directory to persist across runs
        self.token_cache_file = os.path.expanduser("~/.campminder_token_cache.json")

        # Try to load cached token on initialization
        self._load_cached_token()

    def authenticate(self) -> str:
        """Get JWT token using API key.

        Based on auth.yaml specification:
        - GET /auth/apikey
        - Authorization header: API key (no Bearer prefix)
        - Ocp-Apim-Subscription-Key header for subscription
        """
        auth_url = f"{self.config.base_url}/auth/apikey"

        headers = {
            "Authorization": self.config.api_key,  # API key as-is, no Bearer prefix
            "Ocp-Apim-Subscription-Key": self.config.subscription_key,
            "X-Request-ID": f"AUTH-{int(time.time())}",  # Optional but helpful for debugging
        }

        # Retry logic for rate limiting
        max_retries = 5
        base_delay = 2.0

        for retry in range(max_retries):
            try:
                response = self.session.get(auth_url, headers=headers)
                response.raise_for_status()

                data = response.json()
                self.jwt_token = data["Token"]

                # Parse token expiry from JWT payload if available, otherwise default to 1 hour
                try:
                    # JWT tokens have format: header.payload.signature
                    # Payload contains 'exp' field with expiry timestamp
                    if self.jwt_token is None:  # pragma: no cover
                        raise ValueError("JWT token unexpectedly None")
                    payload_part = self.jwt_token.split(".")[1]
                    # Add padding if needed for base64 decoding
                    payload_part += "=" * (4 - len(payload_part) % 4)
                    payload = json.loads(base64.b64decode(payload_part))
                    self.jwt_expiry = payload.get("exp", time.time() + 3600)
                except Exception:
                    # If JWT parsing fails, default to 1 hour
                    self.jwt_expiry = time.time() + 3600

                # Save token to cache file
                self._save_cached_token()

                return self.jwt_token

            except requests.exceptions.HTTPError as e:
                if e.response.status_code == 429:
                    # Handle rate limiting with exponential backoff
                    wait_time = base_delay * (2**retry)

                    # Try to parse wait time from response
                    try:
                        error_data = e.response.json()
                        if "message" in error_data and "Try again in" in error_data["message"]:
                            # Extract seconds from message like "Rate limit is exceeded. Try again in 12 seconds."
                            match = re.search(r"Try again in (\d+) seconds", error_data["message"])
                            if match:
                                wait_time = int(match.group(1)) + 1  # Add 1 second buffer
                    except Exception:  # noqa: S110 — best-effort retry delay parsing
                        pass

                    if retry < max_retries - 1:
                        logger = logging.getLogger(__name__)
                        logger.warning(
                            f"Rate limit hit during authentication (attempt {retry + 1}/{max_retries}). Waiting {wait_time}s..."
                        )
                        time.sleep(wait_time)
                        continue
                    else:
                        raise Exception(
                            f"Authentication failed after {max_retries} attempts due to rate limiting: {e.response.text}"
                        )
                elif e.response.status_code == 401:
                    raise Exception(
                        f"Authentication failed: Invalid API key or subscription key. Status: {e.response.status_code}"
                    )
                elif e.response.status_code == 403:
                    raise Exception(
                        f"Authentication failed: API key does not have permission. Status: {e.response.status_code}"
                    )
                else:
                    raise Exception(f"Authentication failed: {e.response.status_code} - {e.response.text}")
            except Exception as e:
                if retry < max_retries - 1:
                    # For non-HTTP errors, still retry with backoff
                    wait_time = base_delay * (2**retry)
                    time.sleep(wait_time)
                    continue
                else:
                    raise Exception(f"Authentication error: {e!s}")

        # This should never be reached, but satisfies type checker
        raise Exception("Authentication failed: unexpected error in retry loop")

    def _ensure_authenticated(self) -> None:
        """Ensure we have a valid JWT token."""
        if not self.jwt_token or not self.jwt_expiry or time.time() >= self.jwt_expiry:
            self.authenticate()

    def _load_cached_token(self) -> None:
        """Load cached JWT token from file if it exists and is still valid."""
        try:
            if os.path.exists(self.token_cache_file):
                with open(self.token_cache_file) as f:
                    cache = json.load(f)

                # Verify the cached data has required fields
                if "token" in cache and "expiry" in cache:
                    # Check if token hasn't expired (with 60 second buffer)
                    if cache["expiry"] > time.time() + 60:
                        self.jwt_token = cache["token"]
                        self.jwt_expiry = cache["expiry"]
                        # Use logger if available, otherwise print
                        try:
                            logger = logging.getLogger(__name__)
                            logger.info(
                                f"Loaded cached CampMinder token (expires in {int((cache['expiry'] - time.time()) / 60)} minutes)"
                            )
                        except Exception:  # noqa: S110 — best-effort log message
                            pass
        except Exception:  # noqa: S110 — cache load is optional, authenticate normally
            pass

    def _save_cached_token(self) -> None:
        """Save JWT token to cache file for reuse across script runs."""
        try:
            cache_data = {"token": self.jwt_token, "expiry": self.jwt_expiry, "cached_at": time.time()}

            # Create directory if it doesn't exist
            os.makedirs(os.path.dirname(self.token_cache_file), exist_ok=True)

            # Write cache file with restrictive permissions
            with open(self.token_cache_file, "w") as f:
                json.dump(cache_data, f, indent=2)

            # Set file permissions to be readable only by owner
            os.chmod(self.token_cache_file, 0o600)

        except Exception:  # noqa: S110 — cache save is optional
            pass

    def _make_request(
        self, method: str, endpoint: str, params: dict[str, Any] | None = None, data: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        """Make authenticated request to API.

        Based on token_usage.json specification:
        - Authorization header: Bearer {jwt_token}
        - Ocp-Apim-Subscription-Key header required
        - X-Request-ID optional but helpful for troubleshooting
        """
        self._ensure_authenticated()

        # Handle API service routing
        # The endpoint format should be: service/path or just service for root
        parts = endpoint.split("/", 1)
        service = parts[0]
        path = parts[1] if len(parts) > 1 else ""

        # Map services to their base URLs
        service_urls = {
            "sessions": f"{self.config.base_url}/sessions",
            "bunks": f"{self.config.base_url}/bunks",
            "persons": f"{self.config.base_url}/persons",
            "auth": f"{self.config.base_url}/auth",
        }

        # Get the service base URL
        if service in service_urls:
            base_service_url = service_urls[service]
            url = f"{base_service_url}/{path}" if path else base_service_url
        else:
            # Fallback for any other endpoints
            url = f"{self.config.base_url}/{endpoint}"

        headers = {
            "Authorization": f"Bearer {self.jwt_token}",
            "Ocp-Apim-Subscription-Key": self.config.subscription_key,
            "X-Request-ID": f"REQ-{endpoint.replace('/', '-')}-{int(time.time())}",
        }

        # Only add Content-Type for requests with body data
        if data is not None:
            headers["Content-Type"] = "application/json"

        try:
            response = self.session.request(
                method=method, url=url, headers=headers, params=params, json=data if data is not None else None
            )
            response.raise_for_status()

            return cast(dict[str, Any], response.json())

        except requests.exceptions.HTTPError as e:
            if e.response.status_code == 401:
                # Token might have expired, try to re-authenticate once
                self.jwt_token = None  # Force re-authentication
                self._ensure_authenticated()

                # Retry the request with new token
                headers["Authorization"] = f"Bearer {self.jwt_token}"
                retry_response = self.session.request(
                    method=method, url=url, headers=headers, params=params, json=data if data is not None else None
                )
                retry_response.raise_for_status()
                return cast(dict[str, Any], retry_response.json())
            elif e.response.status_code == 429:
                # Rate limit error - include specific message
                raise Exception(f"Rate limit exceeded (429): {e.response.text}")
            else:
                raise Exception(f"API request failed: {e.response.status_code} - {e.response.text}")
        except Exception as e:
            raise Exception(f"Request error: {e!s}")

    def get_campers(self, page_size: int = 100) -> list[CamperData]:
        """Fetch all campers for the configured season."""
        campers = []
        page_number = 1

        while True:
            params = {
                "clientid": self.config.client_id,
                "seasonid": self.config.season_id,
                "pagenumber": page_number,
                "pagesize": page_size,
                "includecamperdetails": "true",
                "includecontactdetails": "true",
            }

            data = self._make_request("GET", "persons", params=params)

            for person in data.get("Results", []):
                # Only include campers (not staff, parents, etc.)
                if person.get("CamperDetails"):
                    camper = self._parse_camper(person)
                    campers.append(camper)

            # Check if there are more pages
            if not data.get("Next"):
                break

            page_number += 1

        return campers

    def get_custom_fields(self, person_id: int) -> dict[str, Any]:
        """Fetch custom fields for a specific person."""
        params = {
            "clientid": self.config.client_id,
            "seasonid": self.config.season_id,
            "pagenumber": 1,
            "pagesize": 100,
        }

        data = self._make_request("GET", f"persons/{person_id}/custom-fields", params=params)

        custom_fields = {}
        for field_data in data.get("Results", []):
            field_id = field_data["Id"]
            value = field_data.get("Value", "")
            # We'll need to map field IDs to meaningful names
            custom_fields[f"field_{field_id}"] = value

        return custom_fields

    def get_custom_field_definitions(self) -> dict[int, str]:
        """Get mapping of custom field IDs to names."""
        params = {"clientid": self.config.client_id, "pagenumber": 1, "pagesize": 1000}

        data = self._make_request("GET", "persons/custom-fields", params=params)

        field_mapping = {}
        for field_def in data.get("Results", []):
            field_mapping[field_def["Id"]] = field_def["Name"]

        return field_mapping

    def get_bunk_assignments_placeholder(self) -> dict[int, str]:
        """Get current bunk assignments for all campers.

        Note: The bunks/assignments endpoints are not available in the CampMinder API.
        This method returns an empty dict as a placeholder.
        Real cabin assignments would need to come from custom fields or another source.
        """

        # Return empty dict as placeholder
        # In a real implementation, this might parse cabin info from custom fields
        return {}

    def get_session_attendees(self, session_id: int, season_id: int | None = None) -> list[dict[str, Any]]:
        """Get attendees for a specific session.

        Based on sessions.yaml specification:
        - GET /{id}/season/{seasonid}/attendees
        Note: This endpoint doesn't support pagination based on the API spec
        """
        if season_id is None:
            season_id = self.config.season_id

        endpoint = f"sessions/{session_id}/season/{season_id}/attendees"
        params = {"clientid": self.config.client_id}

        try:
            data = self._make_request("GET", endpoint, params=params)
            if data:
                pass
            # Check if this endpoint returns paginated results or direct array
            if isinstance(data, dict) and "Results" in data:
                results = cast(list[dict[str, Any]], data.get("Results", []))
                return results
            elif isinstance(data, list):
                return data
            else:
                return []
        except Exception:
            traceback.print_exc()
            return []

    def get_all_attendees(self, season_id: int | None = None) -> list[dict[str, Any]]:
        """Get all attendees across all sessions.

        Based on sessions.yaml specification:
        - GET /attendees
        """
        if season_id is None:
            season_id = self.config.season_id

        all_attendees = []
        page_number = 1
        page_size = 500

        while True:
            params = {
                "clientid": self.config.client_id,
                "seasonid": season_id,
                "pagenumber": page_number,
                "pagesize": page_size,
                "status": 2,  # Status 2 = Enrolled
            }

            data = self._make_request("GET", "sessions/attendees", params=params)

            results = data.get("Results", [])
            all_attendees.extend(results)

            # Check if there are more pages
            if len(results) < page_size:
                break

            page_number += 1

            # Rate limiting
            time.sleep(0.5)

        return all_attendees

    def _parse_camper(self, person_data: dict[str, Any]) -> CamperData:
        """Parse person data into CamperData object."""
        camper_details = person_data.get("CamperDetails", {})

        # Calculate age from birthdate if available
        age = person_data.get("Age", 0)
        if age is None:
            age = 0
        elif isinstance(age, float):
            age = int(age)

        # Get grade
        grade = camper_details.get("CampGradeID", 0)

        # Parse name
        name_obj = person_data.get("Name", {})
        first_name = name_obj.get("First", "")
        last_name = name_obj.get("Last", "")
        full_name = f"{first_name} {last_name}".strip()

        # Get gender
        gender_map = {0: "F", 1: "M", 3: "U"}
        gender_id = person_data.get("GenderID", 3)
        gender = gender_map.get(gender_id, "U")

        return CamperData(
            person_id=person_data["ID"],
            name=full_name,
            age=age,
            grade=grade,
            gender=gender,
        )

    def fetch_all_data(self, fetch_custom_fields: bool = True) -> list[CamperData]:
        """Fetch all camper data including custom fields and bunk assignments."""
        campers = self.get_campers()

        # Get bunk assignments (using placeholder - real API doesn't support this)
        person_to_bunk = self.get_bunk_assignments_placeholder()

        # Get custom field definitions if needed
        field_mapping = {}
        if fetch_custom_fields:
            field_mapping = self.get_custom_field_definitions()

        # Update campers with assignments and custom fields
        for i, camper in enumerate(campers):
            # Add bunk assignment
            camper.cabin_assignment = person_to_bunk.get(camper.person_id)

            # Fetch custom fields
            if fetch_custom_fields:
                if i % 10 == 0:
                    pass

                try:
                    raw_fields = self.get_custom_fields(camper.person_id)
                    # Map field IDs to names
                    for field_key, value in raw_fields.items():
                        field_id = int(field_key.split("_")[1])
                        field_name = field_mapping.get(field_id, field_key)
                        camper.custom_fields[field_name] = value
                except Exception:  # noqa: S110 — skip malformed custom field keys
                    pass

        return campers

    def get_bunks(
        self,
        page_number: int = 1,
        page_size: int = 100,
        order_by: str = "SortOrder",
        order_ascending: bool = True,
        include_inactive: bool = False,
    ) -> dict[str, Any]:
        """Get bunks from CampMinder API."""
        params = {
            "clientid": self.config.client_id,
            "seasonid": self.config.season_id,
            "pagenumber": page_number,
            "pagesize": page_size,
            "orderby": order_by,
            "orderascending": str(order_ascending).lower(),
        }

        if include_inactive:
            params["includeinactive"] = True

        return self._make_request("GET", "bunks", params=params)

    def get_bunk_plans(
        self, page_number: int = 1, page_size: int = 100, order_ascending: bool = True, include_inactive: bool = False
    ) -> dict[str, Any]:
        """Get bunk plans from CampMinder API."""
        params = {
            "clientid": self.config.client_id,
            "seasonid": self.config.season_id,
            "pagenumber": page_number,
            "pagesize": page_size,
            "orderascending": str(order_ascending).lower(),
        }

        if include_inactive:
            params["includeinactive"] = True

        return self._make_request("GET", "bunks/plans", params=params)

    def get_bunk_assignments(
        self,
        bunk_plan_ids: list[int],
        bunk_ids: list[int],
        page_number: int = 1,
        page_size: int = 100,
        include_deleted: bool = False,
    ) -> dict[str, Any]:
        """Get bunk assignments from CampMinder API."""
        params = {
            "clientid": self.config.client_id,
            "seasonid": self.config.season_id,
            "pagenumber": page_number,
            "pagesize": page_size,
        }

        # Add bunk plan IDs
        for bunk_plan_id in bunk_plan_ids:
            params["bunkplanids"] = bunk_plan_id

        # Add bunk IDs
        for bunk_id in bunk_ids:
            params["bunkids"] = bunk_id

        if include_deleted:
            params["includedeleted"] = True

        # Build the URL with multiple ID params
        base_url = f"{self.config.base_url}/bunks/assignments"
        param_strings = []

        # Standard params
        for key, value in params.items():
            if key not in ["bunkplanids", "bunkids"]:
                param_strings.append(f"{key}={value}")

        # Add multiple bunk plan IDs
        param_strings.extend(f"bunkplanids={bunk_plan_id}" for bunk_plan_id in bunk_plan_ids)

        # Add multiple bunk IDs
        param_strings.extend(f"bunkids={bunk_id}" for bunk_id in bunk_ids)

        # Make the request with the full URL
        full_url = f"{base_url}?{'&'.join(param_strings)}"

        self._ensure_authenticated()
        headers = {
            "Authorization": f"Bearer {self.jwt_token}",
            "Ocp-Apim-Subscription-Key": self.config.subscription_key,
            "X-Request-ID": f"REQ-bunk-assignments-{int(time.time())}",
        }

        response = self.session.get(full_url, headers=headers)
        response.raise_for_status()
        return cast(dict[str, Any], response.json())

    def test_authentication(self) -> dict[str, Any]:
        """Test authentication and return basic API info.

        This method can be used to verify credentials are working
        without fetching large amounts of data.
        """
        try:
            # Try to authenticate
            token = self.authenticate()

            # Make a simple request to test the token
            params = {
                "clientid": self.config.client_id,
                "seasonid": self.config.season_id,
                "pagenumber": 1,
                "pagesize": 1,  # Minimal data request
            }

            # Test with a simple sessions request
            sessions_data = self._make_request("GET", "sessions", params=params)

            return {
                "status": "success",
                "message": "Authentication successful",
                "token_length": len(token),
                "client_id": self.config.client_id,
                "season_id": self.config.season_id,
                "test_endpoint": "sessions",
                "total_sessions": sessions_data.get("TotalCount", 0),
            }

        except Exception as e:
            return {
                "status": "error",
                "message": str(e),
                "client_id": self.config.client_id,
                "season_id": self.config.season_id,
            }


def load_config_from_env() -> CampMinderConfig | None:
    """Load CampMinder configuration from environment variables."""
    api_key = os.getenv("CAMPMINDER_API_KEY")
    subscription_key = os.getenv("CAMPMINDER_SUBSCRIPTION_KEY")
    client_id = os.getenv("CAMPMINDER_CLIENT_ID")
    season_id = os.getenv("CAMPMINDER_SEASON_ID")

    if not api_key or not subscription_key or not client_id:
        return None

    return CampMinderConfig(
        api_key=api_key,
        subscription_key=subscription_key,
        client_id=int(client_id),
        season_id=int(season_id) if season_id else datetime.now(tz=UTC).year,
    )


def load_config_from_file(filepath: str = ".credentials.json") -> CampMinderConfig | None:
    """Load CampMinder configuration from environment variables or JSON file."""
    # First try to load from environment variables
    api_key = os.getenv("CAMPMINDER_API_KEY")
    primary_key = os.getenv("CAMPMINDER_PRIMARY_KEY")
    client_id = os.getenv("CAMPMINDER_CLIENT_ID")
    season_id = os.getenv("CAMPMINDER_SEASON_ID")

    if api_key and primary_key and client_id:
        return CampMinderConfig(
            api_key=api_key,
            subscription_key=primary_key,
            client_id=int(client_id),
            season_id=int(season_id) if season_id else get_current_season(),
        )

    # Fall back to JSON file if env vars not available
    if not os.path.exists(filepath):
        return None

    with open(filepath) as f:
        data = json.load(f)

    return CampMinderConfig(
        api_key=data["api_key"],
        subscription_key=data["subscription_key"],
        client_id=data["client_id"],
        season_id=data.get("season_id", get_current_season()),
    )
