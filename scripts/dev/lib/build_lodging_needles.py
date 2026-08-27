#!/usr/bin/env python3
"""Build the lodging-name-guard NEEDLES pattern from the private registry.

kindred#2551, Option B. verify-no-hardcoded-lodging.sh's NEEDLES used to be a
hand-picked, hand-maintained sample of "distinctive unit strings" -- 15
literals covering a fraction of the ~90-unit registry. A full-registry
re-measurement found that widening the sample (making it separator-tolerant,
adding a few more entries) closes only 1 of the 14 comment-line leaks it was
missing; the other 13 were area and unit names the sample never sampled at
all, and no amount of hand-widening survives the NEXT unit either. This
module replaces the sample with the registry itself, whenever one is
readable.

Reads a lodging registry JSON file (schema: {"areas": [...], "units": [...],
"aliases": [...]}, each area/unit carrying "name" and "code", each alias
carrying "alias_string") and prints exactly two lines to stdout:

    1. the number of needle terms
    2. those terms, ERE-escaped and '|'-joined into a single alternation

DISTINCTIVENESS FILTER: only a term containing a space or a hyphen is used.
A term with neither is a BARE SINGLE TOKEN -- measured against the real
registry (kindred#2551), 38 of its 366 distinct terms are bare single tokens
that read as ordinary English words once case-folded (the exact
false-positive class verify-no-hardcoded-lodging.sh's own header has always
warned about); the remaining 328 are multi-token or hyphenated and safe as
literal needles. This mirrors, and supersedes, the hand-curated judgment the
old NEEDLES sample made call-by-call (e.g. keeping some single-token names
that were empirically safe) -- the registry-derived list makes the same call
mechanically, at every unit, not just the ones someone happened to sample.

EVERY term is wrapped in \b...\b (word-boundary anchors), unlike the old
sample, which applied \b to exactly one entry ("El Cap", because it read as
an English fragment once folded). Measured directly against this repo: an
unanchored multi-token needle DID produce a live false positive here -- a
two-word unit name matched across the accidental boundary between a Go
identifier and the token after it on the same line (e.g. "...Fridge bool"),
the same shape "El Cap" vs. "parallel capturers" was special-cased for.
Anchoring costs nothing a real leak needs: every term here contains a space
or a hyphen, and neither character can appear inside a source-code
identifier, so a genuine occurrence already sits at a word boundary in
prose, a string literal, or a path. This is safe here in a way it was NOT
safe for the OLD sample's single-token entries (verify-no-hardcoded-
lodging.sh's own comment explains why: a single-token needle like a bare
unit name needs to keep matching inside a camelCase identifier built by
concatenating it with no separator, e.g. a Go variable name, and \b would
break exactly that). This module never emits single-token needles, so that
tradeoff does not apply here.

Exits 1 and prints nothing to stdout (only a diagnostic to stderr) if the
file is missing, unreadable, not valid JSON, or yields zero usable terms --
the guard's caller falls back to its own committed sample in that case,
never to an empty pattern that would silently match everything under
grep -E's rules, or nothing at all.
"""

from __future__ import annotations

import json
import re
import sys
from typing import Any

# ERE (POSIX Extended Regular Expression, what `grep -E` speaks) special
# characters. A backslash in front of any other character is passed through
# literally by GNU grep, so escaping only this set is both necessary and
# sufficient -- escaping more (e.g. spaces, apostrophes) would just add
# meaningless backslashes.
_ERE_SPECIAL = frozenset(".^$*+?()[]{}|\\")


def _ere_escape(term: str) -> str:
    return "".join(("\\" + ch if ch in _ERE_SPECIAL else ch) for ch in term)


def _is_multi_token_or_hyphenated(term: str) -> bool:
    """True if `term` contains a space or a hyphen -- see module docstring."""
    return bool(re.search(r"[\s-]", term))


def _collect_terms(registry: dict[str, Any]) -> set[str]:
    terms: set[str] = set()
    for unit in registry.get("units", []) or []:
        for key in ("name", "code"):
            value = unit.get(key)
            if value:
                terms.add(value)
    for area in registry.get("areas", []) or []:
        for key in ("name", "code"):
            value = area.get(key)
            if value:
                terms.add(value)
    for alias in registry.get("aliases", []) or []:
        value = alias.get("alias_string")
        if value:
            terms.add(value)
    return terms


def main(argv: list[str]) -> int:
    path = argv[1] if len(argv) > 1 else "config/lodging_registry.json"
    try:
        with open(path, encoding="utf-8") as f:
            registry = json.load(f)
    except (OSError, json.JSONDecodeError) as exc:
        print(f"error: could not read/parse {path}: {exc}", file=sys.stderr)
        return 1

    if not isinstance(registry, dict):
        print(f"error: {path} did not parse to a JSON object", file=sys.stderr)
        return 1

    terms = _collect_terms(registry)
    distinctive = sorted(t for t in terms if _is_multi_token_or_hyphenated(t))

    if not distinctive:
        print(f"error: {path} yielded zero multi-token/hyphenated terms", file=sys.stderr)
        return 1

    pattern = "|".join(rf"\b{_ere_escape(t)}\b" for t in distinctive)
    print(len(distinctive))
    print(pattern)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
