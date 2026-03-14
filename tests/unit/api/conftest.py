"""Shared fixtures for API unit tests."""

import os

# Set auth bypass BEFORE any test module imports trigger settings loading.
# pytest loads conftest.py before test modules in the same directory,
# so this runs before any `from api.main import create_app` at module level.
os.environ["AUTH_MODE"] = "bypass"
os.environ["SKIP_PB_AUTH"] = "true"
