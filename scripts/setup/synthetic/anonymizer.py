#!/usr/bin/env python3
"""Deterministic, CampMinder-id-keyed anonymizer for the synthetic seed (issue #1623).

The mapping key is always the CM id (cm_id / person_id / household_id), never the
row's position, so the same person yields the same fake identity in every table and
every run. No ``random`` module, no wall-clock — only SHA-256 over a fixed seed —
so re-running on a reordered subset produces identical output.

Only the PII-bearing tables that survive into the artifact are transformed
(``persons``, ``households``); every high-risk table is emptied wholesale by the
selector (see scan_leaks.DROP_LIST_TABLES), so there is nothing to anonymize there.
"""

import hashlib
import json
import sqlite3

from scripts.setup.synthetic import fixtures_pools as pools

SEED = 1623  # fixed; documented as the issue number


def _h(key: object, salt: str) -> int:
    """Stable, machine-independent hash of (SEED, salt, key)."""
    return int(hashlib.sha256(f"{SEED}:{salt}:{key}".encode()).hexdigest(), 16)


def _pick(pool: tuple[str, ...], key: object, salt: str) -> str:
    return pool[_h(key, salt) % len(pool)]


# ---------------------------------------------------------------------------
# Primitives (pure, deterministic)
# ---------------------------------------------------------------------------


def fake_identity(key: object) -> tuple[str, str]:
    """Return a coherent (first, last) fake name for a CM id."""
    return _pick(pools.FIRST_NAMES, key, "first"), _pick(pools.LAST_NAMES, key, "last")


def _slug(s: str) -> str:
    return "".join(ch for ch in s.lower() if ch.isalnum())


def fake_email(key: object, first: str, last: str) -> str:
    n = _h(key, "email") % 900 + 100
    return f"{_slug(first)}.{_slug(last)}{n}@example.com"


def fake_phone(key: object) -> str:
    return f"555-0{_h(key, 'phone') % 1000:03d}"


def fake_school_for(real_value: str) -> str:
    """Stable real->fake school map keyed by the real value (so all tables agree)."""
    return _pick(pools.SCHOOLS, _slug(real_value), "school")


def fake_city_for(real_value: str) -> str:
    return _pick(pools.CITIES, _slug(real_value), "city")


def fake_congregation_for(real_value: str) -> str:
    return _pick(pools.CONGREGATIONS, _slug(real_value), "congregation")


def fake_street(key: object) -> str:
    num = _h(key, "streetnum") % 9000 + 100
    name = _pick(pools.STREET_NAMES, key, "streetname")
    suffix = _pick(pools.STREET_SUFFIXES, key, "streetsuffix")
    return f"{num} {name} {suffix}"


def fake_postal(key: object) -> str:
    return f"94{_h(key, 'postal') % 1000:03d}"


# ---------------------------------------------------------------------------
# Per-table transform spec
# ---------------------------------------------------------------------------

# Transform kinds applied per (table, column). Columns absent from a table are
# skipped, so the spec is a superset that tolerates schema variation.
_PERSONS_SPEC: dict[str, str] = {
    "first_name": "name_first",
    "last_name": "name_last",
    "preferred_name": "name_first",
    "primary_email": "email",
    "secondary_email": "email_or_empty",
    "school": "school",
    "normalized_school": "school",
    "address_city": "city",
    "normalized_city": "city",
    "normalized_congregation": "congregation",
    "birthdate": "null",
    "gender_identity_write_in": "null",
    "gender_pronoun_write_in": "null",
    "gender_identity_name": "null",
    "gender_pronoun_name": "null",
    "parent_names": "parent_names",
    "raw_data": "empty_obj",
    "tags": "empty_arr",
}

_HOUSEHOLDS_SPEC: dict[str, str] = {
    "greeting": "family_label",
    "mailing_title": "family_label",
    "alternate_mailing_title": "family_label",
    "billing_mailing_title": "family_label",
    "household_phone": "phone",
    "away_phone": "phone",
    "billing_address1": "street",
    "billing_address2": "null",
    "billing_city": "city",
    "billing_postal_code": "postal",
}


def _existing_columns(conn: sqlite3.Connection, table: str) -> set[str]:
    return {r[1] for r in conn.execute(f"PRAGMA table_info([{table}])").fetchall()}


def _table_exists(conn: sqlite3.Connection, table: str) -> bool:
    return conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone() is not None


def _apply_value(kind: str, *, key: object, original: object, first: str, last: str) -> object:
    """Compute the anonymized value for one cell."""
    if kind == "name_first":
        return first
    if kind == "name_last":
        return last
    if kind == "email":
        return fake_email(key, first, last)
    if kind == "email_or_empty":
        return fake_email(key, first, last) if original not in (None, "") else original
    if kind == "school":
        return fake_school_for(str(original)) if original not in (None, "") else original
    if kind == "city":
        return fake_city_for(str(original)) if original not in (None, "") else original
    if kind == "congregation":
        return fake_congregation_for(str(original)) if original not in (None, "") else original
    if kind == "phone":
        return fake_phone(key) if original not in (None, "") else original
    if kind == "street":
        return fake_street(key) if original not in (None, "") else original
    if kind == "postal":
        return fake_postal(key) if original not in (None, "") else original
    if kind == "family_label":
        return f"The {last} Family" if original not in (None, "") else original
    if kind == "null":
        # PB text columns are NOT NULL DEFAULT '' — blank, don't NULL.
        return ""
    if kind == "empty_obj":
        return "{}"
    if kind == "empty_arr":
        return "[]"
    if kind == "parent_names":
        if original in (None, ""):
            return original
        pfirst, _ = fake_identity(f"{key}:parent")
        return json.dumps([{"first": pfirst, "last": last, "relationship": "parent", "is_primary": True}])
    raise ValueError(f"unknown transform kind: {kind}")


def _anonymize_table(conn: sqlite3.Connection, table: str, spec: dict[str, str], key_col: str) -> None:
    if not _table_exists(conn, table):
        return
    cols = _existing_columns(conn, table)
    if key_col not in cols:
        key_col = "id"  # fall back to PB id if cm-id key absent
    active = {c: k for c, k in spec.items() if c in cols}
    if not active:
        return

    select_cols = [key_col, *active.keys()]
    rows = conn.execute(f"SELECT rowid, {', '.join(f'[{c}]' for c in select_cols)} FROM [{table}]").fetchall()
    for row in rows:
        rowid = row[0]
        key = row[1]
        originals = dict(zip(select_cols[1:], row[2:], strict=True))
        first, last = fake_identity(key)
        sets, params = [], []
        for col, kind in active.items():
            new_val = _apply_value(kind, key=key, original=originals[col], first=first, last=last)
            sets.append(f"[{col}] = ?")
            params.append(new_val)
        params.append(rowid)
        conn.execute(f"UPDATE [{table}] SET {', '.join(sets)} WHERE rowid = ?", params)


def anonymize_db(db_path: str) -> None:
    """Anonymize the PII-bearing tables of a subset DB in place."""
    conn = sqlite3.connect(db_path)
    try:
        _anonymize_table(conn, "persons", _PERSONS_SPEC, "cm_id")
        _anonymize_table(conn, "households", _HOUSEHOLDS_SPEC, "cm_id")
        conn.commit()
    finally:
        conn.close()
