#!/usr/bin/env python3
"""DEV ONLY: seed the two-households-on-one-CONTAINER case, so kindred#2371 is visible.

WHY THIS EXISTS. The bug PR #2404 fixes has no naturally-occurring example in
the data, so there is nothing to point a browser at. Every ambiguous placement
on the 2026 registry reaches the guard through the ALIAS route -- a placement
that NAMES two room codes -- and that route was already handled. The route that
was broken is the one where a placement names ONE CONTAINER whose expansion is
two rooms. Nobody has ever placed two households that way, so the difference
between the fixed board and the unfixed board is invisible without this script.

WHAT IT SEEDS. Two fictional family-camp households, both placed on the SAME
container unit (default: `hc-downstairs`, which expands to HC Downstairs A and
HC Downstairs B), on the same weekend, both with `share_eligibility = declined`
-- the eligibility that DOES raise the amber flag once an overlap is found, so
a silent board is the guard working rather than the fixture having nothing to
report.

WHAT TO EXPECT, running the SAME script against both databases:

  UNFIXED (main)      the card carries the amber consent flag,
                      "2 families did not request sharing", and each family
                      card carries the same chip.
  FIXED (#2404)       no amber flag and no chip: H = 2 households claiming an
                      N = 2 room set is one household per room, which is
                      ambiguous, not a confirmed share.

THE RULE BEING DEMONSTRATED (`boardLayout.ts`, `overlappingPartyKeys`): H
households all claiming the same N-room set is evidence of a real double-
booking only once H exceeds N. Pass `--parties 3` to cross that line -- three
households on a two-room house DOES flag, on both boards, which is the control
that proves the guard narrows only the ambiguous case.

DEV DATABASES ONLY. This writes fabricated households, people, attendees,
registrations and placements straight into SQLite. It refuses any path
containing `data-prod`, and it should never be pointed at anything but a local
throwaway copy. Every row it writes carries the id prefix `demo2371`, so a
re-run deletes exactly its own rows and touches nothing else -- it is safely
re-runnable, and `--remove` undoes it completely.

  uv run python scripts/dev/seed_container_consent_demo.py --db pocketbase/pb_data/data.db
  uv run python scripts/dev/seed_container_consent_demo.py --db pocketbase/pb_data/data.db --remove

Seed BEFORE starting the dev servers, or restart them afterwards: the FastAPI
layer caches the year-scoped reads (`lodging_cache`, ~15 min), so a running
server will not see new households until it restarts.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
import sys
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

# Every seeded row's id starts with this. It is the whole safety story: the
# delete is `id LIKE 'demo2371%'`, which cannot reach a row this script did not
# write, so "idempotent" needs no bookkeeping table and no dry-run diffing.
ID_PREFIX = "demo2371"

# PocketBase ids are exactly 15 lowercase-alphanumeric characters. Ours are
# deterministic rather than random so the two databases hold byte-identical
# rows and the A/B comparison is provably the same scenario.
ID_WIDTH = 15

DEFAULT_YEAR = 2026
# Family Camp 1: Memorial Day Weekend -- the weekend with placements already on
# it, so the seeded card sits among real ones rather than on an empty board.
DEFAULT_SESSION_CM_ID = 1309514
# A container with exactly two leaf rooms, unoccupied on the default weekend,
# and already resolved COMBINED there (a weekend-level `lodging_slot_merges`
# row), so the board draws it as ONE card and both households land on it.
DEFAULT_UNIT_CODE = "hc-downstairs"

# Fictional, per CLAUDE.md section 4. Never put a real camper, family or staff
# name in a fixture, a seed or anything else that can be read back out.
HOUSEHOLDS = [
    {
        "cm_id": 990002371,
        "mailing_title": "The Johnson Family",
        "greeting": "Emma and Noah Johnson",
        "adult": "Emma Johnson",
        "child_first": "Noah",
        "child_last": "Johnson",
        "child_cm_id": 990012371,
        "child_birthdate": "2017-04-11",
        "child_age": 9.01,
        "child_grade": 3,
    },
    {
        "cm_id": 990002372,
        "mailing_title": "The Garcia Family",
        "greeting": "Liam and Ava Garcia",
        "adult": "Liam Garcia",
        "child_first": "Ava",
        "child_last": "Garcia",
        "child_cm_id": 990012372,
        "child_birthdate": "2016-09-02",
        "child_age": 9.08,
        "child_grade": 4,
    },
    {
        "cm_id": 990002373,
        "mailing_title": "The Martinez Family",
        "greeting": "Ava and Mateo Martinez",
        "adult": "Ava Martinez",
        "child_first": "Mateo",
        "child_last": "Martinez",
        "child_cm_id": 990012373,
        "child_birthdate": "2015-12-19",
        "child_age": 10.02,
        "child_grade": 5,
    },
]

# Tables this script writes, in delete order. Listed explicitly rather than
# discovered: a table added to the seed must be added here too, or `--remove`
# would leave rows behind and the next run would collide on a unique index.
SEEDED_TABLES = (
    "lodging_assignments",
    "attendees",
    "family_camp_adults",
    "family_camp_registrations",
    "persons",
    "households",
)


class SeedError(RuntimeError):
    """Anything that means the demo would not actually demonstrate the bug."""


@dataclass(frozen=True)
class Scene:
    """The verified target: which weekend, which container, and its rooms."""

    session_pb_id: str
    session_name: str
    unit_pb_id: str
    unit_code: str
    unit_name: str
    leaves: tuple[str, ...]
    combined: bool


def demo_id(kind: str, index: int) -> str:
    """A stable 15-char PocketBase id inside our own namespace."""
    suffix = f"{kind}{index:05d}"
    value = f"{ID_PREFIX}{suffix}"
    if len(value) != ID_WIDTH or not value.isalnum() or value.lower() != value:
        raise SeedError(f"generated id {value!r} is not a valid PocketBase id")
    return value


def now_stamp() -> str:
    """PocketBase's timestamp format: `2026-08-17 09:12:33.123Z`."""
    moment = datetime.now(UTC)
    return moment.strftime("%Y-%m-%d %H:%M:%S.") + f"{moment.microsecond // 1000:03d}Z"


