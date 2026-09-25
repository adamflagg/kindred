"""kindred#2759: the Jotform admin's pure logic. Fictional names only."""

from __future__ import annotations

from dataclasses import replace
from types import SimpleNamespace

import pytest

from api.services.jotform_queue import (
    FormReferenceError,
    Question,
    QueueGuest,
    QueueSubmission,
    duplicate_groups,
    identity_from_answers,
    parse_form_id,
    same_person,
    suggest_field_map,
    suggestions_for,
)


class TestParseFormId:
    @pytest.mark.parametrize(
        "ref",
        [
            "261700000000001",
            " 261700000000001 ",
            "https://form.jotform.com/261700000000001",
            "https://www.jotform.com/build/261700000000001",
            "https://www.jotform.com/inbox/261700000000001?submission=1",
            "www.jotform.com/build/261700000000001/publish",
        ],
    )
    def test_an_id_or_any_link_carrying_it(self, ref: str) -> None:
        assert parse_form_id(ref) == "261700000000001"

    def test_a_vanity_url_is_refused_with_a_pointer_to_the_id(self) -> None:
        # Review Focus 4: the real 2026 forms' public links carry NO id.
        with pytest.raises(FormReferenceError, match="builder"):
            parse_form_id("https://form.jotform.com/SomeCamp/Womens-Weekend-2026")

    def test_blank_is_refused(self) -> None:
        with pytest.raises(FormReferenceError):
            parse_form_id("   ")


QUESTIONS_2026_SHAPE = [
    Question("3", "First Name", "control_textbox", 3),
    Question("4", "Last Name", "control_textbox", 4),
    Question("5", "Preferred name for your nametag (if different than above): ", "control_textbox", 5),
    Question("10", "Emergency Contact: First and Last Name", "control_fullname", 10),
    Question("12", "Emergency Contact: Phone Number ", "control_phone", 12),
    Question("13", "Emergency Contact: Email", "control_email", 13),
    Question("16", "Who are you coming to this program with? ", "control_checkbox", 16),
    Question(
        "21",
        "We can accommodate up to eight people per cabin. If you have a bunking request, please list "
        "their first and last name(s) here (up to five people). ",
        "control_textarea",
        21,
    ),
    Question(
        "22",
        "Our typical cabins are shared. Do you need special housing accommodation(s) for medical, "
        "accessibility-related or personal reasons?",
        "control_radio",
        22,
    ),
    Question(
        "23",
        "If yes, please comment below (ie: request to live alone, live close to the primary program area).",
        "control_textarea",
        23,
    ),
    Question("27", "If yes, please list the allergy and reaction: ", "control_textarea", 27),
    Question("29", "Are you bringing a CPAP machine to Camp? ", "control_radio", 29),
    Question("50", "Email", "control_email", 50),
]


class TestSuggestFieldMap:
    def test_every_role_is_suggested_from_the_2026_labels(self) -> None:
        assert suggest_field_map(QUESTIONS_2026_SHAPE) == {
            "first_name": "3",
            "last_name": "4",
            "nametag_name": "5",
            "respondent_email": "50",
            "bunking_request": "21",
            "coming_with": "16",
            "emergency_name": "10",
            "emergency_phone": "12",
            "emergency_email": "13",
            "housing_accommodation": "22",
            "accommodation_details": "23",
            "cpap": "29",
        }

    def test_a_single_fullname_question_serves_first_and_last(self) -> None:
        suggested = suggest_field_map([Question("4", "Name", "control_fullname", 4)])
        assert (suggested["first_name"], suggested["last_name"]) == ("4", "4")

    def test_nothing_recognisable_suggests_nothing(self) -> None:
        assert suggest_field_map([Question("7", "Favourite colour", "control_textbox", 7)]) == {}


S = 1000002
PHONE = "555-555-0100"


def _g(cm: int, first: str, last: str, preferred: str = "") -> QueueGuest:
    return QueueGuest(person_cm_id=cm, session_cm_id=S, first=first, preferred=preferred, last=last)


