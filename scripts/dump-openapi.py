#!/usr/bin/env python3
"""
Dump the FastAPI app's OpenAPI schema to a JSON file for use by the TypeScript
codegen step.

Usage:
    uv run python scripts/dump-openapi.py [output_path]

Default output path: frontend/src/types/.openapi-schema.json
The output file is gitignored (*.json catch-all) — it's a build artifact.

Import notes:
- The FastAPI app is imported with SKIP_PB_AUTH=true so no running PocketBase
  instance is required. The lifespan startup handler authenticates to PocketBase,
  but app.openapi() runs at import time before any lifespan events fire.
- No database connections are opened by this import.
- No port binding occurs — we never call uvicorn.run().
"""

import json
import os
import sys
from pathlib import Path

# Ensure SKIP_PB_AUTH is set so the settings validator doesn't complain
# about missing PocketBase credentials. We never start the server — this is
# purely to call app.openapi() which reads the registered routes.
os.environ.setdefault("SKIP_PB_AUTH", "true")
os.environ.setdefault("POCKETBASE_URL", "http://localhost:8090")

# Resolve repo root (scripts/ lives one level below repo root)
REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_OUTPUT = REPO_ROOT / "frontend" / "src" / "types" / ".openapi-schema.json"

output_path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_OUTPUT
output_path.parent.mkdir(parents=True, exist_ok=True)

# Ensure repo root is on sys.path so `api` and `bunking` packages are importable
# whether this script is run as `uv run python scripts/dump-openapi.py` (from
# repo root, where uv sets CWD correctly) or invoked from another directory.
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

# Import AFTER setting env vars so pydantic-settings picks them up
from api.main import app  # noqa: E402

schema = app.openapi()
output_path.write_text(json.dumps(schema, indent=2))
print(f"OpenAPI schema written to {output_path}")
print(f"  {len(schema.get('components', {}).get('schemas', {}))} schemas")
print(f"  {len(schema.get('paths', {}))} paths")
