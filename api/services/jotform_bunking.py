"""An adult-weekend guest's Jotform bunking request, for the roster (kindred#2759).

Pure: no I/O. The repository hands in rows; this builds the payload. The
change rule lives HERE rather than in the browser so the card's "changed" dot,
the panel's inline markup and the tests all read one computation.

Rules, verbatim from the issue body's 2026-09-24 rulings:
  * "no request", "no preference", "none", "n/a" and the like are NO request.
  * A request splits on , ; / & "and" and newlines.
  * Two items at Jaro-Winkler >= 0.88 are one name re-spelled, not a removal
    plus an addition.
  * A version with an item that is not name-shaped -- more than 4 words, or
    I/we/my/if/please/list/whoever/whomever, or "not sure" -- falls back to
    showing every version in full.
  * A dropped item keeps the position it had.
"""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Sequence
from itertools import pairwise

from rapidfuzz.distance import JaroWinkler

from api.schemas.lodging import (
    BunkingRequestChange,
    BunkingRequestChangeItem,
    BunkingRequestVersion,
    ComingWithToken,
)

RESPELL_THRESHOLD = 0.88
MAX_NAME_WORDS = 4

_NO_REQUEST = re.compile(
    r"^(no|none|nope|n/?a|-+|no requests?|no preferences?|no special requests?|not applicable)\.?$",
    re.IGNORECASE,
)
_SPLIT = re.compile(r"[,;/&\n]|\band\b", re.IGNORECASE)
_PROSE_WORDS = frozenset({"i", "we", "my", "if", "please", "list", "whoever", "whomever"})
_NOT_SURE = re.compile(r"not sure", re.IGNORECASE)

_COMING_PATTERNS: tuple[tuple[ComingWithToken, re.Pattern[str]], ...] = (
    ("solo", re.compile(r"\bsolo\b", re.IGNORECASE)),
    ("family", re.compile(r"with family", re.IGNORECASE)),
    ("friends", re.compile(r"with friends", re.IGNORECASE)),
    ("partner", re.compile(r"partner", re.IGNORECASE)),
)


def normalize_request(text: str) -> str:
    """The bunking answer, trimmed, with "no request"-style words read as ""."""
    stripped = (text or "").strip()
    return "" if _NO_REQUEST.match(stripped) else stripped


def fold(name: str) -> str:
    """Case- and accent-folded, whitespace collapsed -- the identity of an item."""
    decomposed = unicodedata.normalize("NFKD", name)
    bare = "".join(ch for ch in decomposed if not unicodedata.combining(ch))
    return " ".join(bare.lower().split())


def request_items(text: str) -> list[str]:
    """Split a request into its name items, keeping each item's own spelling."""
    items: list[str] = []
    for raw in _SPLIT.split(text or ""):
        item = raw.strip().rstrip(".").strip()
        if item:
            items.append(item)
    return items


def is_name_shaped(text: str) -> bool:
    if _NOT_SURE.search(text or ""):
        return False
    for item in request_items(text):
        words = item.split()
        if len(words) > MAX_NAME_WORDS:
            return False
        if any(re.sub(r"[^a-z']", "", word.lower()) in _PROSE_WORDS for word in words):
            return False
    return True


def _similarity(a: str, b: str) -> float:
    return float(JaroWinkler.similarity(fold(a), fold(b)))


def _moved_words(old: str, new: str) -> str:
    """Only the words that changed ("Johnston"), when the word counts match and
    some words did not move; the whole old name otherwise."""
    old_words, new_words = old.split(), new.split()
    if len(old_words) == len(new_words):
        same = sum(1 for a, b in zip(old_words, new_words, strict=True) if a == b)
        if 0 < same < len(old_words):
            return " ".join(a for a, b in zip(old_words, new_words, strict=True) if a != b)
    return old