def _s(rid: str, first: str, last: str, **kw: object) -> QueueSubmission:
    return QueueSubmission(
        record_id=rid,
        submission_id=f"66{rid}",
        session_cm_id=S,
        submitted_at=str(kw.pop("submitted_at", "2026-08-31 09:00:00")),
        first=first,
        last=last,
        **kw,  # type: ignore[arg-type]
    )


OLIVIA = _g(1000004, "Olivia", "Chen")
EMMA = _g(1000005, "Emma", "Johnson")
LIAM = _g(1000006, "Liam", "Garcia")
OLIVIA_FILED = _s("oc", "Olivia", "Chen", emergency_phone=PHONE, match_status="auto", person_cm_id=1000004)
LIAM_FILED = _s("lg", "Liam", "Garcia", emergency_email="test@example.com", match_status="auto", person_cm_id=1000006)


class TestLabels:
    def test_a_near_name_with_no_submission_is_did_you_mean(self) -> None:  # a dropped letter
        sub = _s("u1", "Emma", "Ohnson")
        [suggestion] = suggestions_for(sub, [OLIVIA, EMMA, LIAM], [OLIVIA_FILED, LIAM_FILED, sub])
        assert (suggestion.kind, suggestion.label, suggestion.person_cm_id) == (
            "did_you_mean",
            "Did you mean Emma Johnson?",
            1000005,
        )

    def test_a_typo_sharing_the_emergency_contact_is_a_likely_duplicate(self) -> None:  # a typo plus a shared contact
        sub = _s("u2", "Olivia", "Chenn", emergency_phone="(555) 555-0100")
        [suggestion] = suggestions_for(sub, [OLIVIA, EMMA], [OLIVIA_FILED, sub])
        assert suggestion.kind == "likely_duplicate"
        assert suggestion.label == "Likely a duplicate of Olivia Chen's submission (typo)"

    def test_a_similar_name_whose_guest_already_filed_is_probably_different(
        self,
    ) -> None:  # a similar name, different person
        sub = _s("u3", "Olivia", "Chan", emergency_phone="555-555-0199")
        [suggestion] = suggestions_for(sub, [OLIVIA, EMMA], [OLIVIA_FILED, sub])
        assert suggestion.kind == "probably_different"
        assert suggestion.label == (
            "Similar name, but Olivia Chen already has a submission; probably a different person"
        )

    def test_a_strong_signal_is_flagged_even_when_the_names_differ(self) -> None:  # a middle name typed as the surname
        sub = _s("u4", "Liam", "Riley", emergency_email="TEST@example.com")
        [suggestion] = suggestions_for(sub, [OLIVIA, EMMA, LIAM], [OLIVIA_FILED, LIAM_FILED, sub])
        assert suggestion.kind == "likely_duplicate"
        assert suggestion.person_cm_id == 1000006
        assert suggestion.other_submission_id == "66lg"
        assert suggestion.label == "Likely a duplicate of Liam Garcia's submission"

    def test_an_emergency_contact_alone_is_not_a_signal(self) -> None:
        # Relatives list each other: a shared contact with a DIFFERENT first name is nobody.
        sub = _s("u5", "Riley", "Sam", emergency_phone=PHONE)
        assert suggestions_for(sub, [OLIVIA], [OLIVIA_FILED, sub]) == []


class TestRanking:
    JOHNSTON = _g(1000008, "Emma", "Johnston")
    JOHNSTON_FILED = _s(
        "ej", "Emma", "Johnston", emergency_phone="555-555-0177", match_status="auto", person_cm_id=1000008
    )

    def test_did_you_mean_ranks_above_probably_different(self) -> None:
        sub = _s("u6", "Emma", "Johnsen")
        kinds = [s.kind for s in suggestions_for(sub, [EMMA, self.JOHNSTON], [self.JOHNSTON_FILED, sub])]
        assert kinds == ["did_you_mean", "probably_different"]

    def test_a_guest_named_in_the_submissions_own_request_is_demoted(self) -> None:
        sub = _s("u7", "Emma", "Johnsen", bunking_request="Emma Johnson, Riley Sam")
        suggestions = suggestions_for(sub, [EMMA, self.JOHNSTON], [self.JOHNSTON_FILED, sub])
        assert [(s.person_cm_id, s.demoted) for s in suggestions] == [(1000008, False), (1000005, True)]


