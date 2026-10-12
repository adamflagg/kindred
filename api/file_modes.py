"""Make every file kindred-api creates private to the uid it runs as.

Every kindred container runs as the same nonroot uid (65532), and the only
file one container reads that another wrote -- PocketBase's SQLite, which
api/services/metrics_sql_connection.py opens read-only -- is read by that
same uid. Nothing needs group or other access, so new files are 0600 and new
directories 0700.

The images are distroless, with no shell to run ``umask`` before the server
starts, so the process sets it itself (see ``api/__init__.py``). A umask only
governs files created after it is set: files that already exist keep their
modes, and the solver's spawn workers inherit it from this process.
"""

from __future__ import annotations

import os

PRIVATE_UMASK = 0o077


def restrict_new_files() -> int:
    """Set the process umask to ``PRIVATE_UMASK`` and return the previous one."""
    return os.umask(PRIVATE_UMASK)
