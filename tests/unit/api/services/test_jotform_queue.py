"""kindred#2759: the Jotform admin's pure logic. Fictional names only."""

from __future__ import annotations

import pytest

from api.services.jotform_queue import FormReferenceError, Question, parse_form_id, suggest_field_map


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
