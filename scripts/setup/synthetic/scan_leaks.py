#!/usr/bin/env python3
"""PII leak-proof gate for the synthetic seed artifact (issue #1623).

Scans every data-table cell of a SQLite artifact and asserts the ABSENCE of leaks:

1. ``nonempty_drop_table`` — any high-risk table that must be empty has rows.
   This is the strongest guarantee: the entire medical/financial/essay/custom-value
   PII surface is dropped wholesale, so a zero-row count proves it is gone.
2. ``bad_email_domain`` — an email-shaped value whose domain is not ``example.com``.
3. ``bad_phone`` — a phone-shaped value outside the fake ``555-0XXX`` band.
4. ``real_value_leak`` — a token from the (build-time-only) real-value denylist.
5. ``camp_token`` — a camp brand token (e.g. from the gitignored branding config).
6. ``nonempty_system_table`` — a PB ``_``-prefixed auth/system table that must be
   empty (no real users/emails/credentials) still has rows.

The denylist/email/phone/camp scans run over the data tables (``_``-prefixed system
tables are excluded — their schema vocabulary false-matches the name denylist). The
auth-emptiness and ``_params`` settings checks cover the system tables that DO matter,
so the committed artifact self-verifies in CI without the real DB.

Two modes:
- **full** (build time): denylist + camp tokens supplied from the real DB / local
  branding config (never committed) → catches real names/schools/essays directly.
- **--artifact-only** (pre-commit / CI): no real DB present, so denylist/camp tokens
  are empty; the drop-list-row-count-zero + email/phone shape checks still run and
  catch the same content (the high-risk tables are simply absent).

Exit code is non-zero if any violation is found.
"""

import argparse
import json
import re
import sqlite3
import sys
from collections.abc import Iterator
from dataclasses import dataclass

# ---------------------------------------------------------------------------
# Policy constants
# ---------------------------------------------------------------------------

ALLOWED_EMAIL_DOMAIN = "example.com"
# Fake phones are minted as ``555-0XXX`` (see anonymizer). Anything else is a leak.
ALLOWED_PHONE_RE = re.compile(r"^555-0\d{3}$")

# High-risk tables that the subset builder empties wholesale. NONE are read by any
# requires_pb_db test, so the artifact must contain zero rows for each. Mirrors the
# design's emptyTables list (docs/plans/issue-1623-synthetic-seed-design.md).
DROP_LIST_TABLES: tuple[str, ...] = (
    "bunk_requests",
    "original_bunk_requests",
    "debug_pipeline_summary",
    "debug_pipeline_traces",
    "debug_pipeline_runs",
    "debug_parse_results",
    "solver_runs",
    "saved_scenarios",
    "financial_aid_applications",
    "financial_transactions",
    "financial_categories",
    "payment_methods",
    "quest_registrations",
    "family_camp_adults",
    "family_camp_medical",
    "family_camp_registrations",
    "staff",
    "staff_applications",
    "staff_vehicle_info",
    "staff_skills",
    "person_custom_values",
    "household_custom_values",
    "household_demographics",
    "custom_field_defs",
    "person_tag_defs",
    "camper_dietary",
    "camper_transportation",
    # camper_history was dropped from the schema in kindred#2366 (migration
    # 1500000157), but this entry MUST stay: build_synthetic_db copies the real
    # data.db and never runs migrations, so any prod snapshot captured before that
    # migration is applied still carries the table with ~36.7k real camper rows.
    # Deleting this line as a "dead reference" would let them into the artifact.
    "camper_history",
    "normalized_mappings",
    "geo_overrides",
    "locked_groups",
    "locked_group_members",
    "bunk_assignments_draft",
    "bunk_request_sources",
    "sheets_workbooks",
    "enrollment_snapshots",
)

# PB ``_``-prefixed auth/system tables that must hold zero rows in the artifact (no
# real users, emails, or credentials). _data_tables() excludes ``_``-prefixed tables
# from the cell scans (their schema vocabulary false-matches the name denylist), so the
# gate asserts these are empty explicitly — otherwise a scrubbing regression that left
# real superusers/auth rows would slip past the standing CI/pre-commit gate.
MUST_BE_EMPTY_SYSTEM: tuple[str, ...] = (
    "users",
    "user_roles",
    "_superusers",
    "_externalAuths",
    "_authOrigins",
    "_mfas",
    "_otps",
)

# Find email- and phone-shaped substrings inside any cell value (incl. JSON text).
_EMAIL_RE = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")
_PHONE_RE = re.compile(r"(?<!\d)(?:\(\d{3}\)\s*|\d{3}[-.\s])?\d{3}[-.\s]\d{4}(?!\d)")

# Denylist tokens shorter than this are ignored (too generic / false-positive prone).
_MIN_DENY_TOKEN_LEN = 3

# Tables classified non-PII by the #1623 inventory: admin config knobs (free-text
# descriptions / metadata) and RBAC role labels. They hold NO camper data, so the
# real-name denylist would only false-match generic English prose ("grade", "delay",
# "time"). The camp-token, email/phone-shape, and drop-list checks STILL run on them.
_NAME_SCAN_EXCLUDE = frozenset({"config", "config_sections", "roles"})

