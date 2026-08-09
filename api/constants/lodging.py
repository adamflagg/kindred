"""Lodging party-size arithmetic.

`RosterParty.party_size` is a BED count, not a headcount. Two rules make it
one, and both are hardcoded here rather than exposed as config: the repo's
standing preference is a constant with a code-PR escape hatch over a DB knob
nobody remembers exists, and neither of these is a number staff should be
able to move between weekends.

Both rules are mirrored on the frontend in
`frontend/src/components/weekend/householdIdentity.ts`, because the board must
not render a person the count refuses to count.
`tests/unit/api/test_lodging_constants.py` greps that file and fails if the
two token lists drift.
"""

# kindred#2046, settled by the owner from staff practice: a child under 18
# MONTHS at session start travels in a cot or shares with a parent, so
# consumes no bed. Staff explicitly accept that a 19-23 month old who needs a
# crib will inflate the count -- it is rare, and they would be phoning the
# family anyway.
#
# MONTHS, and derived from `persons.birthdate` against
# `camp_sessions.start_date`. NEVER a threshold on `persons.age`: that column
# is CampMinder's `yy.mm` as a REAL (kindred#2088), where the fractional part
# never exceeds `.11`, so the obvious-looking `age < 1.5` reads as "under 24
# months" and discounts precisely the 19-23 month olds this ruling protects.
# Measured on 2026's 382 rostered households: `age < 1.5` discounts 44
# children, `age < 1.06` discounts 28, the derived rule discounts 24.
INFANT_BED_EXEMPT_MONTHS = 18

# kindred#1925. `family_camp_adults` is a five-slot scrape, and a registrant
# with no second adult sometimes types a token in rather than leaving the slot
# empty. Measured on 2026: two such rows across the rostered cohort, holding
# `NA` and `0` -- and both were RENDERED, because the blank-name filter passes
# anything with a truthy `.trim()`. Staff were reading an adult called "NA".
#
# WHOLE-VALUE tokens, matched after casefolding and stripping. Never a
# substring test: "Nona" and "Noor" are names.
ADULT_NAME_PLACEHOLDERS: frozenset[str] = frozenset({"na", "n/a", "none", "-", "0", "no"})


def is_attending_adult_name(name: str | None) -> bool:
    """Whether a coalesced `family_camp_adults` name is a real attending adult.

    The count of attending adults is `len(valid names)` and is deliberately
    NOT reconciled against `Total Adults-FC` (owner ruling, 2026-08-07): staff
    add adults to a modified registration without updating the stated total,
    so the names stay current while the total goes stale. On 2026's rostered
    cohort the disagreements run three-to-one toward the names being righter.
    """
    if name is None:
        return False
    token = name.strip()
    return bool(token) and token.casefold() not in ADULT_NAME_PLACEHOLDERS