def guard_path(raw: str) -> Path:
    """Refuse the production snapshot, and refuse a path that is not there.

    `data-prod` is checked on the RESOLVED path, so a symlink cannot smuggle it
    past. The repo root also holds a 0-byte `data-prod.db` decoy that returns
    zero rows with no error, which is exactly why the guard is on the name and
    not on the contents.
    """
    path = Path(raw).expanduser().resolve()
    if "data-prod" in path.name.lower() or "data-prod" in str(path).lower():
        raise SeedError(f"refusing to touch a production snapshot: {path}")
    if not path.is_file():
        raise SeedError(f"no such database: {path}")
    return path


def leaf_codes_under(conn: sqlite3.Connection, year: int, unit_id: str) -> list[str]:
    """Every LEAF code beneath `unit_id`, mirroring `unitLevel.ts:coveredCodes`.

    Leaf-ness reads the `is_container` FLAG, never the child count, for the
    same reason the client does: a childless container is an explicit "never
    bookable" marker, and inferring bookability from missing children is what
    the flag exists to prevent.
    """
    leaves: list[str] = []
    seen: set[str] = set()
    queue = [unit_id]
    while queue:
        current = queue.pop(0)
        if current in seen:
            continue
        seen.add(current)
        row = conn.execute(
            "SELECT code, is_container FROM lodging_units WHERE id = ? AND year = ?",
            (current, year),
        ).fetchone()
        if row is None:
            continue
        if not _truthy(row["is_container"]):
            leaves.append(row["code"])
            continue
        for child in conn.execute(
            "SELECT id FROM lodging_units WHERE parent_unit = ? AND year = ?",
            (current, year),
        ).fetchall():
            queue.append(child["id"])
    return sorted(leaves)


def _truthy(value: object) -> bool:
    """SQLite booleans here are 1/0, '' or 'true' depending on the writer."""
    return value not in (None, "", 0, "0", False, "false")