# Non-identifying noise tokens excluded from the denylist. A 28k-name denylist
# inevitably contains common English words (a real school "First Hebrew", a camper
# "Summer"); those words also appear in our OWN generic output (relabeled "Area N",
# pronoun columns, regenerated parent_names JSON keys, t-shirt sizes), so matching
# them produces false leaks. Excluding them is safe: the columns that carry real
# names are anonymized outright, and the drop-list removes the free-text tables.
_STOPWORD_TOKENS = frozenset(
    {
        # email / URL scaffolding
        "com",
        "org",
        "net",
        "edu",
        "gov",
        "www",
        "http",
        "https",
        "mailto",
        "gmail",
        "yahoo",
        "hotmail",
        "outlook",
        "icloud",
        "aol",
        "comcast",
        "example",
        # pronouns (gender_pronoun_name column)
        "she",
        "her",
        "hers",
        "herself",
        "him",
        "his",
        "himself",
        "they",
        "them",
        "their",
        "theirs",
        "themselves",
        # structural / JSON keys we generate
        "first",
        "last",
        "primary",
        "parent",
        "relationship",
        "name",
        "none",
        "null",
        "true",
        "false",
        "item",
        "type",
        "value",
        # generic relabel words we mint
        "session",
        "group",
        "division",
        "cabin",
        "position",
        "area",
        "tag",
        "returner",
        # t-shirt / size / generic attributes
        "adult",
        "youth",
        "small",
        "medium",
        "large",
        "child",
        # minted labels (households greeting -> "The X Family")
        "family",
        # enrollment status enums (attendees.status)
        "enrolled",
        "cancelled",
        "canceled",
        "waitlist",
        "waitlisted",
        "pending",
        "withdrawn",
        "declined",
        "active",
        "inactive",
        "confirmed",
        "registered",
        "complete",
        "completed",
        "incomplete",
        # session_type enums (camp_sessions.session_type) — needed by tests, controlled vocab
        "main",
        "embedded",
        "quest",
        "teen",
        "hebrew",
        "school",
        "scit",
        "tli",
        "bmitzvah",
        "other",
        "residential",
        # very common stopwords
        "the",
        "and",
        "for",
        "with",
        "camp",
    }
)


@dataclass(frozen=True)
class Violation:
    category: str
    table: str
    detail: str

    def __str__(self) -> str:  # pragma: no cover - cosmetic
        return f"[{self.category}] {self.table}: {self.detail}"


def _data_tables(conn: sqlite3.Connection) -> list[str]:
    rows = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' "
        "AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '\\_%' ESCAPE '\\' "
        "ORDER BY name"
    ).fetchall()
    return [r[0] for r in rows]


def _table_exists(conn: sqlite3.Connection, table: str) -> bool:
    return conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone() is not None


_WORD_SPLIT_RE = re.compile(r"[^a-z0-9]+")


def _denylist_token_set(denylist: list[str] | None) -> set[str]:
    """Split denylist entries into a set of whole-word, case-folded tokens.

    Set membership against each cell's tokenized words is O(words) per cell —
    far faster than per-token regex when the denylist has tens of thousands of
    real names/schools (build-time use), while staying whole-word (no substring
    false positives like 'sam' inside 'samuel')."""
    tokens: set[str] = set()
    for entry in denylist or []:
        if entry is None:
            continue
        for tok in _WORD_SPLIT_RE.split(str(entry).casefold()):
            if len(tok) >= _MIN_DENY_TOKEN_LEN and not tok.isdigit() and tok not in _STOPWORD_TOKENS:
                tokens.add(tok)
    return tokens


def _iter_cells(conn: sqlite3.Connection, table: str) -> Iterator[tuple[str, str]]:
    """Yield (column, value_str) for every non-empty cell in a table."""
    cols = [r[1] for r in conn.execute(f"PRAGMA table_info([{table}])").fetchall()]
    if not cols:
        return
    for row in conn.execute(f"SELECT * FROM [{table}]"):
        for col, val in zip(cols, row, strict=True):
            if val is None:
                continue
            s = str(val)
            if s:
                yield col, s


