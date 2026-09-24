"""An adult-weekend guest's own housing-need answers (kindred#2766).

The parsers are PORTS of the Go ingest's (`pocketbase/sync/family_camp_derived.go`):
`parseBoolFieldValue`, `classifyCPAPAnswer` and the Opt Out No-pole rule. The
tables below are the Go tests' own tables (`TestBoolFieldParsing`,
`TestClassifyCPAPAnswer`), so a drift between the two ports shows up here.
The answer strings are CampMinder's real option text; every person is fictional.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest

from api.schemas.lodging import AccessibilityFlagSummary
from api.services.adult_need_answers import (
    ADULT_BATHROOM_FIELD_CM_ID,
    ADULT_CPAP_FIELD_CM_ID,
    ADULT_NEED_FIELD_CM_IDS,
    ADULT_OPT_OUT_FIELD_CM_ID,
    HOUSING_ACCOMODATION_FIELD_CM_ID,
    adult_need_flags,
    adult_need_flags_by_person,
    classify_cpap_answer,
    is_mandatory_opt_out,
    parse_bool_field_value,
)

OPT_OUT_FLEXIBLE = "Yes, please register regardless of cabin type"
OPT_OUT_MANDATORY = "No, I am only able to attend with this accommodation in place"

# The Go tests' CPAP option constants, verbatim.
CPAP_BATHROOM_OPTION = "Yes, bathroom or other housing accommodation for a medical (not CPAP related) or accessibility-related reason needed"
CPAP_BOTH_OPTION_FAMILY = (
    "Yes, we need an outlet for a CPAP machine and need a bathroom "
    "or other housing accommodation for a medical or accessibility-related reason"
)
CPAP_BOTH_OPTION_ADULT = (
    "Yes, I need an outlet for a CPAP machine and need a bathroom "
    "or other housing accommodation for a medical or accessibility-related reason"
)

# Fictional ids standing in for the sensitive fields this cohort answers best:
# Race, and a `20XX History` staff record that embeds salary.
RACE_FIELD_CM_ID = 9100001
STAFF_HISTORY_FIELD_CM_ID = 9100002


class TestTheAllowlist:
    def test_is_exactly_the_four_adult_need_fields(self) -> None:
        """⛔ Pinned. `person_custom_values` holds this cohort's Race,
        Judaism, financial aid and salary-bearing staff history -- the best
        covered fields it has. Widening this tuple is how one reaches the wire."""
        assert ADULT_NEED_FIELD_CM_IDS == (256933, 256935, 274053, 274055)
        assert ADULT_BATHROOM_FIELD_CM_ID == 274053
        assert ADULT_CPAP_FIELD_CM_ID == 256933
        assert HOUSING_ACCOMODATION_FIELD_CM_ID == 274055
        assert ADULT_OPT_OUT_FIELD_CM_ID == 256935

    def test_adult_infant_is_not_on_it(self) -> None:
        """257248's only non-"No" value is "I'm attending Men's Weekend"."""
        assert 257248 not in ADULT_NEED_FIELD_CM_IDS


class TestParseBoolFieldValue:
    """Go's `TestBoolFieldParsing`, case for case."""

    @pytest.mark.parametrize(
        ("value", "expected"),
        [
            ("Yes", True),
            ("yes", True),
            ("YES", True),
            ("True", True),
            ("true", True),
            ("1", True),
            ("y", True),
            ("No", False),
            ("no", False),
            ("NO", False),
            ("False", False),
            ("false", False),
            ("0", False),
            ("", False),
            ("N/A", False),
            ("Maybe", False),
            (OPT_OUT_FLEXIBLE, True),
            (OPT_OUT_MANDATORY, False),
            ("yes, please register regardless of cabin type", True),
            ("  Yes, please register regardless of cabin type  ", True),
            ("Yes - I need this", True),
            ("Yes I need this", True),
            ("Not yes", False),
            ("Maybe yes, maybe no", False),
            ("No, yes is not my answer", False),
            ("Yesterday", False),
        ],
    )
    def test_matches_the_go_table(self, value: str, expected: bool) -> None:
        assert parse_bool_field_value(value) is expected

    @pytest.mark.parametrize("sep", [" ", ",", ".", ";", ":", "-", "("])
    def test_every_go_separator_after_a_leading_yes_is_a_yes(self, sep: str) -> None:
        assert parse_bool_field_value(f"Yes{sep}more") is True

    def test_a_separator_outside_gos_set_is_not(self) -> None:
        assert parse_bool_field_value("Yes/No") is False


class TestClassifyCpapAnswer:
    """Go's `TestClassifyCPAPAnswer`, case for case."""

    @pytest.mark.parametrize(
        ("value", "power", "bathroom"),
        [
            pytest.param("Yes", True, False, id="bare yes is power"),
            pytest.param("Yes, outlet needed for CPAP machine", True, False, id="outlet option"),
            pytest.param(CPAP_BATHROOM_OPTION, False, True, id="bathroom option is NOT power"),
            pytest.param(CPAP_BATHROOM_OPTION.lower(), False, True, id="bathroom option lowercased"),
            pytest.param(CPAP_BOTH_OPTION_FAMILY, True, True, id="both option family wording"),
            pytest.param(CPAP_BOTH_OPTION_ADULT, True, True, id="both option adult wording"),
            pytest.param("No", False, False, id="no"),
            pytest.param("", False, False, id="unanswered"),
        ],
    )
    def test_matches_the_go_table(self, value: str, power: bool, bathroom: bool) -> None:
        answer = classify_cpap_answer(value)
        assert (answer.power, answer.bathroom) == (power, bathroom)


