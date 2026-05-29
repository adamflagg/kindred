"""Fictional value pools for the synthetic anonymizer (issue #1623).

ALL values here are invented and must never coincide with the real dataset's
identifying combinations. They seed the deterministic fake-data engine in
``anonymizer.py``. The documented project set (Emma Johnson, Liam Garcia,
Olivia Chen, Riley Sam, Samuel Johnson / Riverside Elementary, Oak Valley Middle,
Hillcrest High) is included; the rest extend the pools so ~80 distinct campers
get distinct-looking identities.

NOTE: the real year-round staff roster lives in the gitignored
``config/staff_list.json`` and is treated as a DENYLIST, never a pool.
"""

from __future__ import annotations

import re

FIRST_NAMES: tuple[str, ...] = (
    "Emma",
    "Liam",
    "Olivia",
    "Riley",
    "Samuel",
    "Ava",
    "Noah",
    "Sophia",
    "Mason",
    "Isabella",
    "Ethan",
    "Mia",
    "Lucas",
    "Charlotte",
    "Logan",
    "Amelia",
    "Jackson",
    "Harper",
    "Aiden",
    "Evelyn",
    "Caleb",
    "Abigail",
    "Henry",
    "Emily",
    "Owen",
    "Elizabeth",
    "Wyatt",
    "Sofia",
    "Leo",
    "Ella",
    "Julian",
    "Scarlett",
    "Levi",
    "Grace",
    "Isaac",
    "Chloe",
    "Nathan",
    "Lily",
    "Eli",
    "Aria",
    "Hannah",
    "Nora",
    "Ezra",
    "Zoe",
    "Miles",
    "Hazel",
    "Theo",
    "Violet",
    "Asher",
    "Stella",
)

LAST_NAMES: tuple[str, ...] = (
    "Johnson",
    "Garcia",
    "Chen",
    "Sam",
    "Brooks",
    "Rivera",
    "Patel",
    "Nguyen",
    "Murphy",
    "Cohen",
    "Sandoval",
    "Walsh",
    "Okafor",
    "Becker",
    "Delgado",
    "Foster",
    "Hale",
    "Ibrahim",
    "Jensen",
    "Klein",
    "Lambert",
    "Marsh",
    "Novak",
    "Osborne",
    "Pruitt",
    "Quinn",
    "Reyes",
    "Sloane",
    "Tran",
    "Underwood",
    "Vance",
    "Whitfield",
    "Xiong",
    "Yamada",
    "Zimmerman",
    "Abbott",
    "Bauer",
    "Calder",
    "Donovan",
    "Ellison",
)

# Fictional schools, varied by level (the documented three plus extensions).
SCHOOLS: tuple[str, ...] = (
    "Riverside Elementary",
    "Oak Valley Middle",
    "Hillcrest High",
    "Maplewood Elementary",
    "Cedar Creek Middle",
    "Summit Ridge High",
    "Brookfield Elementary",
    "Pinecrest Middle",
    "Lakeshore High",
    "Westgate Elementary",
    "Ironwood Middle",
    "Northstar High",
    "Meadowbrook Elementary",
    "Stonebridge Middle",
    "Fairview High",
    "Willow Glen Elementary",
    "Birchwood Middle",
    "Granite Peak High",
)

CITIES: tuple[str, ...] = (
    "Lakeside",
    "Fairhaven",
    "Brookhollow",
    "Meadowvale",
    "Cedar Springs",
    "Riverton",
    "Westbrook",
    "Oakdale",
    "Pinehurst",
    "Glenwood",
    "Stonehaven",
    "Maple Falls",
    "Elmwood",
    "Crestview",
    "Harborview",
    "Sunnyside",
    "Foxglen",
    "Birchport",
)

# Clearly-invented congregation names (distinctive second word) to avoid resembling
# any real congregation in the source data.
CONGREGATIONS: tuple[str, ...] = (
    "Temple Beth Hollow",
    "Congregation Or Maple",
    "Temple Shalom Ridge",
    "Beth Israel Brookline",
    "Congregation Ner Willow",
    "Temple Sinai Glen",
    "Congregation Kol Aspen",
    "Beth Am Cedarfield",
    "Temple Emek Vista",
    "Congregation Tikvah Lake",
)

STREET_NAMES: tuple[str, ...] = (
    "Maple",
    "Oak",
    "Cedar",
    "Pine",
    "Birch",
    "Elm",
    "Willow",
    "Aspen",
    "Juniper",
    "Sycamore",
    "Chestnut",
    "Magnolia",
    "Spruce",
    "Hawthorn",
)

STREET_SUFFIXES: tuple[str, ...] = ("St", "Ave", "Rd", "Ln", "Dr", "Ct", "Way")


def pool_tokens() -> set[str]:
    """Every word used in any pool, casefolded — excluded from the leak denylist
    so the scanner never flags our own fictional values as 'real' leaks."""
    tokens: set[str] = set()
    for pool in (FIRST_NAMES, LAST_NAMES, SCHOOLS, CITIES, CONGREGATIONS, STREET_NAMES, STREET_SUFFIXES):
        for entry in pool:
            # Split exactly like the scanner (non-alphanumeric) so "Emanu-El" -> {emanu, el}
            # and every minted word is excluded from the denylist, not just whitespace tokens.
            for word in re.split(r"[^a-z0-9]+", entry.casefold()):
                if word:
                    tokens.add(word)
    return tokens
