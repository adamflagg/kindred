#!/usr/bin/env python3
"""Build the committable synthetic seed artifact (issue #1623). LOCAL ONLY.

Pipeline (never mutates the real DB — copies it via SQLite's backup API):
  1. backup real data.db -> scratch (folds WAL, leaves real untouched)
  2. select a tiny, referentially-closed subset (select_subset)
  3. prune kept tables to the subset; empty the high-risk drop-list tables
  4. clear auth/system tables that carry real emails (users, _superusers, ...)
  5. anonymize PII (anonymizer); relabel + token-scrub brand language (debrand)
  6. scrub _params (camp name / SMTP sender)
  7. VACUUM  <-- critical: physically purges deleted real rows from the file
  8. build-time leak scan (real-value denylist + camp tokens + system-table emptiness);
     ABORT and write nothing if any violation is found
  9. gzip -> tests/fixtures/synthetic_pb/data.db.gz + MANIFEST.json

Usage:
  uv run python -m scripts.setup.synthetic.build_synthetic_db [--real-db PATH] [--out PATH]
"""

import argparse
import gzip
import hashlib
import json
import shutil
import sqlite3
import sys
import tempfile
from collections.abc import Iterable
from pathlib import Path

from scripts.setup.synthetic import anonymizer, debrand, fixtures_pools, scan_leaks, select_subset

_REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_REAL_DB = _REPO_ROOT / "pocketbase" / "pb_data" / "data.db"
DEFAULT_OUT = _REPO_ROOT / "tests" / "fixtures" / "synthetic_pb" / "data.db.gz"
DEFAULT_BRANDING = _REPO_ROOT / "config" / "branding.local.json"

# Tables kept (pruned to the subset). Lookup tables not listed here are kept whole.
KEEP_WHOLE = (
    "divisions",
    "session_groups",
    "staff_positions",
    "staff_program_areas",
    "staff_org_categories",
    "config",
    "config_sections",
    "roles",
)
# Auth/system tables that carry real emails/credentials -> emptied; CI creates its admin.
AUTH_TABLES = (
    "users",
    "user_roles",
    "_superusers",
    "_externalAuths",
    "_authOrigins",
    "_mfas",
    "_otps",
)
# System tables that must end up empty (verified post-build).
MUST_BE_EMPTY_SYSTEM = ("users", "_superusers", "_externalAuths", "_authOrigins", "_mfas", "_otps")


def _camp_scrub_config(branding: Path) -> tuple[list[tuple[str, str]], list[str]]:
    """Derive (scrub_replacements, gate_tokens) from the gitignored branding config.

    The real camp name is never hardcoded into this (public) module — it is read from
    ``branding.local.json`` at build time. Fails LOUDLY if the config is missing or
    yields no tokens: a silent fallback would leave the scrub and the leak gate
    scanning for nothing, so a regression could ship the real brand undetected.

    ``scrub_replacements`` are longest-token-first so a multi-word brand ("Camp X") is
    scrubbed before its substring ("X"); ``gate_tokens`` are the raw distinctive strings
    the leak scan asserts are absent from the artifact.
    """
    if not branding.is_file():
        raise FileNotFoundError(f"branding config required to derive camp scrub/gate tokens: {branding}")
    tokens = scan_leaks.build_camp_tokens(str(branding))
    if not tokens:
        raise ValueError(f"no camp tokens derived from {branding}; scrub + leak gate would do nothing")
    replacements = [
        (tok, "Camp Kindred" if tok.lower().startswith("camp ") else "Kindred")
        for tok in sorted(tokens, key=len, reverse=True)
    ]
    return replacements, tokens


# Brand-token schema columns on staff_applications (an empty, dropped table that no test
# reads). The repo's live CampMinder sync rename is deferred to its own PR, but the FIXTURE
# carries no data there, so we rename these EMPTY columns out of its schema so the camp name
# survives nowhere in the committed artifact — not even as a field identifier. _collections
# metadata is patched to match, keeping the fixture a valid, bootable PB DB.
_BRAND_SCHEMA_COLUMN_RENAMES = (
    ("why_tawonga", "why_camp"),
    ("tawonga_makes_think", "camp_word_association"),
)


