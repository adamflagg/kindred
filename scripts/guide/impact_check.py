"""Docs-impact gate (spec §3.3): a staff-visible change pairs a guide branch or says why not."""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

_EXCLUDED = re.compile(r"(\.test\.|^frontend/src/test/|/types/api-generated/|pocketbase-types\.ts$)")
_STAFF_VISIBLE = re.compile(
    r"^(frontend/src/.*\.(tsx|ts|css)$|bunking/rbac/permissions\.py$|scripts/guide/facts\.json$"
    r"|frontend/src/help/helpKeys\.json$|api/routers/)"
)
_DOCS_NONE = re.compile(r"^Docs: none [—–-] \S.*$")


def needs_docs(changed: list[str]) -> bool:
    return any(_STAFF_VISIBLE.search(p) and not _EXCLUDED.search(p) for p in changed)


def has_docs_none(body: str) -> bool:
    fence = ""  # the open fence's marker; only the same marker closes it
    for line in body.splitlines():
        s = line.strip()
        if not fence and s.startswith(("```", "~~~")):
            fence = s[:3]
            continue
        if fence:
            if s.startswith(fence):
                fence = ""
            continue
        if _DOCS_NONE.match(s):
            return True
    return False


def decide(changed: list[str], body: str, paired_has_commits: bool) -> tuple[bool, str]:
    if not needs_docs(changed):
        return True, "no staff-visible files changed"
    if paired_has_commits:
        return True, "paired guide branch has changes"
    if has_docs_none(body):
        return True, "Docs: none line present"
    return False, (
        "staff-visible change without a paired guide branch; add one, or a line 'Docs: none — <reason>' to the PR body"
    )


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--changed-file", type=Path, required=True)
    ap.add_argument("--body-file", type=Path, required=True)
    ap.add_argument("--paired-has-commits", choices=["true", "false"], required=True)
    a = ap.parse_args()
    ok, why = decide(
        [p for p in a.changed_file.read_text().splitlines() if p.strip()],
        a.body_file.read_text(),
        a.paired_has_commits == "true",
    )
    print(f"docs impact: {'pass' if ok else 'FAIL'} ({why})")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
