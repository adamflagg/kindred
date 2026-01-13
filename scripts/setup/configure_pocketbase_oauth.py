#!/usr/bin/env python3
"""
Configure PocketBase OAuth2 provider from environment variables.
Run after PocketBase starts to set up Pocket ID authentication.
"""

from __future__ import annotations

import os
import sys
import time
from typing import Any

import requests
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Configuration
POCKETBASE_URL = "http://localhost:8090"
MAX_RETRIES = 30  # Wait up to 30 seconds for PocketBase to start

# Admin credentials from environment
ADMIN_EMAIL = os.getenv("POCKETBASE_ADMIN_EMAIL", "admin@example.com")
ADMIN_PASSWORD = os.getenv("POCKETBASE_ADMIN_PASSWORD")

# OAuth2 settings from environment (only issuer + credentials needed)
OIDC_ISSUER = os.getenv("OIDC_ISSUER")
OIDC_CLIENT_ID = os.getenv("OIDC_CLIENT_ID")
OIDC_CLIENT_SECRET = os.getenv("OIDC_CLIENT_SECRET")

# These will be populated by discovery
OIDC_AUTH_URL: str | None = None
OIDC_TOKEN_URL: str | None = None
OIDC_USER_URL: str | None = None


def discover_oidc_endpoints(issuer: str) -> dict[str, str] | None:
    """Discover OIDC endpoints from issuer's well-known configuration.

    Args:
        issuer: The OIDC issuer URL (e.g., https://auth.example.com)

    Returns:
        Dictionary with auth_url, token_url, userinfo_url keys, or None on failure.
    """
    discovery_url = f"{issuer.rstrip('/')}/.well-known/openid-configuration"
    print(f"🔍 Discovering OIDC endpoints from: {discovery_url}")

    try:
        response = requests.get(discovery_url, timeout=10)
        response.raise_for_status()
        config = response.json()

        auth_url = config.get("authorization_endpoint")
        token_url = config.get("token_endpoint")
        userinfo_url = config.get("userinfo_endpoint")

        # All three endpoints are required
        if not auth_url or not token_url or not userinfo_url:
            missing = []
            if not auth_url:
                missing.append("authorization_endpoint")
            if not token_url:
                missing.append("token_endpoint")
            if not userinfo_url:
                missing.append("userinfo_endpoint")
            print(f"❌ OIDC discovery response missing required endpoints: {', '.join(missing)}")
            return None

        print("✅ OIDC endpoints discovered:")
        print(f"   Auth: {auth_url}")
        print(f"   Token: {token_url}")
        print(f"   UserInfo: {userinfo_url}")

        return {
            "auth_url": auth_url,
            "token_url": token_url,
            "userinfo_url": userinfo_url,
        }
    except Exception as e:
        print(f"❌ OIDC discovery failed: {e}")
        return None


def check_required_vars() -> bool:
    """Check if all required environment variables are set."""
    required_vars = {
        "OIDC_ISSUER": OIDC_ISSUER,
        "OIDC_CLIENT_ID": OIDC_CLIENT_ID,
        "OIDC_CLIENT_SECRET": OIDC_CLIENT_SECRET,
        "POCKETBASE_ADMIN_PASSWORD": ADMIN_PASSWORD,
    }

    missing = []
    for var_name, var_value in required_vars.items():
        if not var_value:
            missing.append(var_name)

    if missing:
        print(f"❌ Missing required environment variables: {', '.join(missing)}")
        print("Please set these in your .env file")
        return False

    return True


def wait_for_pocketbase() -> bool:
    """Wait for PocketBase to be ready."""
    print("⏳ Waiting for PocketBase to start...")

    for i in range(MAX_RETRIES):
        try:
            response = requests.get(f"{POCKETBASE_URL}/api/health")
            if response.status_code == 200:
                print("✅ PocketBase is ready!")
                return True
        except requests.exceptions.ConnectionError:
            pass

        time.sleep(1)
        if i % 5 == 0 and i > 0:
            print(f"   Still waiting... ({i}s)")

    print("❌ PocketBase failed to start within 30 seconds")
    return False