def resolve_scene(conn: sqlite3.Connection, year: int, session_cm_id: int, unit_code: str, parties: int) -> Scene:
    """Everything the seed needs, verified before a single row is written."""
    session = conn.execute(
        "SELECT id, name, session_type, start_date FROM camp_sessions WHERE cm_id = ? AND year = ?",
        (session_cm_id, year),
    ).fetchone()
    if session is None:
        raise SeedError(f"no camp_sessions row for cm_id={session_cm_id} year={year}")
    if session["session_type"] != "family":
        raise SeedError(
            f"session {session_cm_id} is session_type={session['session_type']!r}; "
            "the consent flag only applies to household-grain FAMILY weekends "
            "(an adult weekend has no share question at all)"
        )

    unit = conn.execute(
        "SELECT id, code, name, is_container, default_combined FROM lodging_units WHERE code = ? AND year = ?",
        (unit_code, year),
    ).fetchone()
    if unit is None:
        raise SeedError(f"no lodging_units row for code={unit_code!r} year={year}")
    if not _truthy(unit["is_container"]):
        raise SeedError(
            f"{unit_code!r} is a LEAF, not a container. This demo needs a container "
            "whose expansion is 2+ rooms -- two households on one leaf is a genuine "
            "same-room share and flags on both boards, which demonstrates nothing."
        )

    leaves = leaf_codes_under(conn, year, unit["id"])
    if len(leaves) < 2:
        raise SeedError(
            f"{unit_code!r} expands to {len(leaves)} room(s) ({leaves}); the ambiguous "
            "case needs at least 2 so that H <= N can hold"
        )

    # The weekend-level / registry answer to "is this drawn as one card".
    merge = conn.execute(
        "SELECT combined FROM lodging_slot_merges WHERE unit = ? AND year = ? AND session_cm_id = ? AND scenario = ''",
        (unit["id"], year, session_cm_id),
    ).fetchone()
    combined = _truthy(merge["combined"]) if merge is not None else _truthy(unit["default_combined"])

    # A pre-existing placement on this container or any of its rooms changes H,
    # and would silently turn the ambiguous demo into a real double-booking.
    occupants = []
    for row in conn.execute(
        "SELECT id, household_cm_id, units FROM lodging_assignments "
        "WHERE year = ? AND session_cm_id = ? AND id NOT LIKE ?",
        (year, session_cm_id, f"{ID_PREFIX}%"),
    ).fetchall():
        try:
            named = json.loads(row["units"] or "[]")
        except TypeError, ValueError:
            continue
        for unit_pb_id in named:
            hit = conn.execute(
                "SELECT code FROM lodging_units WHERE id = ? AND year = ?", (unit_pb_id, year)
            ).fetchone()
            if hit is None:
                continue
            if hit["code"] == unit_code or hit["code"] in leaves:
                occupants.append((row["household_cm_id"], hit["code"]))
    if occupants:
        raise SeedError(
            f"{unit_code!r} is already occupied on this weekend by {occupants}. "
            "Pick a free container with --unit-code, or the seeded households would "
            "not be the only claimants and H would not equal N."
        )

    if parties > len(HOUSEHOLDS):
        raise SeedError(f"--parties {parties} exceeds the {len(HOUSEHOLDS)} fictional households defined here")

    return Scene(
        session_pb_id=session["id"],
        session_name=session["name"],
        unit_pb_id=unit["id"],
        unit_code=unit["code"],
        unit_name=unit["name"],
        leaves=tuple(leaves),
        combined=combined,
    )


def remove_demo_rows(conn: sqlite3.Connection) -> int:
    """Delete exactly this script's own rows. Never touches anything else."""
    removed = 0
    for table in SEEDED_TABLES:
        cursor = conn.execute(f"DELETE FROM {table} WHERE id LIKE ?", (f"{ID_PREFIX}%",))
        removed += cursor.rowcount if cursor.rowcount and cursor.rowcount > 0 else 0
    return removed