def _backup_real(real_db: Path, dest: Path) -> None:
    """Consistent read-only copy of the real DB (folds WAL; never writes real)."""
    src = sqlite3.connect(f"file:{real_db}?mode=ro", uri=True)
    dst = sqlite3.connect(dest)
    try:
        src.backup(dst)
    finally:
        dst.close()
        src.close()


def _temp_ids_table(conn: sqlite3.Connection, name: str, ids: Iterable[object]) -> None:
    conn.execute(f"CREATE TEMP TABLE {name} (v)")
    conn.executemany(f"INSERT INTO {name} VALUES (?)", [(i,) for i in ids])


def _prune(conn: sqlite3.Connection, subset: select_subset.Subset) -> None:
    _temp_ids_table(conn, "keep_sessions", subset.session_pbids)
    _temp_ids_table(conn, "keep_persons", subset.person_pbids)
    _temp_ids_table(conn, "keep_households", subset.household_cmids)

    conn.execute("DELETE FROM camp_sessions WHERE id NOT IN (SELECT v FROM keep_sessions)")
    conn.execute("DELETE FROM persons WHERE id NOT IN (SELECT v FROM keep_persons)")
    conn.execute(
        "DELETE FROM attendees WHERE person NOT IN (SELECT v FROM keep_persons) "
        "OR session NOT IN (SELECT v FROM keep_sessions)"
    )
    conn.execute("DELETE FROM households WHERE cm_id NOT IN (SELECT v FROM keep_households)")
    if _exists(conn, "attendee_status_history"):
        conn.execute("DELETE FROM attendee_status_history WHERE person NOT IN (SELECT v FROM keep_persons)")
    if _exists(conn, "bunk_assignments"):
        conn.execute(
            "DELETE FROM bunk_assignments WHERE person NOT IN (SELECT v FROM keep_persons) "
            "OR session NOT IN (SELECT v FROM keep_sessions)"
        )
    if _exists(conn, "bunk_plans"):
        conn.execute("DELETE FROM bunk_plans WHERE session NOT IN (SELECT v FROM keep_sessions)")
    if _exists(conn, "bunks"):
        conn.execute(
            "DELETE FROM bunks WHERE id NOT IN (SELECT bunk FROM bunk_plans UNION SELECT bunk FROM bunk_assignments)"
        )


def _exists(conn: sqlite3.Connection, table: str) -> bool:
    return conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone() is not None


def _empty_tables(conn: sqlite3.Connection, tables: Iterable[str]) -> None:
    for t in tables:
        if _exists(conn, t):
            conn.execute(f"DELETE FROM [{t}]")


def _scrub_params(conn: sqlite3.Connection) -> None:
    """Neutralize PB app settings: camp name / app URL / SMTP sender."""
    if not _exists(conn, "_params"):
        return
    row = conn.execute("SELECT id, value FROM _params LIMIT 1").fetchone()
    if not row:
        return
    pid, value = row
    try:
        settings = json.loads(value)
    except TypeError, ValueError:
        return
    meta = settings.get("meta")
    if isinstance(meta, dict):
        meta["appName"] = "Kindred"
        for url_key in ("appURL", "appUrl"):
            if url_key in meta:
                meta[url_key] = "http://localhost:8090"
        meta["senderName"] = "Kindred"
        meta["senderAddress"] = "support@example.com"
    smtp = settings.get("smtp")
    if isinstance(smtp, dict):
        smtp.update({"enabled": False, "host": "", "username": "", "password": "", "authMethod": ""})
    conn.execute("UPDATE _params SET value = ? WHERE id = ?", (json.dumps(settings), pid))


