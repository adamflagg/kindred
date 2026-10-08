"""The March bulk file (campership slice 3, ask 6; clean spec §8.3; D73; owner ruling S3-7).

One row per payer share of each Round 1 offer still to make. The browser writes the registrar's five columns from it,
in order: Camper: (First) <- camper_first, Camper: (Last) <- camper_last, Total Award <- total_award, Primary
Childhood ID <- primary_childhood_id, Personal Id <- personal_id. `request_id` is for the screen's count only.
`zero_left_out` counts the Round 1 offers of $0 the file leaves out (owner ruling E, 10-06), for the button's words."""

from __future__ import annotations

from pydantic import BaseModel


class MarchFileRowOut(BaseModel):
    request_id: str
    camper_first: str  # CampMinder's first name (persons.first_name); "" for a household's own request
    camper_last: str  # CampMinder's last name (persons.last_name); "" for a household's own request
    total_award: float  # this payer share's whole-dollar part of Round 1's decided amount (split_award)
    primary_childhood_id: int  # the payer share's household: its CampMinder household id
    personal_id: int | None  # the camper's CampMinder person id; None for a household's own request (Family Camp)


class MarchFileOut(BaseModel):
    year: int
    rows: list[MarchFileRowOut]
    # Owner ruling E (10-06): the requests whose Round 1 needs an offer of $0, left out of `rows` (no $0 row). They
    # stay in Needs an offer for a letter and a hand Mark Posted; a $0 Round 1 CampMinder already holds isn't counted.
    zero_left_out: int = 0
