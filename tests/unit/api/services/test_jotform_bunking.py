"""kindred#2759: the Jotform bunking-request change rule, computed server-side.

Fictional names only (tests/CLAUDE.md).
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest

from api.schemas.lodging import BunkingRequestVersion
from api.services.adult_need_answers import ADULT_CPAP_FIELD_CM_ID, HOUSING_ACCOMODATION_FIELD_CM_ID
from api.services.jotform_bunking import (
    JotformBunkingRows,
    JotformFiling,
    build_bunking_request,
    coming_with_tokens,
    diff_items,
    filings_by_person,
    is_name_shaped,
    jotform_need_disagreements,
    normalize_request,
    request_changed,
    request_items,
    resolve_change,
)


def _v(date: str, text: str) -> BunkingRequestVersion:
    return BunkingRequestVersion(submitted_at=f"2026-{date} 09:00:00", text=normalize_request(text))


class TestNormalisation:
    @pytest.mark.parametrize("text", ["no request", "No preference.", "N/A", "none", "no", "-", "No requests", "  "])
    def test_no_request_words_mean_no_request(self, text: str) -> None:
        assert normalize_request(text) == ""

    def test_a_name_is_kept_verbatim_but_trimmed(self) -> None:
        assert normalize_request("  Emma Johnson ") == "Emma Johnson"


class TestItems:
    def test_splits_on_every_ruled_separator(self) -> None:
        text = "Emma Johnson, Liam Garcia; Riley Sam / Olivia Chen & Samuel Johnson\nOlivia Kim and Emma Patel."
        assert request_items(text) == [
            "Emma Johnson",
            "Liam Garcia",
            "Riley Sam",
            "Olivia Chen",
            "Samuel Johnson",
            "Olivia Kim",
            "Emma Patel",
        ]

    def test_a_shared_surname_is_not_repaired(self) -> None:
        # The known, accepted edge (spec §6): nothing resolves names in 2026.
        assert request_items("Emma and Olivia Chen") == ["Emma", "Olivia Chen"]

    @pytest.mark.parametrize(
        ("text", "shaped"),
        [
            ("Emma Johnson, Liam Garcia", True),
            ("", True),
            ("I would love to room with Emma", False),
            ("Whoever is quiet", False),
            ("whomever", False),
            ("Not sure yet", False),
            ("Emma Johnson Garcia Kim Patel", False),  # more than 4 words
            ("Please put me near Liam", False),
        ],
    )
    def test_name_shape(self, text: str, shaped: bool) -> None:
        assert is_name_shaped(text) is shaped


class TestDiff:
    def test_add_remove_respell_and_a_drop_keeps_its_position(self) -> None:
        items = diff_items(
            ["Emma Johnson", "Liam Garcia", "Riley Sam"],
            ["Emma Johnson", "Riley Samm", "Olivia Chen"],
        )
        assert [(i.text, i.op, i.was) for i in items] == [
            ("Emma Johnson", "keep", ""),
            ("Liam Garcia", "remove", ""),
            ("Riley Samm", "respell", "Sam"),
            ("Olivia Chen", "add", ""),
        ]

    def test_respell_shows_only_the_words_that_moved(self) -> None:
        items = diff_items(["Emma Johnston"], ["Emma Johnson"])
        assert [(i.op, i.was) for i in items] == [("respell", "Johnston")]

    def test_a_shortened_surname_reads_as_a_respelling(self) -> None:
        # The measured edge: a double-barrelled surname cut to one part passes 0.88.
        items = diff_items(["Olivia Chen-Garcia"], ["Olivia Chen"])
        assert items[0].op == "respell"

    def test_unrelated_names_are_a_remove_plus_an_add(self) -> None:
        items = diff_items(["Liam Garcia"], ["Olivia Chen"])
        assert sorted((i.op, i.text) for i in items) == [("add", "Olivia Chen"), ("remove", "Liam Garcia")]


class TestResolveChange:
    def test_one_filing_has_no_change(self) -> None:
        assert resolve_change([_v("08-03", "Emma Johnson")]) is None

    def test_identical_filings_ignore_separators_and_case(self) -> None:
        change = resolve_change([_v("08-03", "Emma Johnson, Liam Garcia"), _v("08-31", "emma johnson / Liam Garcia")])
        assert change is not None
        assert (change.kind, change.count, change.from_date[:10], change.to_date[:10]) == (
            "identical",
            2,
            "2026-08-03",
            "2026-08-31",
        )

    def test_name_lists_diff_first_against_current(self) -> None:
        change = resolve_change(
            [
                _v("08-03", "Emma Johnson, Liam Garcia"),
                _v("08-20", "Emma Johnson"),
                _v("09-16", "Emma Johnson, Olivia Chen"),
            ]
        )
        assert change is not None
        assert change.kind == "list"
        assert [(i.text, i.op) for i in change.items] == [
            ("Emma Johnson", "keep"),
            ("Liam Garcia", "remove"),
            ("Olivia Chen", "add"),
        ]
        assert (change.from_date[:10], change.to_date[:10]) == ("2026-08-03", "2026-09-16")

    def test_any_prose_version_falls_back_to_every_version(self) -> None:
        versions = [_v("08-03", "Emma Johnson"), _v("08-31", "I'd love to be with Emma Johnson if possible")]
        change = resolve_change(versions)
        assert change is not None
        assert change.kind == "prose"
        assert [v.text for v in change.versions] == [v.text for v in versions]

    def test_a_later_blank_refile_shows_the_requested_names_removed(self) -> None:
        # Review Focus 1, owner ruling 2026-09-24: the newer filing is current
        # even when blank; the previously requested people show as removed.
        change = resolve_change([_v("08-03", "Emma Johnson, Liam Garcia"), _v("08-31", "")])
        assert change is not None
        assert change.kind == "list"
        assert [(i.text, i.op) for i in change.items] == [("Emma Johnson", "remove"), ("Liam Garcia", "remove")]
        assert (change.from_date[:10], change.to_date[:10]) == ("2026-08-03", "2026-08-31")

    def test_a_blank_refile_after_prose_falls_back_to_versions(self) -> None:
        change = resolve_change([_v("08-03", "I'd love to be with Emma Johnson if possible"), _v("08-31", "")])
        assert change is not None
        assert change.kind == "prose"
        assert [v.text for v in change.versions] == ["I'd love to be with Emma Johnson if possible", ""]


class TestComingWith:
    def test_checkbox_json_is_read_in_the_ruled_order(self) -> None:
        assert coming_with_tokens("", ["With Friends", "With Family"]) == ["family", "friends"]

    def test_text_fallback_and_every_option(self) -> None:
        assert coming_with_tokens("Solo, With Friends", None) == ["solo", "friends"]
        assert coming_with_tokens("With a Partner", None) == ["partner"]
        assert coming_with_tokens("", None) == []


class TestChanged:
    """P15 (owner, 2026-09-24): the card's amber dot reads `changed`, true when
    ANY two consecutive filings differ; the panel markup stays the NET change
    between the first and latest filings."""

    def test_a_request_that_moves_and_moves_back_is_changed_with_no_net_markup(self) -> None:
        versions = [
            _v("08-03", "Emma Johnson"),
            _v("08-20", "Emma Johnson, Liam Garcia"),
            _v("09-16", "Emma Johnson"),
        ]
        assert request_changed(versions) is True
        change = resolve_change(versions)
        assert change is not None
        assert change.kind == "list"
        assert [(i.text, i.op) for i in change.items] == [("Emma Johnson", "keep")]
        assert (change.from_date[:10], change.to_date[:10]) == ("2026-08-03", "2026-09-16")

    def test_identical_filings_are_not_changed(self) -> None:
        versions = [_v("08-03", "Emma Johnson, Liam Garcia"), _v("08-31", "emma johnson / Liam Garcia")]
        assert request_changed(versions) is False

    def test_one_filing_is_not_changed(self) -> None:
        assert request_changed([_v("08-03", "Emma Johnson")]) is False
        assert request_changed([]) is False

    def test_a_blank_refile_is_changed(self) -> None:
        assert request_changed([_v("08-03", "Emma Johnson"), _v("08-31", "no request")]) is True

    def test_two_blank_filings_are_not_changed(self) -> None:
        assert request_changed([_v("08-03", "none"), _v("08-31", "")]) is False


SESSION = 1000002
FIELD_MAP = {
    "bunking_request": "21",
    "coming_with": "16",
    "housing_accommodation": "22",
    "accommodation_details": "23",
    "cpap": "29",
}


def _sub(record_id: str, submission_id: str, person: int, date: str, **kw: Any) -> SimpleNamespace:
    return SimpleNamespace(
        id=record_id,
        submission_id=submission_id,
        form="form_ww",
        session_cm_id=kw.get("session_cm_id", SESSION),
        person_cm_id=person,
        submitted_at=f"2026-{date} 09:00:00",
        match_status=kw.get("match_status", "auto"),
        jotform_status=kw.get("jotform_status", "ACTIVE"),
    )


def _ans(record_id: str, qid: str, text: str, answer_json: Any = None) -> SimpleNamespace:
    return SimpleNamespace(submission=record_id, question_id=qid, answer_text=text, answer_json=answer_json)


def _rows(subs: list[SimpleNamespace], answers: list[SimpleNamespace]) -> JotformBunkingRows:
    return JotformBunkingRows(
        forms=[SimpleNamespace(id="form_ww", session_cm_id=SESSION, field_map=FIELD_MAP)],
        submissions=subs,
        answers=answers,
    )


class TestFilingsByPerson:
    def test_groups_live_matched_filings_by_guest_oldest_first(self) -> None:
        rows = _rows(
            [
                _sub("r2", "6600000000000000002", 1000004, "08-31", match_status="staff"),
                _sub("r1", "6600000000000000001", 1000004, "08-03"),
                _sub("r3", "6600000000000000003", 1000005, "08-05", jotform_status="DELETED"),
                _sub("r4", "6600000000000000004", 1000006, "08-06", session_cm_id=1000099),
                _sub("r5", "6600000000000000005", 0, "08-07", match_status="unmatched"),
            ],
            [
                _ans("r1", "21", "Emma Johnson"),
                _ans("r2", "21", "Emma Johnson, Liam Garcia"),
                _ans("r2", "16", "With Family; With Friends", ["With Family", "With Friends"]),
                _ans("r2", "22", "Yes"),
                _ans("r2", "99", "an unmapped answer"),
            ],
        )
        filings = filings_by_person(rows, session_cm_id=SESSION)
        assert list(filings) == [1000004]
        olivia = filings[1000004]
        assert [f.submission_id for f in olivia] == ["6600000000000000001", "6600000000000000002"]
        assert olivia[1].coming_with == ("family", "friends")
        assert olivia[1].housing_accommodation == "Yes"
        assert olivia[1].staff_linked is True


class TestBuildBunkingRequest:
    def _f(self, date: str, text: str, **kw: Any) -> JotformFiling:
        return JotformFiling(
            submission_id=f"66{date}", submitted_at=f"2026-{date} 09:00:00", bunking_request=text, **kw
        )

    def test_no_filings_is_no_form(self) -> None:
        assert build_bunking_request([]).state == "no_form"

    def test_a_typed_no_request_is_none(self) -> None:
        summary = build_bunking_request([self._f("08-03", "no request")])
        assert (summary.state, summary.current_text) == ("none", "")

    def test_request_with_history_and_coming_with(self) -> None:
        summary = build_bunking_request(
            [
                self._f("08-03", "Emma Johnson"),
                self._f("08-31", "Emma Johnson, Liam Garcia", coming_with=("solo", "friends")),
            ]
        )
        assert summary.state == "request"
        assert summary.current_text == "Emma Johnson, Liam Garcia"
        assert summary.change is not None
        assert summary.change.kind == "list"
        assert summary.coming_with == ["solo", "friends"]
        assert [s[:10] for s in summary.submitted] == ["2026-08-03", "2026-08-31"]

    def test_blank_latest_filing_is_current_and_muted(self) -> None:
        # Owner ruling 2026-09-24: a newer blank filing is current; the earlier
        # requestees show as removed.
        summary = build_bunking_request([self._f("08-03", "Emma Johnson"), self._f("08-31", "")])
        assert (summary.state, summary.current_text) == ("none", "")
        assert summary.change is not None
        assert summary.change.kind == "list"
        assert [(i.text, i.op) for i in summary.change.items] == [("Emma Johnson", "remove")]

    def test_a_request_that_moved_and_moved_back_is_changed(self) -> None:
        # P15: the amber dot reads `changed`; the net markup is all keep.
        summary = build_bunking_request(
            [
                self._f("08-03", "Emma Johnson"),
                self._f("08-20", "Emma Johnson, Liam Garcia"),
                self._f("09-16", "Emma Johnson"),
            ]
        )
        assert summary.changed is True
        assert summary.change is not None
        assert summary.change.kind == "list"
        assert [(i.text, i.op) for i in summary.change.items] == [("Emma Johnson", "keep")]

    def test_identical_refiles_are_not_changed(self) -> None:
        summary = build_bunking_request(
            [self._f("08-03", "Emma Johnson, Liam Garcia"), self._f("08-31", "emma johnson; Liam Garcia")]
        )
        assert summary.changed is False
        assert summary.change is not None
        assert summary.change.kind == "identical"

    def test_a_single_filing_is_not_changed(self) -> None:
        assert build_bunking_request([self._f("08-03", "Emma Johnson")]).changed is False

    def test_a_blank_refile_is_changed(self) -> None:
        assert build_bunking_request([self._f("08-03", "Emma Johnson"), self._f("08-31", "")]).changed is True


class TestNeedDisagreements:
    def _latest(self, **kw: Any) -> JotformFiling:
        return JotformFiling(submission_id="66", submitted_at="2026-08-31 09:00:00", **kw)

    def test_accommodation_yes_on_jotform_no_at_registration(self) -> None:
        says = jotform_need_disagreements(
            self._latest(housing_accommodation="Yes", accommodation_details="Near a bathroom, please"),
            {HOUSING_ACCOMODATION_FIELD_CM_ID: "No"},
        )
        assert [(s.need, s.registration, s.jotform, s.detail) for s in says] == [
            ("accommodation", "No", "Yes", "Near a bathroom, please")
        ]

    def test_a_blank_registration_is_named_blank(self) -> None:
        says = jotform_need_disagreements(self._latest(housing_accommodation="Yes"), {})
        assert [(s.registration, s.jotform) for s in says] == [("blank", "Yes")]

    def test_cpap_power_need_the_registration_missed(self) -> None:
        says = jotform_need_disagreements(self._latest(cpap="Yes"), {ADULT_CPAP_FIELD_CM_ID: "No"})
        assert [(s.need, s.registration, s.jotform) for s in says] == [("cpap", "No", "Yes")]

    def test_agreement_and_unanswered_questions_say_nothing(self) -> None:
        assert jotform_need_disagreements(self._latest(housing_accommodation="No"), {}) == []
        assert (
            jotform_need_disagreements(
                self._latest(housing_accommodation="Yes"), {HOUSING_ACCOMODATION_FIELD_CM_ID: "Yes"}
            )
            == []
        )
        assert jotform_need_disagreements(self._latest(), {HOUSING_ACCOMODATION_FIELD_CM_ID: "Yes"}) == []
