"""Synthetic, no-PII seed-DB tooling for issue #1623.

Modules:
- ``scan_leaks``  — PII leak-proof gate (denylist + shape + drop-list-row-count-zero).
- ``anonymizer``  — deterministic, cm-id-keyed fake-data engine.
- ``fixtures_pools`` — fictional name/school/city/congregation pools.

The selector/builder (``select_subset``/``build_synthetic_db``) read the REAL DB and
are local-only; ``scan_leaks`` (``--artifact-only``) and the committed artifact are
the only pieces that run in CI.
"""