class TestOptOutNoPole:
    """kindred#1874's polarity trap. The "No" answer is the BLOCKER."""

    def test_the_no_answer_is_mandatory(self) -> None:
        assert is_mandatory_opt_out(OPT_OUT_MANDATORY) is True

    def test_the_yes_answer_is_flexible(self) -> None:
        assert is_mandatory_opt_out(OPT_OUT_FLEXIBLE) is False

    @pytest.mark.parametrize("value", ["", "   "])
    def test_unanswered_stays_soft(self, value: str) -> None:
        assert is_mandatory_opt_out(value) is False


class TestAdultNeedFlags:
    """Each field lights its own flag, and nothing else."""

    def test_no_answers_is_all_false(self) -> None:
        assert adult_need_flags([]) == AccessibilityFlagSummary()

    @pytest.mark.parametrize(
        ("field_cm_id", "flag"),
        [
            (ADULT_BATHROOM_FIELD_CM_ID, "needs_private_bathroom"),
            (ADULT_CPAP_FIELD_CM_ID, "needs_power"),
            (HOUSING_ACCOMODATION_FIELD_CM_ID, "needs_accommodation"),
        ],
    )
    def test_a_yes_lights_exactly_its_flag(self, field_cm_id: int, flag: str) -> None:
        flags = adult_need_flags([(field_cm_id, "Yes")])
        lit = {name for name, value in flags.model_dump().items() if value}
        assert lit == {flag}

    @pytest.mark.parametrize(
        "field_cm_id", [ADULT_BATHROOM_FIELD_CM_ID, ADULT_CPAP_FIELD_CM_ID, HOUSING_ACCOMODATION_FIELD_CM_ID]
    )
    @pytest.mark.parametrize("value", ["No", ""])
    def test_no_and_blank_are_false(self, field_cm_id: int, value: str) -> None:
        assert adult_need_flags([(field_cm_id, value)]) == AccessibilityFlagSummary()

    def test_opt_out_no_is_mandatory(self) -> None:
        flags = adult_need_flags([(ADULT_OPT_OUT_FIELD_CM_ID, OPT_OUT_MANDATORY)])
        assert flags.accommodation_is_mandatory is True

    @pytest.mark.parametrize("value", [OPT_OUT_FLEXIBLE, ""])
    def test_opt_out_yes_and_blank_are_not_mandatory(self, value: str) -> None:
        flags = adult_need_flags([(ADULT_OPT_OUT_FIELD_CM_ID, value)])
        assert flags.accommodation_is_mandatory is False

    def test_a_cpap_bathroom_option_is_a_bathroom_need_not_power(self) -> None:
        """Go routes `classifyCPAPAnswer`'s bathroom half onto the bathroom
        flag; the port does the same."""
        flags = adult_need_flags([(ADULT_CPAP_FIELD_CM_ID, CPAP_BATHROOM_OPTION)])
        assert flags.needs_private_bathroom is True
        assert flags.needs_power is False

    def test_a_cpap_no_does_not_clear_a_bathroom_yes(self) -> None:
        flags = adult_need_flags([(ADULT_BATHROOM_FIELD_CM_ID, "Yes"), (ADULT_CPAP_FIELD_CM_ID, "No")])
        assert flags.needs_private_bathroom is True

    def test_infant_fridge_and_step_free_never_light(self) -> None:
        """`has_infant` stays false on an adult guest (Adult-Infant is not
        read); there is no adult question for fridge or step-free."""
        flags = adult_need_flags([(cm_id, "Yes") for cm_id in ADULT_NEED_FIELD_CM_IDS] + [(257248, "Yes")])
        assert flags.has_infant is False
        assert flags.needs_fridge is False
        assert flags.needs_step_free is False
        assert flags.has_child_under_two is False
        assert flags.has_bed_exempt_child is False

    def test_a_field_off_the_allowlist_is_ignored(self) -> None:
        flags = adult_need_flags([(RACE_FIELD_CM_ID, "Yes"), (STAFF_HISTORY_FIELD_CM_ID, "Yes, 2025")])
        assert flags == AccessibilityFlagSummary()


def _value(person_cm_id: int, field_cm_id: int, value: str) -> Any:
    """One `person_custom_values` row, expanded as the cohort read returns it."""
    return SimpleNamespace(
        value=value,
        expand={
            "person": SimpleNamespace(cm_id=person_cm_id),
            "field_definition": SimpleNamespace(cm_id=field_cm_id),
        },
    )


class TestAdultNeedFlagsByPerson:
    def test_groups_by_the_guests_own_cm_id(self) -> None:
        by_person = adult_need_flags_by_person(
            [
                _value(1000004, ADULT_BATHROOM_FIELD_CM_ID, "Yes"),
                _value(1000005, ADULT_CPAP_FIELD_CM_ID, "Yes"),
                _value(1000005, ADULT_OPT_OUT_FIELD_CM_ID, OPT_OUT_MANDATORY),
            ]
        )

        assert by_person[1000004] == AccessibilityFlagSummary(needs_private_bathroom=True)
        assert by_person[1000005] == AccessibilityFlagSummary(needs_power=True, accommodation_is_mandatory=True)

    def test_a_row_with_no_resolvable_person_is_dropped(self) -> None:
        row = SimpleNamespace(value="Yes", expand={"field_definition": SimpleNamespace(cm_id=274053)})
        assert adult_need_flags_by_person([row]) == {}

    def test_sensitive_rows_contribute_nothing(self) -> None:
        """Defense in depth: even a row the repository should never have
        returned cannot light or create anything."""
        by_person = adult_need_flags_by_person(
            [
                _value(1000004, RACE_FIELD_CM_ID, "Yes"),
                _value(1000004, STAFF_HISTORY_FIELD_CM_ID, "Yes, counselor, $4,200 stipend"),
            ]
        )
        assert by_person.get(1000004, AccessibilityFlagSummary()) == AccessibilityFlagSummary()
