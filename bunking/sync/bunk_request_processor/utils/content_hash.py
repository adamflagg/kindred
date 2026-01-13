"""Content hash utility for detecting field-level changes.

This module provides utilities for computing and comparing content hashes
to enable efficient incremental sync by detecting only changed fields.

Each original_bunk_requests record represents ONE field (e.g., share_bunk_with,
do_not_share_with, internal_notes). By storing a hash of the field's content,
we can detect changes on subsequent syncs and only reprocess modified records."""

from __future__ import annotations

import hashlib


def calculate_content_hash(content: str | None) -> str:
    """Calculate MD5 hash of field content for change detection.

    Args:
        content: The field content to hash. None is treated as empty string.

    Returns:
        32-character hexadecimal MD5 hash string.

    Example:
        >>> calculate_content_hash("Johnny and Sarah")
        '5f4dcc3b5aa765d61d8327deb882cf99'  # example hash
        >>> calculate_content_hash(None)
        'd41d8cd98f00b204e9800998ecf8427e'  # hash of empty string
    """
    if content is None:
        content = ""

    return hashlib.md5(content.encode("utf-8")).hexdigest()


def content_changed(new_content: str | None, stored_hash: str | None) -> bool:
    """Check if content has changed compared to stored hash.

    Args:
        new_content: The new field content to check.
        stored_hash: The previously stored hash, or None/empty if new record.

    Returns:
        True if content has changed (or no previous hash exists), False otherwise.

    Example:
        >>> stored = calculate_content_hash("Johnny")
        >>> content_changed("Johnny and Sarah", stored)
        True
        >>> content_changed("Johnny", stored)
        False
        >>> content_changed("Johnny", None)  # New record
        True
    """
    # No previous hash means this is a new record - treat as changed
    if not stored_hash:
        return True

    new_hash = calculate_content_hash(new_content)
    return new_hash != stored_hash
