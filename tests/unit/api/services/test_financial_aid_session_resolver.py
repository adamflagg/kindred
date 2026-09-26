"""FA option text -> CampMinder session (campership sub-project 5, spec 9.1)."""

from __future__ import annotations

from api.services.financial_aid_intake_types import AliasRow, SessionResolution
from api.services.financial_aid_session_resolver import (
    normalize_option_text,
    resolve_adult_session,
    resolve_session,
)
from tests.unit.api.services.financial_aid_fakes import SESSIONS


def test_exact_match_ignores_case_and_spacing() -> None:
    assert resolve_session("  session   2 ", "summer", SESSIONS, (), frozenset()) == SessionResolution(
        1000101, "exact", (1000101,)
    )


def test_session_2_never_matches_session_2a() -> None:
    assert resolve_session("Session 2", "summer", SESSIONS, (), frozenset({1000102})).session_cm_id == 1000101


def test_typographic_quotes_and_spacing_still_match() -> None:  # Review Focus 1
    for text in ("River ’n’ Ridge Quest", "River 'n' Ridge Quest", "RIVER  `n` ridge quest"):
        assert resolve_session(text, "summer", SESSIONS, (), frozenset()) == SessionResolution(
            1000106, "exact", (1000106,)
        ), text
    assert normalize_option_text("River ’n’  Ridge") == "river 'n' ridge"


def test_option_text_inside_a_longer_session_name_matches() -> None:
    assert resolve_session("Family Camp 3: Riverside Weekend", "family_camp", SESSIONS, (), frozenset()) == (
        SessionResolution(1000201, "contains", (1000201,))
    )
    assert (
        resolve_session("B*Mitzvah Program Year 1 - North", "bmitzvah", SESSIONS, (), frozenset()).session_cm_id
        == 1000301
    )


def test_an_ambiguous_name_is_decided_by_registration() -> None:
    result = resolve_session("Taste of Camp", "summer", SESSIONS, (), frozenset({1000105}))
    assert result == SessionResolution(1000105, "enrollment", (1000104, 1000105))


def test_an_option_covering_two_sessions_needs_registration_to_decide() -> None:  # Review Focus 2
    key = normalize_option_text("Specialist and Counselor In-Training")
    aliases = (AliasRow("summer", key, 1000107), AliasRow("summer", key, 1000108))
    neither = resolve_session("Specialist and Counselor In-Training", "summer", SESSIONS, aliases, frozenset())
    both = resolve_session(
        "Specialist and Counselor In-Training", "summer", SESSIONS, aliases, frozenset({1000107, 1000108})
    )
    one = resolve_session("Specialist and Counselor In-Training", "summer", SESSIONS, aliases, frozenset({1000108}))
    assert neither == SessionResolution(0, "unmatched", (1000107, 1000108))
    assert both == SessionResolution(0, "unmatched", (1000107, 1000108))
    assert one == SessionResolution(1000108, "enrollment", (1000107, 1000108))


def test_an_alias_beats_name_matching() -> None:
    aliases = (AliasRow("summer", normalize_option_text("Session 2 (All-Gender Cabin)"), 1000103),)
    assert resolve_session("Session 2 (All-Gender Cabin)", "summer", SESSIONS, aliases, frozenset()) == (
        SessionResolution(1000103, "alias", (1000103,))
    )


def test_an_alias_outside_the_program_is_ignored() -> None:
    aliases = (AliasRow("summer", normalize_option_text("Weekend Six"), 1000202),)
    assert resolve_session("Weekend Six", "summer", SESSIONS, aliases, frozenset()).session_cm_id == 0


def test_a_session_from_another_program_never_matches() -> None:
    assert resolve_session("Family Camp 6", "summer", SESSIONS, (), frozenset({1000202})) == SessionResolution(
        0, "unmatched", ()
    )


def test_an_unknown_or_blank_option_is_unmatched_never_defaulted() -> None:
    assert resolve_session("Session 9", "summer", SESSIONS, (), frozenset({1000101})) == SessionResolution(
        0, "unmatched", ()
    )
    assert resolve_session("   ", "summer", SESSIONS, (), frozenset({1000101})).session_cm_id == 0


def test_an_adult_request_takes_the_one_adult_weekend_the_person_registered_for() -> None:
    assert resolve_adult_session(SESSIONS, frozenset({1000401, 1000101})) == SessionResolution(
        1000401, "enrollment", (1000401,)
    )
    assert resolve_adult_session(SESSIONS, frozenset({1000401, 1000402})) == SessionResolution(
        0, "unmatched", (1000401, 1000402)
    )
    assert resolve_adult_session(SESSIONS, frozenset()) == SessionResolution(0, "unmatched", ())