def _strip_brand_schema_columns(conn: sqlite3.Connection) -> None:
    """Rename brand-token columns out of the (empty) staff_applications physical schema so
    the camp name survives nowhere in the artifact — not even as a field identifier in the
    CREATE TABLE DDL. The matching rename inside PB's _collections metadata JSON is handled
    by scrub_tokens (which knows the right column). Safe: the table has 0 rows, no test
    reads it, and the two stay consistent so the fixture remains a bootable PB DB."""
    if not _exists(conn, "staff_applications"):
        return
    cols = {r[1] for r in conn.execute("PRAGMA table_info([staff_applications])").fetchall()}
    for old, new in _BRAND_SCHEMA_COLUMN_RENAMES:
        if old in cols:
            conn.execute(f"ALTER TABLE staff_applications RENAME COLUMN {old} TO {new}")


def _logical_dump_sha(db_path: Path) -> str:
    conn = sqlite3.connect(db_path)
    try:
        h = hashlib.sha256()
        for line in conn.iterdump():
            h.update(line.encode())
        return h.hexdigest()
    finally:
        conn.close()


def _row_counts(db_path: Path) -> dict[str, int]:
    conn = sqlite3.connect(db_path)
    try:
        counts = {}
        for (t,) in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
        ):
            (counts[t],) = conn.execute(f"SELECT count(*) FROM [{t}]").fetchone()
        return counts
    finally:
        conn.close()


def _system_table_violations(db_path: Path, camp_tokens: list[str]) -> list[str]:
    """Belt-and-suspenders for _-prefixed tables (scan_leaks skips them).

    System tables hold schema/settings, not camper PII, so the name denylist would
    only false-match schema vocabulary (field names like 'city'/'staff'/'year').
    We check two things that DO matter: auth tables are empty, and the distinctive
    camp brand token is absent from _params/_collections.
    """
    problems: list[str] = []
    conn = sqlite3.connect(db_path)
    try:
        for t in MUST_BE_EMPTY_SYSTEM:
            if _exists(conn, t):
                (n,) = conn.execute(f"SELECT count(*) FROM [{t}]").fetchone()
                if n:
                    problems.append(f"{t} should be empty but has {n} row(s)")
        for t in ("_params", "_collections"):
            if not _exists(conn, t):
                continue
            for row in conn.execute(f"SELECT * FROM [{t}]"):
                for val in row:
                    if not isinstance(val, str):
                        continue
                    folded = val.casefold()
                    for ct in camp_tokens:
                        if ct.casefold() in folded:
                            problems.append(f"{t}: camp token {ct!r} present")
    finally:
        conn.close()
    return problems


