"""Grants reads (sub-project 6-core), through FastAPI's superuser client: every aid_* collection
has null rules. Extends the ledger repository, whose postings, sources, links, overrides,
persons and enrollments reads the register shares. Read-only: writes go through 4a's
commit_aid_writes in the service."""

from __future__ import annotations

from api.services.financial_aid_repository import FinancialAidRepository


class GrantsRepository(FinancialAidRepository):
    pass
