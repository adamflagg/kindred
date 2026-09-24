"""An adult-weekend guest's housing needs, from the guest's OWN answers (kindred#2766).

An adult weekend places PERSONS, and the need questions are asked of each
person on the adult registration form. Their answers live in
`person_custom_values` at person grain; nothing derives them into a table the
roster could read, so this module reads the four raw answers and keeps only
their booleans.

⚠️ A DELIBERATE DIVERGENCE from `LodgingRosterService._build_flags`' "one
writer, one reader -- fix it in the ingest layer" contract. That contract is
for household-grain flags, which the Go ingest derives into
`family_camp_registrations`. There is no person-grain derived table, and the
household row is the WRONG source for a guest: about a third of adult-cohort
households have one, 27% of a measured sample were false positives (the answer
belonged to a different weekend, or a different person), and two guests from
one household would share one flag.

So the parsers below are PORTS, not new rules. Each mirrors
`pocketbase/sync/family_camp_derived.go` exactly -- `parseBoolFieldValue`,
`classifyCPAPAnswer`, and the Opt Out No-pole arm of `processRegistrations` --
and `tests/unit/api/services/test_adult_need_answers.py` carries the Go tests'
own tables so the two ports cannot drift silently. If one changes, change both.

Kept OUT of `lodging_rules.py` on purpose (triage cross-check, 2026-09-23): that
module is shared with other open work, and nothing here is a lodging rule --
it is an answer parser.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any

from api.schemas.lodging import AccessibilityFlagSummary

# The four adult-registration need questions, by CampMinder custom-field id.
# Owner ruling 2026-09-23: verified as ADULT-WEEKEND questions by who answered
# them -- every 2026 answer came from an adult-weekend registrant, none from a
# family-camp attendee. (CampMinder's "Adult" partition tag names the person
# type, not the program, so the tag alone does not prove it.)
ADULT_CPAP_FIELD_CM_ID = 256933  # "Adult-CPAP"
ADULT_OPT_OUT_FIELD_CM_ID = 256935  # "Adult-Opt Out"
ADULT_BATHROOM_FIELD_CM_ID = 274053  # "Adult-Bathroom" (new in 2026)
HOUSING_ACCOMODATION_FIELD_CM_ID = 274055  # "Housing Accomodation" (sic, one m; new in 2026)

# ⛔ AN ALLOWLIST, NOT A FILTER TO TIDY UP LATER. `person_custom_values` holds
# this cohort's Race, Folks of Color, Judaism, financial aid and `20XX History`
# staff records (which embed SALARY) -- the best-covered fields it has. The
# cohort read names these four ids and nothing else, and a test pins the tuple.
#
# NOT on it, deliberately:
#   * Adult-Infant (257248). Its only non-"No" value is the literal "I'm
#     attending Men's Weekend", so `has_infant` stays false for a guest -- see
#     `adult_need_flags`.
#   * Any free-text answer. Only booleans travel on the roster; narrative stays
#     behind `Permission.BUNKING_MANAGE`, as the family-camp medical read does.
ADULT_NEED_FIELD_CM_IDS: tuple[int, ...] = (
    ADULT_CPAP_FIELD_CM_ID,
    ADULT_OPT_OUT_FIELD_CM_ID,
    ADULT_BATHROOM_FIELD_CM_ID,
    HOUSING_ACCOMODATION_FIELD_CM_ID,
)

# Go's `parseBoolFieldValue` bare tokens and leading-"yes" separators.
_BARE_TRUE = frozenset({"yes", "true", "1", "y"})
_YES = "yes"
_YES_SEPARATORS = frozenset(" ,.;:-(")


def parse_bool_field_value(value: str) -> bool:
    """Port of Go's `parseBoolFieldValue`: a leading-"yes" ANCHOR, never a
    substring and never `!= "No"`.

    CampMinder single-selects store the whole option text, so a yes/no can
    arrive as a sentence: "Yes, please register regardless of cabin type" is
    true, "No, I am only able to attend with this accommodation in place" is
    false. "Not yes", "No, yes is not my answer" and "Yesterday" are all false.
    """
    lower = value.strip().lower()
    if lower in _BARE_TRUE:
        return True
    if not lower.startswith(_YES):
        return False
    rest = lower[len(_YES) :]
    return rest == "" or rest[0] in _YES_SEPARATORS


@dataclass(frozen=True)
class CpapAnswer:
    power: bool = False
    bathroom: bool = False


def classify_cpap_answer(value: str) -> CpapAnswer:
    """Port of Go's `classifyCPAPAnswer`.

    The CPAP question is a multi-option select whose every option starts "Yes",
    and the qualifier says WHICH need: an outlet, a bathroom ("not CPAP
    related"), or both. The two are tested independently so the both-option
    keeps its outlet. A bare "Yes" names neither and means power -- the field
    is named CPAP -- and does not also infer a bathroom.
    """
    if not parse_bool_field_value(value):
        return CpapAnswer()
    lower = value.lower()
    bathroom = "bathroom" in lower
    power = "outlet" in lower or "cpap machine" in lower
    if not bathroom and not power:
        power = True
    return CpapAnswer(power=power, bathroom=bathroom)


def is_mandatory_opt_out(value: str) -> bool:
    """The Opt Out answer's NO pole (Go's Opt Out arm, kindred#1874).

    "No, I am only able to attend with this accommodation in place" is the
    blocker and reads TRUE. "Yes, please register regardless of cabin type" is
    the flexible pole, and an unanswered question must stay soft -- which is
    why this keys off a non-empty value and not off the parse alone.
    """
    return value.strip() != "" and not parse_bool_field_value(value)


def adult_need_flags(answers: Iterable[tuple[int, str]]) -> AccessibilityFlagSummary:
    """Fold one guest's `(field cm_id, raw answer)` pairs into the flag summary.

    Every flag is an OR, as Go's is, so no answer can clear another's need and
    a blocker anywhere wins. A field off the allowlist contributes nothing.

    ⚠️ `has_infant` STAYS FALSE -- a deliberate divergence from Go, which parses
    Adult-Infant into it. On 2026 that field's only non-"No" value is "I'm
    attending Men's Weekend", and it is not on the allowlist at all.
    `needs_fridge` and `needs_step_free` stay false because the adult form asks
    no question that could feed them; the two computed child flags do not
    apply to a single guest.
    """
    bathroom = power = accommodation = mandatory = False
    for field_cm_id, raw in answers:
        if field_cm_id == ADULT_BATHROOM_FIELD_CM_ID:
            bathroom = bathroom or parse_bool_field_value(raw)
        elif field_cm_id == ADULT_CPAP_FIELD_CM_ID:
            # Both halves, exactly as Go routes them: the bathroom-qualified
            # CPAP option is a bathroom need, not power.
            cpap = classify_cpap_answer(raw)
            power = power or cpap.power
            bathroom = bathroom or cpap.bathroom
        elif field_cm_id == HOUSING_ACCOMODATION_FIELD_CM_ID:
            accommodation = accommodation or parse_bool_field_value(raw)
        elif field_cm_id == ADULT_OPT_OUT_FIELD_CM_ID:
            mandatory = mandatory or is_mandatory_opt_out(raw)
    return AccessibilityFlagSummary(
        needs_private_bathroom=bathroom,
        needs_power=power,
        needs_accommodation=accommodation,
        accommodation_is_mandatory=mandatory,
    )


def _expanded_cm_id(row: Any, relation: str) -> int:
    expand = getattr(row, "expand", None) or {}
    record = expand.get(relation) if isinstance(expand, dict) else None
    return int(getattr(record, "cm_id", 0) or 0) if record is not None else 0


def adult_need_flags_by_person(rows: Iterable[Any]) -> dict[int, AccessibilityFlagSummary]:
    """`LodgingRepository.fetch_adult_need_values` rows -> flags, keyed by the
    guest's own CampMinder id.

    Defense in depth: a row off the allowlist -- which the repository never
    returns -- lights nothing, because `adult_need_flags` maps only the four
    named ids and ignores every other. A row with no resolvable person is
    dropped: it has no guest to hang on.
    """
    answers: dict[int, list[tuple[int, str]]] = {}
    for row in rows:
        field_cm_id = _expanded_cm_id(row, "field_definition")
        person_cm_id = _expanded_cm_id(row, "person")
        if person_cm_id <= 0:
            continue
        answers.setdefault(person_cm_id, []).append((field_cm_id, str(getattr(row, "value", "") or "")))
    return {person_cm_id: adult_need_flags(pairs) for person_cm_id, pairs in answers.items()}