def build(real_db: Path, out: Path, branding: Path) -> int:
    if not real_db.is_file():
        print(f"ERROR: real DB not found: {real_db}", file=sys.stderr)
        return 2

    # Derive the brand scrub/gate tokens from the gitignored branding config up front,
    # so we never start a build that would silently scrub nothing (fail loud, no work).
    try:
        camp_replacements, camp_tokens = _camp_scrub_config(branding)
    except (FileNotFoundError, ValueError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2

    work = Path(tempfile.mkdtemp(prefix="synthetic-seed-"))
    scratch = work / "data.db"
    print(f"[1/9] backing up real DB -> {scratch}")
    _backup_real(real_db, scratch)

    conn = sqlite3.connect(scratch)
    conn.execute("PRAGMA foreign_keys=OFF")
    (persons_total,) = conn.execute("SELECT count(*) FROM persons").fetchone()
    if persons_total < 1000:
        conn.close()
        print(f"ERROR: real DB looks empty (persons={persons_total}); refusing.", file=sys.stderr)
        return 2

    print("[2/9] selecting subset")
    subset = select_subset.select_subset(conn)
    print(
        f"      sessions={len(subset.session_pbids)} persons={len(subset.person_pbids)} "
        f"households={len(subset.household_cmids)}"
    )

    print("[3/9] pruning kept tables")
    _prune(conn, subset)
    print("[3/9] emptying drop-list tables")
    _empty_tables(conn, scan_leaks.DROP_LIST_TABLES)
    print("[4/9] clearing auth/system tables")
    _empty_tables(conn, AUTH_TABLES)
    conn.commit()
    conn.close()

    print("[5/9] anonymizing PII")
    anonymizer.anonymize_db(str(scratch))
    print("[5/9] de-branding (relabel + token scrub)")
    debrand.relabel_db(str(scratch))
    # Branding-derived brand strings + the staff_applications field identifiers; the
    # latter renames the field name inside PB's _collections JSON metadata.
    debrand.scrub_tokens(str(scratch), camp_replacements + list(_BRAND_SCHEMA_COLUMN_RENAMES))

    print("[6/9] scrubbing _params + brand-token schema columns")
    conn = sqlite3.connect(scratch)
    _scrub_params(conn)
    _strip_brand_schema_columns(conn)
    conn.commit()
    conn.close()

    print("[7/9] VACUUM (purging deleted real rows)")
    conn = sqlite3.connect(scratch)
    conn.execute("VACUUM")
    # Leave the DB in WAL mode to match prod: the metrics code opens it read-only and
    # runs `PRAGMA journal_mode=WAL`, which is a harmless no-op on a WAL db but a write
    # (and thus fails read-only) on a DELETE-mode db. TRUNCATE-checkpoint then drop the
    # now-empty -wal/-shm so the committed artifact is a single file.
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    conn.close()
    for suffix in ("-wal", "-shm"):
        sib = scratch.with_name(scratch.name + suffix)
        if sib.exists():
            sib.unlink()

    print("[8/9] leak scan")
    denylist = sorted(set(scan_leaks.build_denylist_from_db(str(real_db))))
    pool = fixtures_pools.pool_tokens()
    deny_tokens = scan_leaks._denylist_token_set(denylist) - pool
    # camp_tokens derived from branding above (no hardcoded brand fallback).

    violations = scan_leaks.scan(str(scratch), denylist=list(deny_tokens), camp_tokens=camp_tokens)
    sys_problems = _system_table_violations(scratch, camp_tokens)
    if violations or sys_problems:
        print("\nLEAK SCAN FAILED — refusing to write artifact.", file=sys.stderr)
        for v in violations[:50]:
            print(f"  {v}", file=sys.stderr)
        for p in sys_problems[:50]:
            print(f"  [system] {p}", file=sys.stderr)
        return 1

    print("[9/9] writing artifact + manifest")
    out.parent.mkdir(parents=True, exist_ok=True)
    with open(scratch, "rb") as fin, gzip.open(out, "wb", compresslevel=9) as fout:
        shutil.copyfileobj(fin, fout)
    counts = _row_counts(scratch)
    manifest = {
        "source_issue": 1623,
        "seed": anonymizer.SEED,
        "target_years": list(select_subset.TARGET_YEARS),
        "row_counts": counts,
        "logical_dump_sha256": _logical_dump_sha(scratch),
        "artifact_bytes": out.stat().st_size,
    }
    out.with_name("MANIFEST.json").write_text(json.dumps(manifest, indent=2) + "\n")
    shutil.rmtree(work, ignore_errors=True)

    nonzero = {t: n for t, n in counts.items() if n}
    print(f"\nOK — wrote {out} ({out.stat().st_size / 1024:.0f} KB)")
    print(f"non-empty tables ({len(nonzero)}): " + ", ".join(f"{t}={n}" for t, n in sorted(nonzero.items())))
    return 0


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Build the synthetic seed artifact (local only).")
    p.add_argument("--real-db", type=Path, default=DEFAULT_REAL_DB)
    p.add_argument("--out", type=Path, default=DEFAULT_OUT)
    p.add_argument("--branding", type=Path, default=DEFAULT_BRANDING)
    args = p.parse_args(argv)
    return build(args.real_db, args.out, args.branding)


if __name__ == "__main__":
    raise SystemExit(main())
