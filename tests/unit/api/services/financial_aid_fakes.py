"""Shared fixtures for the campership intake tests (sub-project 5).

Fictional data only: generic session names, and person/household ids from
1000001 up (tests/CLAUDE.md). Nothing here is, or resembles, a real family.
"""

from __future__ import annotations

from api.services.financial_aid_intake_types import SessionRow

YEAR = 2027

# The fourth field is the session's first day (camp_sessions.start_date); the
# infant cutoff is measured on it (spec 2 item 22).
SESSIONS: tuple[SessionRow, ...] = (
    SessionRow(1000101, "Session 2", "main", "2027-06-20"),
    SessionRow(1000102, "Session 2a", "embedded", "2027-06-20"),
    SessionRow(1000103, "All-Gender Cabin-Session 2 (7th & 8th grades)", "ag", "2027-06-20"),
    SessionRow(1000104, "Taste of Camp 1", "main", "2027-06-13"),
    SessionRow(1000105, "Taste of Camp 2", "embedded", "2027-07-25"),
    SessionRow(1000106, "River `n` Ridge Quest", "quest", "2027-07-05"),
    SessionRow(1000107, "Counselor In-Training", "scit", "2027-06-20"),
    SessionRow(1000108, "Specialist In-Training", "scit", "2027-06-20"),
    SessionRow(1000201, "Family Camp 3: Riverside Weekend (w/ kids 10 and under)", "family", "2027-05-28"),
    SessionRow(1000202, "Family Camp 6", "family", "2027-08-20"),
    SessionRow(1000301, "The Camp's B*Mitzvah Program Year 1 - North", "bmitzvah", "2027-01-10"),
    SessionRow(1000401, "Adult Weekend A", "adult", "2027-09-10"),
    SessionRow(1000402, "Adult Weekend B", "adult", "2027-09-24"),
)
