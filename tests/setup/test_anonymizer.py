"""Tests for scripts/setup/synthetic/anonymizer.py — deterministic fake-data engine.

Invariants (issue #1623 design §2):
- Same key (CampMinder id) -> same fake identity, everywhere, every run.
- Fake emails are always @example.com; fake phones always in the 555-0XXX band
  (so the leak scanner's shape checks pass).
- School/city/congregation use a STABLE real->fake map so cross-table references agree.
- JSON blobs (raw_data, parent_names, tags) are emptied, never find-replaced.
- The anonymized output passes scan_leaks against a denylist of the original values.

Pure mockable unit tests — tiny temp SQLite, no real DB, no server.
"""

import importlib
import re
import sqlite3
from pathlib import Path

import pytest


@pytest.fixture
def anon():
    return importlib.import_module("scripts.setup.synthetic.anonymizer")


@pytest.fixture
def scan():
    return importlib.import_module("scripts.setup.synthetic.scan_leaks")


# Distinctive fictional values used as planted "real" PII (NOT real people).
REAL_FIRST = "Zephyrina"
REAL_LAST = "Quackenbush"
REAL_EMAIL = "zephyrina.quackenbush@gmail.com"
REAL_SCHOOL = "Bumblewick Preparatory Academy"
REAL_CITY = "Snorklevania"


def _make_persons_db(path: Path) -> None:
    conn = sqlite3.connect(path)
    conn.execute(
        """
        CREATE TABLE persons (
            id TEXT PRIMARY KEY, cm_id NUMERIC, household_id NUMERIC,
            first_name TEXT, last_name TEXT, preferred_name TEXT,
            primary_email TEXT, secondary_email TEXT,
            school TEXT, normalized_school TEXT,
            address_city TEXT, normalized_city TEXT, address_state TEXT,
            normalized_congregation TEXT, birthdate TEXT,
            age NUMERIC, grade NUMERIC, gender TEXT,
            parent_names JSON, raw_data JSON, tags JSON
        )
        """
    )
    conn.execute(
        "INSERT INTO persons VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (
            "rec1",
            1001,
            5001,
            REAL_FIRST,
            REAL_LAST,
            REAL_FIRST,
            REAL_EMAIL,
            "",
            REAL_SCHOOL,
            REAL_SCHOOL,
            REAL_CITY,
            REAL_CITY,
            "CA",
            "Temple Beth Snorkle",
            "2012-04-15",
            13,
            7,
            "F",
            f'[{{"first": "Parenta", "last": "{REAL_LAST}", "relationship": "parent", "is_primary": true}}]',
            '{"ssn": "secret", "notes": "do not leak"}',
            '["returner", "vip"]',
        ),
    )
    conn.commit()
    conn.close()


def test_fake_identity_is_deterministic(anon):
    assert anon.fake_identity(1001) == anon.fake_identity(1001)
    assert anon.fake_identity("1001") == anon.fake_identity("1001")


def test_fake_identity_varies_across_keys(anon):
    names = {anon.fake_identity(k) for k in range(200)}
    assert len(names) > 50, "fake identities should be reasonably diverse across keys"


def test_fake_email_is_example_domain(anon):
    first, last = anon.fake_identity(1001)
    email = anon.fake_email(1001, first, last)
    assert email.endswith("@example.com")
    assert email == email.lower()


def test_fake_phone_matches_band(anon):
    for k in range(50):
        assert re.fullmatch(r"555-0\d{3}", anon.fake_phone(k)), anon.fake_phone(k)


def test_fake_school_map_is_stable(anon):
    a = anon.fake_school_for(REAL_SCHOOL)
    b = anon.fake_school_for(REAL_SCHOOL)
    assert a == b
    assert REAL_SCHOOL not in a


def test_anonymize_db_replaces_pii_and_empties_json(anon, tmp_path):
    db = tmp_path / "subset.db"
    _make_persons_db(db)
    anon.anonymize_db(str(db))

    conn = sqlite3.connect(db)
    row = dict(
        zip(
            [d[0] for d in conn.execute("SELECT * FROM persons").description],
            conn.execute("SELECT * FROM persons").fetchone(),
            strict=True,
        )
    )
    conn.close()

    # Referential keys preserved
    assert row["cm_id"] == 1001
    assert row["household_id"] == 5001
    # Solver-relevant quasi-identifiers kept
    assert row["age"] == 13
    assert row["grade"] == 7
    assert row["gender"] == "F"
    # PII replaced
    assert row["first_name"] != REAL_FIRST
    assert row["last_name"] != REAL_LAST
    assert row["primary_email"].endswith("@example.com")
    assert REAL_SCHOOL not in (row["school"] or "")
    assert REAL_CITY not in (row["address_city"] or "")
    # birthdate nulled
    assert row["birthdate"] in (None, "")
    # JSON blobs emptied (not find-replaced)
    assert row["raw_data"] in (None, "", "{}")
    assert row["tags"] in (None, "", "[]")
    # parent_names regenerated — must not contain the real surname
    assert REAL_LAST not in (row["parent_names"] or "")


def test_anonymize_db_is_deterministic(anon, tmp_path):
    db1 = tmp_path / "a.db"
    db2 = tmp_path / "b.db"
    _make_persons_db(db1)
    _make_persons_db(db2)
    anon.anonymize_db(str(db1))
    anon.anonymize_db(str(db2))

    def rows(p):
        conn = sqlite3.connect(p)
        out = conn.execute("SELECT * FROM persons ORDER BY cm_id").fetchall()
        conn.close()
        return out

    assert rows(db1) == rows(db2)


def test_anonymized_db_passes_leak_scan(anon, scan, tmp_path):
    db = tmp_path / "subset.db"
    _make_persons_db(db)
    anon.anonymize_db(str(db))
    denylist = [REAL_FIRST, REAL_LAST, REAL_EMAIL, REAL_SCHOOL, REAL_CITY]
    violations = scan.scan(str(db), denylist=denylist, drop_list=[])
    assert violations == [], f"anonymized DB should pass leak scan, got {violations}"
