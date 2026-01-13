#!/usr/bin/env python3
"""Create admin user for PocketBase using environment variables."""

from __future__ import annotations

import os
import sys
import time

import requests


def wait_for_pocketbase(url: str, max_attempts: int = 30) -> bool:
    """Wait for PocketBase to be ready."""
    print(f"Waiting for PocketBase at {url} to be ready...")

    for attempt in range(max_attempts):
        try:
            response = requests.get(f"{url}/api/health", timeout=2)
            if response.status_code == 200:
                print("✅ PocketBase is ready")
                return True
        except requests.exceptions.RequestException:
            pass

        time.sleep(1)
        if attempt % 5 == 0:
            print(f"  Still waiting... ({attempt}/{max_attempts})")

    print("❌ PocketBase failed to start")
    return False


def create_admin() -> bool:
    """Create admin user from environment variables."""
    # Get configuration from environment
    pb_url = os.getenv("POCKETBASE_URL", "http://127.0.0.1:8090")
    email = os.getenv("POCKETBASE_ADMIN_EMAIL", "admin@camp.local")
    password = os.getenv("POCKETBASE_ADMIN_PASSWORD", "campbunking123")

    # Remove trailing slash from URL if present
    pb_url = pb_url.rstrip("/")

    print(f"Creating admin user: {email}")

    # Wait for PocketBase to be ready
    if not wait_for_pocketbase(pb_url):
        sys.exit(1)

    # Try to create admin
    url = f"{pb_url}/api/collections/_superusers/records"
    data = {"email": email, "password": password, "passwordConfirm": password}

    try:
        response = requests.post(url, json=data, headers={"Content-Type": "application/json"})

        if response.status_code == 200:
            print(f"✅ Admin user created successfully: {email}")
            return True
        elif response.status_code == 400:
            # Check if it's because admin already exists
            error_data = response.json()
            if "email" in error_data.get("data", {}) and "already exists" in str(error_data):
                print(f"ℹ️  Admin user already exists: {email}")
                return True
            else:
                print(f"❌ Failed to create admin: {response.status_code}")
                print(f"Response: {response.text}")
                return False
        else:
            print(f"❌ Failed to create admin: {response.status_code}")
            print(f"Response: {response.text}")
            return False

    except Exception as e:
        print(f"❌ Error creating admin: {e}")
        return False


def verify_admin_login() -> bool:
    """Verify that the admin can log in."""
    pb_url = os.getenv("POCKETBASE_URL", "http://127.0.0.1:8090")
    email = os.getenv("POCKETBASE_ADMIN_EMAIL", "admin@camp.local")
    password = os.getenv("POCKETBASE_ADMIN_PASSWORD", "campbunking123")

    pb_url = pb_url.rstrip("/")

    try:
        response = requests.post(
            f"{pb_url}/api/collections/_superusers/auth-with-password",
            json={"identity": email, "password": password},
            headers={"Content-Type": "application/json"},
        )

        if response.status_code == 200:
            print("✅ Admin login verified")
            return True
        else:
            print(f"❌ Admin login failed: {response.status_code}")
            return False
    except Exception as e:
        print(f"❌ Error verifying admin login: {e}")
        return False


if __name__ == "__main__":
    # Create admin
    if create_admin():
        # Verify login works
        verify_admin_login()
    else:
        sys.exit(1)
