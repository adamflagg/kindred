"""Write scripts/guide/facts.json: the names the private staff guide may quote.

Small on purpose (spec §3.1): permissions, help keys, and status vocabularies
that have one source in code. The guide's components throw on an unknown key,
which is what makes a rename here fail the guide build in the same PR.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from bunking.rbac.permissions import PERMISSION_AREAS, PERMISSION_INFO

REPO = Path(__file__).resolve().parents[2]
FACTS_PATH = REPO / "scripts" / "guide" / "facts.json"
HELP_KEYS_PATH = REPO / "frontend" / "src" / "help" / "helpKeys.json"
# Mirrors HELP_AREAS in frontend/src/help/resolveHelpKey.ts; a test keeps them equal.
HELP_AREAS = ["home", "summer", "weekend", "aid", "analytics", "manage", "people"]


def build_facts() -> dict[str, Any]:
    help_keys = json.loads(HELP_KEYS_PATH.read_text(encoding="utf-8"))
    return {
        "version": 1,
        "permissions": {
            code: {
                "label": info.label,
                "short": info.short,
                "area": info.area,
                "screens": [{"name": s.name, "path": s.path} for s in info.screens],
            }
            for code, info in PERMISSION_INFO.items()
        },
        "permission_areas": list(PERMISSION_AREAS),
        "help_keys": {e["key"]: {"area": e["area"], "label": e["label"], "path": e["path"]} for e in help_keys},
        "help_areas": HELP_AREAS,
        "statuses": {},
    }


def render(facts: dict[str, Any]) -> str:
    return json.dumps(facts, indent=2, sort_keys=True, ensure_ascii=False) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--path", type=Path, default=FACTS_PATH)
    args = parser.parse_args(argv)
    text = render(build_facts())
    if args.check:
        if not args.path.exists() or args.path.read_text(encoding="utf-8") != text:
            print("facts.json is stale: run uv run python -m scripts.guide.export_facts")
            return 1
        return 0
    args.path.write_text(text, encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