class TestSamePerson:
    def test_identical_names_are_one_person(self) -> None:
        assert same_person(_s("a", "Emma", "Johnson"), _s("b", "emma", "JOHNSON")) == "identical name"

    def test_a_shared_contact_plus_a_nickname_first_name(self) -> None:
        a = _s("a", "Samuel", "Johnson", emergency_email="test@example.com")
        b = _s("b", "Sam", "Jonson", emergency_email="test@example.com")
        assert same_person(a, b) is not None


class TestIdentityFromAnswers:
    def test_fullname_parts_and_plain_answers(self) -> None:
        answers = {
            "4": SimpleNamespace(
                question_type="control_fullname",
                answer_text="Olivia Chen",
                answer_json={"first": "Olivia", "last": "Chen"},
            ),
            "12": SimpleNamespace(question_type="control_phone", answer_text=PHONE, answer_json=None),
        }
        identity = identity_from_answers(answers, {"first_name": "4", "last_name": "4", "emergency_phone": "12"})
        assert (identity["first"], identity["last"], identity["emergency_phone"]) == ("Olivia", "Chen", PHONE)
        assert identity["nametag"] == ""


class TestDuplicateGroups:
    def test_guests_with_two_or_more_live_filings_show_their_change(self) -> None:
        subs = [
            _s(
                "d1",
                "Olivia",
                "Chen",
                submitted_at="2026-08-03 09:00:00",
                bunking_request="Emma Johnson",
                match_status="auto",
                person_cm_id=1000004,
            ),
            _s(
                "d2",
                "Olivia",
                "Chen",
                submitted_at="2026-08-31 09:00:00",
                bunking_request="Emma Johnson, Liam Garcia",
                match_status="staff",
                person_cm_id=1000004,
            ),
            _s("d3", "Emma", "Johnson", match_status="auto", person_cm_id=1000005),
        ]
        [group] = duplicate_groups(subs, [OLIVIA, EMMA])
        assert (group.person_cm_id, group.guest_name, group.change_kind) == (1000004, "Olivia Chen", "list")
        assert [s.submission_id for s in group.submissions] == ["66d1", "66d2"]

    def test_one_filing_at_each_of_two_weekends_is_not_a_duplicate(self) -> None:
        # A guest enrolled in two adult weekends files once for each: two
        # weekends' requests, not one guest re-filing. Diffing them against
        # each other would invent a change.
        ww = _s("w1", "Olivia", "Chen", bunking_request="Emma Johnson", match_status="auto", person_cm_id=1000004)
        mw = replace(
            _s("m1", "Olivia", "Chen", bunking_request="Liam Garcia", match_status="auto", person_cm_id=1000004),
            session_cm_id=1000003,
        )
        assert duplicate_groups([ww, mw], [OLIVIA]) == []

    def test_a_group_holds_only_one_weekends_filings(self) -> None:
        first = _s(
            "w1", "Olivia", "Chen", submitted_at="2026-08-03 09:00:00", match_status="auto", person_cm_id=1000004
        )
        second = _s(
            "w2", "Olivia", "Chen", submitted_at="2026-08-31 09:00:00", match_status="auto", person_cm_id=1000004
        )
        other_weekend = replace(
            _s("m1", "Olivia", "Chen", submitted_at="2026-09-10 09:00:00", match_status="auto", person_cm_id=1000004),
            session_cm_id=1000003,
        )
        [group] = duplicate_groups([first, second, other_weekend], [OLIVIA])
        assert group.session_cm_id == S
        assert [s.submission_id for s in group.submissions] == ["66w1", "66w2"]
