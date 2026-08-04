"""Parse the Master Housing Tab's `Bed & Bath` column into the shipped `beds` shape.

The output shape is NOT designed here. `frontend/src/types/beds.ts` already
defines it — `[{"type": ..., "count": ...}]` over a closed vocabulary — and
migration 1500000128 already created the column. This module only maps the
sheet's prose onto that vocabulary.

Two properties matter more than coverage:

1. The vocabulary is closed and failure is SILENT. `normaliseBeds()` drops an
   entry whose type it does not recognise, so emitting an invented type id
   would write to PocketBase, satisfy every constraint, and then vanish from
   the UI with nothing logged. `EMITTABLE_TYPES` is asserted against beds.ts by
   the tests so this file can never drift ahead of it.

2. `beds` is nullable and null means UNKNOWN. A row the parser cannot read in
   full yields None, never a partial list: a partial list is indistinguishable
   from a complete one downstream, and it understates capacity silently. Refusal
   is reported and a human decides. This is the same contract `max_beds` has.

Bed vocabulary notes, staff-confirmed:
  - A bare "bunk" is twin-over-twin. These appear only in the camper-cabin
    stock (River, Ridge, Teen Village).
  - "full/twin bunk" is a genuinely different bed — twin on top, full below —
    and appears only in family/guest housing. The two sets do not overlap.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

# Types this module may emit. Every one must exist in BED_TYPES in
# frontend/src/types/beds.ts; test_vocabulary_matches_the_shipped_frontend_types
# fails if it does not.
EMITTABLE_TYPES = ("twin", "twin_bunk", "full_twin_bunk", "full", "queen", "futon")

# Ordered longest-first. "full/twin bunk" contains both "full" and "twin bunk"
# as substrings, so a shorter pattern placed earlier would silently eat it and
# turn a bed that sleeps three into one that sleeps two.
_BED_PATTERNS: list[tuple[str, str]] = [
    ("full_twin_bunk", r"full\s*/\s*twin\s+bunks?(?:\s+beds?)?"),
    ("twin_bunk", r"twin\s+bunks?(?:\s+beds?)?"),
    ("twin_bunk", r"bunks?(?:\s+beds?)?"),
    ("queen", r"queens?(?:\s+beds?)?"),
    ("full_twin_bunk", r"fulls?\s*/\s*twins?"),
    ("full", r"fulls?(?:\s+beds?)?"),
    ("full", r"doubles?(?:\s+beds?)?"),
    ("twin", r"singles?(?:\s+beds?)?"),
    ("twin", r"twins?(?:\s+beds?)?"),
    ("futon", r"futons?"),
]

# Recognised but not beds: each has its own column, or its own pending schema.
_IGNORABLE = [
    r"\d*\+?\s*(?:bedrooms?|bdrms?|rooms?|rms?)",
    r"(?:private|shared|share)?\s*(?:bathrooms?|baths?|bths?)",
    r"\d+\s*(?:bathrooms?|baths?|bths?)",
    r"(?:accessible\s+)?shower",
    r"kitchenettes?|kitchens?|kitch",
    r"laundry",
    r"lofts?",
]

# Recognised, and each is a REFUSAL: the cell names a sleeping space without
# saying what is in it, so any list we build is knowingly incomplete.
_REFUSALS = [
    (r"guest\s+rooms?", "names a guest room whose beds are not listed"),
    (r"\d*\s*beds?", "names a bed without a size"),
]

_QUALIFIER_RE = re.compile(r"\(([^)]*)\)")
_LOCATION_RE = re.compile(r"\s+in\s+.+$", re.IGNORECASE)
_COUNT_RE = re.compile(r"^(\d+)\s+(.*)$")


@dataclass(frozen=True)
class BedBathParse:
    """One parsed `Bed & Bath` cell.

    `beds` is None when the cell could not be read in full. `reason` says why,
    and is empty exactly when `beds` is not None.
    """

    beds: list[dict[str, object]] | None
    reason: str = ""
    fridge: str = ""  # "", "private" or "shared"
    crib: bool = False
    changing_table: bool = False
    bathroom_phrase: str = ""
    qualifiers: tuple[str, ...] = ()
    unparsed: tuple[str, ...] = field(default=())


def _match_bed(text: str) -> str | None:
    """Return the bed type a lone bed phrase names, or None."""
    for bed_type, pattern in _BED_PATTERNS:
        if re.fullmatch(pattern, text, re.IGNORECASE):
            return bed_type
    return None


def parse_bed_bath(raw: str) -> BedBathParse:
    text = (raw or "").strip()
    if not text:
        return BedBathParse(beds=None, reason="empty cell")

    fridge = ""
    crib = False
    changing_table = False
    bathroom_phrase = ""
    qualifiers: list[str] = []
    unparsed: list[str] = []
    beds: list[dict[str, object]] = []

    # Amenities are picked off whole-string first: their phrasing ("shared mini
    # fridge") does not respect the comma structure the bed list uses.
    if re.search(r"shared\s+mini\s+fridge", text, re.IGNORECASE):
        fridge = "shared"
    elif re.search(r"mini\s+fridge", text, re.IGNORECASE):
        fridge = "private"
    if re.search(r"changing\s+table", text, re.IGNORECASE):
        changing_table = True
    if re.search(r"\bcribs?\b", text, re.IGNORECASE):
        crib = True
    bath = re.search(r"(private|shared|share)[,\s]+(?:accessible\s+)?(?:shower|bath\w*)", text, re.IGNORECASE)
    if bath:
        bathroom_phrase = bath.group(0)

    stripped = re.sub(
        r"shared\s+mini\s+fridge|mini\s+fridge|changing\s+table|\bcribs?\b", " ", text, flags=re.IGNORECASE
    )

    for part in (p.strip() for p in re.split(r"[,;]", stripped)):
        if not part:
            continue

        # A trailing parenthetical either re-describes the bed ("(bunk)") or
        # qualifies what it sleeps ("(w/ full mattress)"). Both are pulled out
        # before matching; the second kind has nowhere to live in the shape, so
        # it is surfaced rather than dropped.
        paren = _QUALIFIER_RE.search(part)
        qualifier = ""
        if paren:
            qualifier = paren.group(1).strip()
            part = _QUALIFIER_RE.sub(" ", part).strip()

        # "+ crib" and friends are already harvested above.
        part = re.sub(r"\+.*$", "", part).strip()
        if not part:
            if qualifier:
                qualifiers.append(qualifier)
            continue

        refusal = next(
            (why for pattern, why in _REFUSALS if re.fullmatch(pattern, part, re.IGNORECASE)),
            None,
        )
        if refusal:
            return BedBathParse(
                beds=None,
                reason=f"{refusal}: {part!r}",
                fridge=fridge,
                crib=crib,
                changing_table=changing_table,
                bathroom_phrase=bathroom_phrase,
            )

        if any(re.fullmatch(pattern, part, re.IGNORECASE) for pattern in _IGNORABLE):
            if qualifier:
                qualifiers.append(qualifier)
            continue

        # "full in loft" is a full bed that happens to sit in a loft.
        located = _LOCATION_RE.sub("", part).strip()
        count_match = _COUNT_RE.match(located)
        count, phrase = (int(count_match.group(1)), count_match.group(2).strip()) if count_match else (1, located)

        bed_type = _match_bed(phrase)
        if bed_type is None:
            unparsed.append(part)
            continue

        # "2 singles (bunk)" is one bunk, not two loose singles - the
        # parenthetical says the pair is stacked. Capacity corroborates on the
        # only row that says it (New Trailer: 1 double + this against 4).
        if qualifier.lower() == "bunk" and bed_type == "twin" and count % 2 == 0:
            bed_type, count = "twin_bunk", count // 2
        elif qualifier:
            qualifiers.append(qualifier)

        if beds and beds[-1]["type"] == bed_type:
            beds[-1]["count"] = int(beds[-1]["count"]) + count  # type: ignore[call-overload]
        else:
            beds.append({"type": bed_type, "count": count})

    if unparsed:
        return BedBathParse(
            beds=None,
            reason="unrecognised: " + "; ".join(repr(u) for u in unparsed),
            fridge=fridge,
            crib=crib,
            changing_table=changing_table,
            bathroom_phrase=bathroom_phrase,
            qualifiers=tuple(qualifiers),
            unparsed=tuple(unparsed),
        )
    if not beds:
        return BedBathParse(
            beds=None,
            reason="no bed data in the cell",
            fridge=fridge,
            crib=crib,
            changing_table=changing_table,
            bathroom_phrase=bathroom_phrase,
        )

    return BedBathParse(
        beds=beds,
        fridge=fridge,
        crib=crib,
        changing_table=changing_table,
        bathroom_phrase=bathroom_phrase,
        qualifiers=tuple(qualifiers),
    )
