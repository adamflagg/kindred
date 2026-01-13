#!/usr/bin/env python3
"""
Centralized authentication module for PocketBase.
Uses environment variables for credentials to avoid hardcoding.
"""

from __future__ import annotations

import os

# Note: ClientResponseError import may show as attr-defined error due to
# pocketbase library not exporting it explicitly, but it works at runtime
from pocketbase.client import ClientResponseError  # type: ignore[attr-defined]

from pocketbase import PocketBase


def authenticate_pocketbase(pb_url: str = "http://localhost:8090") -> PocketBase:
    """
    Authenticate with PocketBase using environment variables.

    Args:
        pb_url: The PocketBase URL (default: http://localhost:8090)

    Returns:
        Authenticated PocketBase client

    Raises:
        ClientResponseError: If authentication fails
    """
    pb = PocketBase(pb_url)

    # Get credentials from environment variables with defaults
    admin_email = os.getenv("POCKETBASE_ADMIN_EMAIL", "admin@camp.local")
    admin_password = os.getenv("POCKETBASE_ADMIN_PASSWORD", "campbunking123")

    try:
        pb.collection("_superusers").auth_with_password(admin_email, admin_password)
        return pb
    except ClientResponseError as e:
        print(f"Failed to authenticate with PocketBase: {e}")
        print(f"Using email: {admin_email}")
        print("Make sure POCKETBASE_ADMIN_EMAIL and POCKETBASE_ADMIN_PASSWORD are set correctly")
        raise


def get_authenticated_pb_client(pb_url: str = "http://localhost:8090") -> PocketBase:
    """
    Alias for authenticate_pocketbase for backward compatibility.

    Args:
        pb_url: The PocketBase URL (default: http://localhost:8090)

    Returns:
        Authenticated PocketBase client
    """
    return authenticate_pocketbase(pb_url)
