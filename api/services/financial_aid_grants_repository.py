"""Grants reads (sub-project 6-core), through FastAPI's superuser client: every aid_* collection
has null rules. Extends the ledger repository, whose postings, sources, links, overrides,
persons and enrollments reads the register shares. Read-only: writes go through 4a's
commit_aid_writes in the service."""

from __future__ import annotations

from collections.abc import Collection
from typing import Any

from api.constants.collections import (
    AID_GRANTS,
    AID_POSTINGS,
    AID_REQUESTS,
    FINANCIAL_AID_APPLICATIONS,
    PERSONS,
)
from api.services.financial_aid_repository import FinancialAidRepository
from api.services.lodging_repository import STABLE_SORT
from api.utils.pb_filters import pb_escape


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

    async def fetch_household_members(self, year: int, household_ids: Collection[int]) -> list[Any]:
        """The persons whose own household is one of these (chunked by ID_CHUNK households per query)."""
        return await self._by_ids(PERSONS, f"year = {int(year)}", "household_id", household_ids)

    async def fetch_request_refs(self, year: int) -> list[Any]:
        return await self._page(
            AID_REQUESTS,
            {
                "filter": f"year = {int(year)}",
                "fields": "id,household_cm_id,person_cm_id,session_cm_id,status",
                "sort": STABLE_SORT,
            },
        )

    async def fetch_grant_answers(self, year: int) -> list[Any]:
        """FA mirror rows whose One Happy Camper or synagogue-grant answer may say yes (D56). The
        mirror, never person_custom_values (spec §10). `~` is a loose contains; the service parses
        the answer strictly."""
        return await self._page(
            FINANCIAL_AID_APPLICATIONS,
            {
                "filter": f"year = {int(year)} && (one_happy_camper ~ 'yes' || synagogue_grant ~ 'yes')",
                "expand": "household",
                "fields": "person_id,one_happy_camper,synagogue_grant,expand.household.cm_id",
                "sort": STABLE_SORT,
            },
        )
