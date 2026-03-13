"""Utilities for safely building PocketBase filter strings."""


def pb_escape(value: str) -> str:
    """Escape a value for safe interpolation into PocketBase filter strings.

    PocketBase filter syntax uses single and double quotes for string literals.
    This function escapes characters that could break out of a quoted context.

    Usage:
        filter = f'name = "{pb_escape(user_input)}"'
    """
    value = value.replace("\\", "\\\\")
    value = value.replace('"', '\\"')
    value = value.replace("'", "\\'")
    return value