def login_as_admin() -> str | None:
    """Login as PocketBase admin and return auth token."""
    print("🔐 Logging in as admin...")

    try:
        response = requests.post(
            f"{POCKETBASE_URL}/api/collections/_superusers/auth-with-password",
            json={"identity": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        )

        if response.status_code == 200:
            data = response.json()
            print("✅ Admin login successful")
            token = data.get("token")
            return str(token) if token else None
        else:
            print(f"❌ Admin login failed: {response.status_code}")
            print(f"   Response: {response.text}")
            return None

    except Exception as e:
        print(f"❌ Error during admin login: {e}")
        return None


def get_users_collection(token: str) -> dict[str, Any] | None:
    """Get the users collection configuration."""
    try:
        response = requests.get(f"{POCKETBASE_URL}/api/collections/users", headers={"Authorization": token})

        if response.status_code == 200:
            result: dict[str, Any] = response.json()
            return result
        else:
            print(f"❌ Failed to get users collection: {response.status_code}")
            return None

    except Exception as e:
        print(f"❌ Error getting users collection: {e}")
        return None


def configure_oauth2(token: str, endpoints: dict[str, str]) -> bool:
    """Configure OAuth2 provider settings for the users collection.

    Args:
        token: PocketBase admin auth token
        endpoints: Dictionary with auth_url, token_url, userinfo_url keys
    """
    print("🔧 Configuring OAuth2 provider...")

    # Get current users collection
    collection = get_users_collection(token)
    if not collection:
        return False

    # Update OAuth2 settings
    oauth2_config = {
        "enabled": True,
        "providers": [
            {
                "name": "oidc",
                "displayName": "Pocket ID",
                "clientId": OIDC_CLIENT_ID,
                "clientSecret": OIDC_CLIENT_SECRET,
                "authURL": endpoints["auth_url"],
                "tokenURL": endpoints["token_url"],
                "userURL": endpoints["userinfo_url"],
                "pkce": True,
                "enabled": True,
                "scopes": ["openid", "email", "profile"],
            }
        ],
    }

    # Update collection with OAuth2 config
    collection["oauth2"] = oauth2_config

    try:
        response = requests.patch(
            f"{POCKETBASE_URL}/api/collections/users",
            headers={"Authorization": token, "Content-Type": "application/json"},
            json=collection,
        )

        if response.status_code == 200:
            print("✅ OAuth2 provider configured successfully!")
            print("   Provider: oidc (Pocket ID)")
            print(f"   Client ID: {OIDC_CLIENT_ID}")
            print(f"   Auth URL: {endpoints['auth_url']}")
            print("   PKCE: Enabled")
            return True
        else:
            print(f"❌ Failed to configure OAuth2: {response.status_code}")
            print(f"   Response: {response.text}")
            return False

    except Exception as e:
        print(f"❌ Error configuring OAuth2: {e}")
        return False


def verify_configuration(token: str) -> bool:
    """Verify the OAuth2 configuration is active."""
    print("🔍 Verifying configuration...")

    try:
        # Check auth methods endpoint (public)
        response = requests.get(f"{POCKETBASE_URL}/api/collections/users/auth-methods")

        if response.status_code == 200:
            data = response.json()
            oauth2 = data.get("oauth2", {})
            providers = oauth2.get("providers", [])

            oidc_provider = next((p for p in providers if p["name"] == "oidc"), None)

            if oidc_provider:
                print("✅ OAuth2 configuration verified!")
                print(f"   OIDC provider is active: {oidc_provider.get('displayName', 'oidc')}")
                return True
            else:
                print("❌ OIDC provider not found in auth methods")
                return False
        else:
            print(f"❌ Failed to verify configuration: {response.status_code}")
            return False

    except Exception as e:
        print(f"❌ Error verifying configuration: {e}")
        return False


def main() -> int:
    """Main configuration flow."""
    print("🚀 PocketBase OAuth2 Configuration Script")
    print("=" * 50)

    # Check required environment variables
    if not check_required_vars():
        return 1

    # Discover OIDC endpoints from issuer
    if not OIDC_ISSUER:
        print("ERROR: OIDC_ISSUER is not set")
        return 1
    endpoints = discover_oidc_endpoints(OIDC_ISSUER)
    if not endpoints:
        print("❌ Failed to discover OIDC endpoints. Your OIDC provider may not support discovery.")
        return 1

    # Wait for PocketBase to be ready
    if not wait_for_pocketbase():
        return 1

    # Login as admin
    token = login_as_admin()
    if not token:
        return 1

    # Configure OAuth2 with discovered endpoints
    if not configure_oauth2(token, endpoints):
        return 1

    # Verify configuration
    if not verify_configuration(token):
        return 1

    print("\n✅ OAuth2 configuration complete!")
    print("You can now login with Pocket ID at http://localhost:8090")
    return 0


if __name__ == "__main__":
    sys.exit(main())
