"""The one order Camperships lists several sessions in (owner Q8, 2026-10-09, then app-wide).

Owner, verbatim: "taste is a main, think of it as session 1 ... taste of camp 2 is actually an embedded. i suggest
listing them by start date, longer before shorter, just how the summer session dashboard does? AG can be listed below
its parent session. Quest next, then TLI, then SCIT (SIT and CIT) and, then FC by number."

  summer      main, embedded and AG sessions by start date, a longer session before a shorter one starting the same
              day (the sync's own priority, pocketbase/sync/sessions.go sortSessionsByPriority: duration desc, then
              name), a main before an embedded before an AG on a tie. An AG session with its parent in the list sits
              right under that parent.
  then        quests, TLI, SCIT, the teen program (Teen Winter Retreat, after SCIT), B*Mitzvah and Hebrew, family
              school, Family Camp by its number (unnumbered family sessions by date after the numbered ones), adult
              weekends, anything else.

Pure. The frontend mirror is `frontend/src/utils/sessionOrder.ts`; both run `frontend/src/utils/sessionOrder.fixture.json`
(test_session_order.py here, sessionOrder.test.ts there), so a change to one without the other fails a test.
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from datetime import date
from typing import Final, Protocol


class SessionLike(Protocol):
    @property
    def cm_id(self) -> int: ...
    @property
    def name(self) -> str: ...
    @property
    def session_type(self) -> str: ...
    @property
    def start_date(self) -> str: ...
    @property
    def end_date(self) -> str: ...
    @property
    def parent_cm_id(self) -> int: ...


# The kind groups, in the order they list. Types the table does not name sit last ("other").
KIND_ORDER: Final[tuple[tuple[str, ...], ...]] = (
    ("main", "embedded", "ag"),
    ("quest",),
    ("tli",),
    ("scit",),
    ("teen",),
    ("bmitzvah",),
    ("hebrew",),
    ("school",),
    ("family",),
    ("adult",),
)
_SUMMER_TYPE_RANK: Final = {"main": 0, "embedded": 1, "ag": 2}
_NO_DATE: Final = "9999-99-99"
_FAMILY_NUMBER = re.compile(r"family camp\s+(\d+)", re.IGNORECASE)
_UNNUMBERED: Final = 10**6


def _kind(session_type: str) -> int:
    t = session_type.strip().lower()
    for rank, types in enumerate(KIND_ORDER):
        if t in types:
            return rank
    return len(KIND_ORDER)


def _day(value: str) -> date | None:
    try:
        return date.fromisoformat(value[:10])
    except ValueError:
        return None


def _start(session: SessionLike) -> str:
    return session.start_date[:10] if _day(session.start_date) is not None else _NO_DATE


def _days(session: SessionLike) -> int:
    start, end = _day(session.start_date), _day(session.end_date)
    return (end - start).days if start is not None and end is not None else 0


def _key(session: SessionLike) -> tuple[int, int, str, int, int, str, int]:
    t = session.session_type.strip().lower()
    number = _UNNUMBERED
    if t == "family" and (m := _FAMILY_NUMBER.search(session.name)) is not None:
        number = int(m.group(1))
    return (
        _kind(t),
        number,
        _start(session),
        -_days(session),
        _SUMMER_TYPE_RANK.get(t, 0),
        session.name,
        session.cm_id,
    )


def session_order(sessions: Iterable[SessionLike]) -> list[int]:
    """The CampMinder ids of `sessions` in the Camperships order (whatever subset is in play)."""
    everyone = list(sessions)
    present = {s.cm_id for s in everyone}
    under: dict[int, list[SessionLike]] = {}
    free: list[SessionLike] = []
    for s in everyone:
        if s.session_type.strip().lower() == "ag" and s.parent_cm_id in present and s.parent_cm_id != s.cm_id:
            under.setdefault(s.parent_cm_id, []).append(s)
        else:
            free.append(s)
    out: list[int] = []
    for s in sorted(free, key=_key):
        out.append(s.cm_id)
        out.extend(a.cm_id for a in sorted(under.get(s.cm_id, []), key=_key))
    # An AG whose parent is itself an AG child (a chain) would be lost above: keep every session once.
    seen = set(out)
    out.extend(s.cm_id for s in sorted(everyone, key=_key) if s.cm_id not in seen)
    return out


def session_rank(sessions: Iterable[SessionLike]) -> dict[int, int]:
    """Each session's place in `session_order` (0 first)."""
    return {cm_id: place for place, cm_id in enumerate(session_order(sessions))}
