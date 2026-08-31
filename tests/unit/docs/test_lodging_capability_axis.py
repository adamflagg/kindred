"""Half 2 of kindred#1913: add a capability axis to
``docs/reference/lodging-board-vs-summer.md``.

The doc (PR #2037) already covers whether the weekend lodging board *looks*
like summer's — six presentation sections, all closed. It has never once
answered whether the board *does* what summer does. This is the other axis.

Kept deliberately light: this is a docs-only change, and the spec is the
doc's own content, not a markdown-structure parser. What is worth pinning:

- the section exists at all, so a future edit can't silently drop it back to
  zero capability rows (the state re-measured at every triage pass on
  kindred#1913 since 2026-08-14);
- it covers every capability the issue's candidate survey named, so a future
  trim doesn't quietly lose a row rather than closing it;
- the `needs_resolution=` gate — deleted end-to-end by kindred#2581
  (`git grep needs_resolution=` returns zero hits anywhere in the tree) —
  never comes back into this doc as a live anchor. That is exactly the kind
  of stale-anchor claim this doc's own discipline ("re-derive, never trust a
  number written here") exists to prevent.
"""

import re
from pathlib import Path

DOC_PATH = Path(__file__).resolve().parents[3] / "docs" / "reference" / "lodging-board-vs-summer.md"
SECTION_HEADING = "7. Capability axis"

REQUIRED_CAPABILITY_ROWS = (
    "lock / friend group",
    "scenario",
    "legend",
    "unplaced badge",
    "utilisation",
    "detail panel",
    "tooltip",
    "journey",
    "findability",
    "request pipeline",
    "solver",
    "satisfaction scoring",
    "social graph",
    "do-not-place-with",
    "scenario scoring",
    "swap",
    "pdf export",
    "popout",
    "pre/post validation",
    "cohort",
    "metrics",
    "map",
    "availability",
)


def _doc_text() -> str:
    return DOC_PATH.read_text(encoding="utf-8")


def _capability_axis_section_text() -> str:
    """Text of the '## 7. Capability axis' section only, up to (not
    including) the next top-level '## ' heading.

    Coverage must be checked against the table itself, not the whole
    document — several of the required terms (map, availability, swap,
    scenario, findability, ...) also appear in the doc's prose outside the
    table (tab names, JS snippets in 'How to re-measure'), so a whole-doc
    substring search would keep passing even if a row were silently
    dropped from the table — exactly the regression this guard exists to
    catch.
    """
    sections = re.split(r"(?m)^## ", _doc_text())
    for section in sections:
        if section.startswith(SECTION_HEADING):
            return section
    raise AssertionError(f"no '## {SECTION_HEADING}' section found in the doc")


def test_capability_axis_section_exists() -> None:
    lowered = _doc_text().lower()
    assert "capability axis" in lowered, (
        "docs/reference/lodging-board-vs-summer.md has no capability axis section "
        "— half 2 of kindred#1913 is still unstarted"
    )


def test_capability_axis_covers_every_surveyed_capability() -> None:
    lowered = _capability_axis_section_text().lower()
    missing = [name for name in REQUIRED_CAPABILITY_ROWS if name not in lowered]
    assert not missing, f"capability axis is missing a row for: {missing}"


def test_dead_needs_resolution_gate_is_not_cited_as_a_live_anchor() -> None:
    text = _doc_text()
    assert "needs_resolution" not in text, (
        "needs_resolution was deleted end-to-end by kindred#2581 (git grep "
        "needs_resolution= is zero hits tree-wide); the capability axis must "
        "grep original_lodging_requests / lodging_requests instead of "
        "resurrecting this as a live anchor"
    )