def seed(conn: sqlite3.Connection, scene: Scene, year: int, session_cm_id: int, parties: int) -> None:
    stamp = now_stamp()
    units_json = json.dumps([scene.unit_pb_id])

    for index in range(parties):
        spec = HOUSEHOLDS[index]
        household_id = demo_id("hh", index + 1)
        person_id = demo_id("pe", index + 1)

        conn.execute(
            "INSERT INTO households (id, cm_id, year, mailing_title, greeting, "
            "billing_mailing_title, alternate_mailing_title, household_phone, "
            "billing_address1, billing_address2, billing_city, billing_state, "
            "billing_postal_code, billing_country, created, updated) "
            "VALUES (?, ?, ?, ?, ?, '', '', '', '', '', '', '', '', '', ?, ?)",
            (household_id, spec["cm_id"], year, spec["mailing_title"], spec["greeting"], stamp, stamp),
        )

        conn.execute(
            "INSERT INTO persons (id, cm_id, year, household, household_id, first_name, last_name, "
            "preferred_name, birthdate, age, grade, gender, is_camper, tags, created, updated, "
            "alternate_childhood_household, cm_lead_date, division, gender_identity_id, "
            "gender_identity_name, gender_identity_write_in, gender_pronoun_id, gender_pronoun_name, "
            "gender_pronoun_write_in, last_year_attended, lead_date, partition_id, "
            "primary_childhood_household, school, tshirt_size, years_at_camp, address_city, "
            "address_state, primary_email, secondary_email, normalized_school, normalized_city, "
            "normalized_congregation) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, '', 1, '[]', ?, ?, "
            "'', '', '', 0, '', '', 0, '', '', 0, '', 0, '', '', '', 0, '', '', '', '', '', '', '')",
            (
                person_id,
                spec["child_cm_id"],
                year,
                household_id,
                spec["cm_id"],
                spec["child_first"],
                spec["child_last"],
                spec["child_birthdate"],
                spec["child_age"],
                spec["child_grade"],
                stamp,
                stamp,
            ),
        )

        conn.execute(
            "INSERT INTO attendees (id, person, person_id, session, year, status, status_id, "
            "enrollment_date, effective_date, last_updated_utc, created, updated) "
            "VALUES (?, ?, ?, ?, ?, 'Enrolled', 2, '', '', '', ?, ?)",
            (
                demo_id("at", index + 1),
                person_id,
                spec["child_cm_id"],
                scene.session_pb_id,
                year,
                stamp,
                stamp,
            ),
        )

        # share_cabin_gate stays '' -> the roster reports preference "unknown",
        # matching the PR's own fixture. `declined` eligibility from the FORM is
        # what raises the flag; the registration gate is deliberately not what
        # this surface judges on (see `consentFlag`'s "WHY NOT THE GATE").
        conn.execute(
            "INSERT INTO family_camp_registrations (id, household, year, share_eligibility, "
            "share_eligibility_source, share_answers_conflict, share_cabin_gate, "
            "share_cabin_preference, shared_cabin_modes_raw, wants_near, wants_with, "
            "wants_similar_ages, request_text, request_source_field, request_last_updated, "
            "arrival_eta, cabin_assignment, goals, notes, special_occasions, needs_accommodation, "
            "needs_private_bathroom, needs_power, accommodation_is_mandatory, has_infant, "
            "created, updated) "
            "VALUES (?, ?, ?, 'declined', 'form', 0, '', '', '', 0, 0, 0, '', '', '', "
            "'', '', '', '', '', 0, 0, 0, 0, 0, ?, ?)",
            (demo_id("fr", index + 1), household_id, year, stamp, stamp),
        )

        conn.execute(
            "INSERT INTO family_camp_adults (id, household, year, adult_number, name, first_name, "
            "last_name, relationship_to_camper, date_of_birth, email, gender, pronouns, created, updated) "
            "VALUES (?, ?, ?, 1, ?, '', '', 'Parent', '', '', '', '', ?, ?)",
            (demo_id("fa", index + 1), household_id, year, spec["adult"], stamp, stamp),
        )

        # THE POINT OF THE WHOLE SCRIPT: one CONTAINER code in `units`, not the
        # two room codes. Naming the rooms explicitly is the alias route, which
        # was already guarded before #2404 and shows no difference.
        conn.execute(
            "INSERT INTO lodging_assignments (id, year, session, session_cm_id, household_cm_id, "
            "person_cm_id, party_size, units, source, staff_touched, created, updated) "
            "VALUES (?, ?, ?, ?, ?, 0, 2, ?, 'demo-2371', 0, ?, ?)",
            (
                demo_id("la", index + 1),
                year,
                scene.session_pb_id,
                session_cm_id,
                spec["cm_id"],
                units_json,
                stamp,
                stamp,
            ),
        )