def scan(
    db_path: str,
    *,
    denylist: list[str] | None = None,
    drop_list: tuple[str, ...] | list[str] = DROP_LIST_TABLES,
    camp_tokens: list[str] | None = None,
    name_scan_exclude: frozenset[str] = _NAME_SCAN_EXCLUDE,
) -> list[Violation]:
    """Return every leak Violation found in the artifact at ``db_path`` (empty == clean)."""
    violations: list[Violation] = []
    deny_tokens = _denylist_token_set(denylist)
    camp_lower = [t.casefold() for t in (camp_tokens or []) if t]

    conn = sqlite3.connect(db_path)
    try:
        present = set(_data_tables(conn))

        # 1. drop-list tables must be empty
        for table in drop_list:
            if table not in present:
                continue
            (n,) = conn.execute(f"SELECT count(*) FROM [{table}]").fetchone()
            if n:
                violations.append(Violation("nonempty_drop_table", table, f"{n} row(s) in dropped table"))

        # 2-5. cell-level scans across every surviving table
        for table in present:
            for col, value in _iter_cells(conn, table):
                for m in _EMAIL_RE.finditer(value):
                    domain = m.group(0).rsplit("@", 1)[-1].casefold()
                    if domain != ALLOWED_EMAIL_DOMAIN:
                        violations.append(Violation("bad_email_domain", table, f"{col}: domain {domain!r}"))
                for m in _PHONE_RE.finditer(value):
                    token = m.group(0).strip()
                    if not ALLOWED_PHONE_RE.match(token):
                        violations.append(Violation("bad_phone", table, f"{col}: phone {token!r}"))
                folded = value.casefold()
                if deny_tokens and table not in name_scan_exclude:
                    hits = deny_tokens.intersection(_WORD_SPLIT_RE.split(folded))
                    if hits:
                        violations.append(Violation("real_value_leak", table, f"{col}: matched {sorted(hits)[:3]}"))
                for tok in camp_lower:
                    if tok in folded:
                        violations.append(Violation("camp_token", table, f"{col}: matched camp token"))

        # 6. system tables: _data_tables() skips ``_``-prefixed tables (schema vocab
        # false-matches the name denylist), so check the two things that DO matter here:
        #   - auth/system tables hold no rows (no real users/emails/credentials)
        #   - _params settings carry no real email domain or camp brand token
        for table in MUST_BE_EMPTY_SYSTEM:
            if not _table_exists(conn, table):
                continue
            (n,) = conn.execute(f"SELECT count(*) FROM [{table}]").fetchone()
            if n:
                violations.append(Violation("nonempty_system_table", table, f"{n} row(s) in system table"))
        if _table_exists(conn, "_params"):
            for col, value in _iter_cells(conn, "_params"):
                for m in _EMAIL_RE.finditer(value):
                    domain = m.group(0).rsplit("@", 1)[-1].casefold()
                    if domain != ALLOWED_EMAIL_DOMAIN:
                        violations.append(Violation("bad_email_domain", "_params", f"{col}: domain {domain!r}"))
                folded = value.casefold()
                for tok in camp_lower:
                    if tok in folded:
                        violations.append(Violation("camp_token", "_params", f"{col}: matched camp token"))
    finally:
        conn.close()
    return violations


def main(argv: list[str] | None = None) -> int:  # pragma: no cover - CLI wiring
    parser = argparse.ArgumentParser(description="Scan a synthetic artifact for PII leaks.")
    parser.add_argument("--artifact", required=True, help="Path to the SQLite artifact to scan.")
    parser.add_argument(
        "--artifact-only",
        action="store_true",
        help="CI/pre-commit mode: shape + drop-list checks only (no real-value denylist).",
    )
    parser.add_argument("--real-db", help="Real DB to derive the name/school denylist (build-time).")
    parser.add_argument("--branding", help="branding.local.json to derive the camp token (build-time).")
    args = parser.parse_args(argv)

    denylist: list[str] | None = None
    camp_tokens: list[str] | None = None
    if not args.artifact_only:
        if args.real_db:
            denylist = build_denylist_from_db(args.real_db)
        if args.branding:
            camp_tokens = build_camp_tokens(args.branding)

    violations = scan(args.artifact, denylist=denylist, camp_tokens=camp_tokens)
    if violations:
        print(f"LEAK SCAN FAILED — {len(violations)} violation(s):", file=sys.stderr)
        for v in violations:
            print(f"  {v}", file=sys.stderr)
        return 1
    print("LEAK SCAN PASSED — no PII leaks detected.")
    return 0


def build_denylist_from_db(real_db: str) -> list[str]:  # pragma: no cover - build-time only
    """Collect real name/school/congregation tokens from the real DB (never committed)."""
    conn = sqlite3.connect(real_db)
    values: set[str] = set()
    try:
        cols = [
            ("persons", ("first_name", "last_name", "preferred_name", "school", "normalized_congregation")),
            ("households", ("greeting",)),
        ]
        for table, fields in cols:
            present = {r[1] for r in conn.execute(f"PRAGMA table_info([{table}])").fetchall()}
            usable = [f for f in fields if f in present]
            if not usable:
                continue
            sel = ", ".join(f"[{f}]" for f in usable)
            for row in conn.execute(f"SELECT {sel} FROM [{table}]"):
                for v in row:
                    if v:
                        values.add(str(v))
    finally:
        conn.close()
    return sorted(values)


def build_camp_tokens(branding_path: str) -> list[str]:  # pragma: no cover - build-time only
    """Extract the camp brand token(s) from the (gitignored) branding config."""
    with open(branding_path) as fh:
        data = json.load(fh)
    tokens: set[str] = set()
    for key in (
        "camp_name",
        "camp_name_short",
        "camp_short_name",
        "sso_display_name",
        "organization_name",
        "page_title",
    ):
        val = data.get(key)
        if isinstance(val, str) and val.strip():
            # Keep DISTINCTIVE whole strings only — splitting into words yields generic
            # tokens ("Camp", "Dashboard", "SSO") that false-match schema/table names.
            tokens.add(val.strip())
    return sorted(tokens)


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