def diff_items(before: Sequence[str], after: Sequence[str]) -> list[BunkingRequestChangeItem]:
    """`after` in its own order, each item keep/add/respell, with every dropped
    `before` item re-inserted after its nearest surviving predecessor."""
    before_keys = {fold(n) for n in before}
    after_keys = {fold(n) for n in after}
    removed = [n for n in before if fold(n) not in after_keys]
    added = [n for n in after if fold(n) not in before_keys]

    respelled: dict[str, str] = {}  # new spelling -> old spelling
    for gone in list(removed):
        if not added:
            break
        best, best_score = added[0], _similarity(gone, added[0])
        for candidate in added[1:]:
            score = _similarity(gone, candidate)
            if score > best_score:
                best, best_score = candidate, score
        if best_score >= RESPELL_THRESHOLD:
            respelled[best] = gone
            removed.remove(gone)
            added.remove(best)

    out: list[BunkingRequestChangeItem] = []
    for name in after:
        if name in respelled:
            out.append(BunkingRequestChangeItem(text=name, op="respell", was=_moved_words(respelled[name], name)))
        elif name in added:
            out.append(BunkingRequestChangeItem(text=name, op="add"))
        else:
            out.append(BunkingRequestChangeItem(text=name, op="keep"))

    renamed_to = {old: new for new, old in respelled.items()}

    def position(name: str) -> int:
        target = fold(renamed_to.get(name, name))
        for index, item in enumerate(out):
            if item.op != "remove" and fold(item.text) == target:
                return index
        return -1

    removed_set = set(removed)
    for index, name in enumerate(before):
        if name not in removed_set:
            continue
        anchor = -1
        for earlier in reversed(before[:index]):
            found = position(earlier)
            if found >= 0:
                anchor = found
                break
        at = anchor + 1
        while at < len(out) and out[at].op == "remove":
            at += 1
        out.insert(at, BunkingRequestChangeItem(text=name, op="remove"))
    return out


def _key(text: str) -> str:
    return "|".join(fold(item) for item in request_items(text))


def request_changed(versions: Sequence[BunkingRequestVersion]) -> bool:
    """True when ANY two consecutive filings differ, compared as normalized
    item lists (P15, owner 2026-09-24). The card's amber dot reads this.

    Deliberately NOT derived from `resolve_change`, which is the NET change
    between the first and latest filings: a request that moved and moved back
    (A -> A+B -> A) has changed, though its net markup is all keep. Every
    filing counts, blank ones included -- a blank re-file withdraws the
    request, so it is a change.
    """
    keys = [_key(v.text) for v in versions]
    return any(a != b for a, b in pairwise(keys))


def resolve_change(versions: Sequence[BunkingRequestVersion]) -> BunkingRequestChange | None:
    """How the request moved. A blank LATEST filing withdraws the request
    (owner ruling 2026-09-24): every name of the last named filing reads as
    removed. Blank filings between named ones are skipped."""
    named = [v for v in versions if v.text]
    latest = versions[-1] if versions else None
    if latest is not None and not latest.text and named:
        last_named = named[-1]
        if not is_name_shaped(last_named.text):
            return BunkingRequestChange(
                kind="prose",
                versions=[last_named, latest],
                from_date=last_named.submitted_at,
                to_date=latest.submitted_at,
            )
        return BunkingRequestChange(
            kind="list",
            items=diff_items(request_items(last_named.text), []),
            from_date=last_named.submitted_at,
            to_date=latest.submitted_at,
        )
    if len(named) < 2:
        return None
    first, current = named[0], named[-1]
    if all(_key(v.text) == _key(first.text) for v in named):
        return BunkingRequestChange(
            kind="identical", count=len(named), from_date=first.submitted_at, to_date=current.submitted_at
        )
    if not all(is_name_shaped(v.text) for v in named):
        return BunkingRequestChange(
            kind="prose", versions=list(named), from_date=first.submitted_at, to_date=current.submitted_at
        )
    return BunkingRequestChange(
        kind="list",
        items=diff_items(request_items(first.text), request_items(current.text)),
        from_date=first.submitted_at,
        to_date=current.submitted_at,
    )


def coming_with_tokens(answer_text: str, answer_json: object) -> list[ComingWithToken]:
    """Every ticked "coming with" option, ordered solo, family, friends,
    partner. Read from the checkbox's JSON list when stored, else its text."""
    if isinstance(answer_json, list):
        raw = " ; ".join(str(value) for value in answer_json)
    else:
        raw = answer_text or ""
    return [token for token, pattern in _COMING_PATTERNS if pattern.search(raw)]