def describe(conn: sqlite3.Connection) -> list[tuple[str, ...]]:
    """The seeded rows, in a stable shape both databases can be diffed on.

    Deliberately EXCLUDES `created`/`updated`: the two databases are seeded
    seconds apart, and a timestamp difference would make identical scenarios
    look different. Everything that decides what the board renders is here.
    """
    rows = conn.execute(
        "SELECT a.id, a.household_cm_id, a.session_cm_id, a.year, a.units, "
        "       h.mailing_title, r.share_eligibility, r.share_eligibility_source, "
        "       p.first_name || ' ' || p.last_name AS child, at.status_id "
        "FROM lodging_assignments a "
        "JOIN households h ON h.cm_id = a.household_cm_id AND h.year = a.year "
        "LEFT JOIN family_camp_registrations r ON r.household = h.id AND r.year = h.year "
        "LEFT JOIN persons p ON p.household = h.id "
        "LEFT JOIN attendees at ON at.person = p.id "
        "WHERE a.id LIKE ? ORDER BY a.id",
        (f"{ID_PREFIX}%",),
    ).fetchall()
    return [tuple("" if value is None else str(value) for value in row) for row in rows]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="DEV ONLY: seed the two-households-on-one-container consent case (kindred#2371).",
    )
    parser.add_argument("--db", required=True, help="path to a DEV pocketbase data.db (never data-prod)")
    parser.add_argument("--year", type=int, default=DEFAULT_YEAR)
    parser.add_argument("--session-cm-id", type=int, default=DEFAULT_SESSION_CM_ID)
    parser.add_argument("--unit-code", default=DEFAULT_UNIT_CODE, help="a CONTAINER code with 2+ leaf rooms")
    parser.add_argument(
        "--parties",
        type=int,
        default=2,
        help="households to place on the container. 2 is the ambiguous case (H == N). "
        "3 crosses H > N and flags on BOTH boards -- the control.",
    )
    parser.add_argument("--remove", action="store_true", help="delete the seeded rows and exit")
    args = parser.parse_args(argv)

    try:
        db_path = guard_path(args.db)
    except SeedError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    conn = sqlite3.connect(str(db_path), timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA busy_timeout = 30000")
    try:
        with conn:
            removed = remove_demo_rows(conn)
            if args.remove:
                print(f"removed {removed} seeded row(s) from {db_path}")
                return 0
            scene = resolve_scene(conn, args.year, args.session_cm_id, args.unit_code, args.parties)
            seed(conn, scene, args.year, args.session_cm_id, args.parties)
    except SeedError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    rows = describe(conn)
    digest = hashlib.sha256("\n".join("|".join(row) for row in rows).encode()).hexdigest()[:16]
    conn.close()

    leaves = scene.leaves
    print(f"database      {db_path}")
    print(f"weekend       {scene.session_name}  (cm_id {args.session_cm_id})")
    print(f"unit          {scene.unit_name}  code={scene.unit_code}  drawn_as_one_card={scene.combined}")
    print(f"rooms beneath N = {len(leaves)}  {leaves}")
    print(f"households    H = {args.parties}  {[HOUSEHOLDS[i]['mailing_title'] for i in range(args.parties)]}")
    print(f"cleared       {removed} previously-seeded row(s)")
    print(f"digest        {digest}   (identical across two databases == identical scenario)")
    print()
    for row in rows:
        print("  " + " | ".join(row))
    print()
    if args.parties <= len(leaves):
        print(f"H = {args.parties} <= N = {len(leaves)}: AMBIGUOUS.")
        print('  unfixed board -> amber flag, "2 families did not request sharing"')
        print("  fixed board   -> no flag, no chip")
    else:
        print(f"H = {args.parties} > N = {len(leaves)}: a real double-booking. BOTH boards flag.")
    print()
    print(f"Open:  /weekend/{args.session_cm_id}/housing   (look for the '{scene.unit_name}' card)")
    print("Restart the dev servers if they were already running -- the API caches year-scoped reads.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
