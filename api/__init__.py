"""
Kindred API - HTTP API layer for the Kindred cabin assignment system.

This package provides the FastAPI application that serves as the
backend-for-frontend (BFF) for the React bunking interface.
"""

# First, before any module of the app can open a file: the uvicorn entry point
# (`uvicorn api.main:app`) imports this package before api.main, so this is the
# earliest app code that runs. See api/file_modes.py.
from api.file_modes import restrict_new_files

restrict_new_files()
