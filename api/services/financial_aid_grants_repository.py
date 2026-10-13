"""Grants reads (sub-project 6-core), through FastAPI's superuser client: every aid_* collection
has null rules. Extends the ledger repository, whose postings, sources, links, overrides,
persons and enrollments reads the register shares. Read-only: writes go through 4a's
commit_aid_writes in the service."""

from __future__ import annotations

from typing import Any, Final

from api.constants.collections import (
    AID_GRANTS,
    AID_POSTINGS,
    AID_REQUESTS,
)
from api.services.aid_build_reads import in_build, shared_read
from api.services.aid_sync_inputs import aid_sync_inputs
from api.services.financial_aid_repository import FinancialAidRepository
from api.services.lodging_repository import STABLE_SORT
from api.utils.pb_filters import pb_escape

# The columns fetch_grant_answers' callers read off its rows (layer 1's projection includes them).
GRANT_ANSWER_FIELDS: Final = "person_id,one_happy_camper,synagogue_grant,expand.household.cm_id"


def _may_say_yes(answer: Any) -> bool:
    """PocketBase's `answer ~ 'yes'`: SQLite's LIKE '%yes%', which folds ASCII letters only. `lower()` matches it for
    this pattern (no non-ASCII letter lowercases to y, e, or s); never `casefold()`, which reads 'ſ' as 's' and would
    widen the match."""
    return "yes" in str(answer or "").lower()


class GrantsRepository(FinancialAidRepository):
    async def fetch_grant_postings(self, year: int) -> list[Any]:
        """Every grant line this season, live AND reversed (a reversed line stays one row, D74).
        funder_type is the classification after any reclassification (aid_postings materializes it)."""
        flt = f"year = {int(year)} && (funder_type = 'outside' || funder_type = 'incentive')"
        return await self._page(AID_POSTINGS, {"filter": flt, "sort": STABLE_SORT})

    async def fetch_commitments(self, year: int) -> list[Any]:
        return await self._page(AID_GRANTS, {"filter": f"year = {int(year)}", "sort": STABLE_SORT})

    async def fetch_open_commitments_naming(self, grantor_key: str) -> list[Any]:
        """Every season's open commitments naming this grantor: what stops it being retired. A withdrawn
        commitment counts toward nothing and can't be edited, so it never blocks."""
        flt = f"grantor_key = '{pb_escape(grantor_key)}' && status = 'open'"
        return await self._page(AID_GRANTS, {"filter": flt, "fields": "id", "sort": STABLE_SORT})

    async def get_commitment(self, commitment_id: str) -> Any | None:
        return await self._one(AID_GRANTS, commitment_id)

    async def fetch_request_refs(self, year: int) -> list[Any]:
        """The season's requests, as refs. Inside a season build, the decisions store's whole-record read of them
        (FinancialAidIntakeRepository.fetch_requests), shared (aid_build_reads): a superset of the columns below.
        Anywhere else, its own projected read."""
        if in_build():
            return await shared_read(
                (AID_REQUESTS, int(year), id(self.pb)),
                lambda: self._page(AID_REQUESTS, {"filter": f"year = {int(year)}", "sort": STABLE_SORT}),
            )
        return await self._page(
            AID_REQUESTS,
            {
                "filter": f"year = {int(year)}",
                "fields": "id,household_cm_id,person_cm_id,session_cm_id,status",
                "sort": STABLE_SORT,
            },
        )

    async def fetch_grant_answers(self, year: int) -> list[Any]:
        """FA mirror rows whose One Happy Camper or synagogue-grant answer may say yes (D56), in PocketBase-id order.
        The mirror, never person_custom_values (spec §10). A loose contains, as the `~ 'yes'` filter it replaces was;
        the service parses the answer strictly. Answered from layer 1 (aid_sync_inputs): the rows are shared, so
        read-only, and carry GRANT_ANSWER_FIELDS among the other readers' columns."""
        rows = (await aid_sync_inputs(self.pb, year)).fa_applications
        return [r for r in rows if _may_say_yes(r.one_happy_camper) or _may_say_yes(r.synagogue_grant)]
