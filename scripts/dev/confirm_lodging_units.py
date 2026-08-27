#!/usr/bin/env python3
"""DEV ONLY: mark lodging units confirmed, so the roster's fit check lights up.

`is_confirmed` means A HUMAN HAS CHECKED THIS CABIN FOR THIS SEASON (kindred#2500)
— it is a per-season assertion, not a permanent one, and year roll-forward
resets it to false on every unit it creates regardless of direction. Everything
the registry loader writes is a guess from a spreadsheet, so it writes `false`
on every row, and `partyAttention` refuses to judge a housing need against an
unconfirmed cabin — `has_power: false` there means "nobody has said", not "no
power". With none of the registry's 114 units confirmed, every constrained
party reports `unverified` and the whole fit check reads as dark.

That is correct behaviour, and it makes the board hard to develop against. This
script flips the flag on a LOCAL database so the surface can be built and seen
working. It is not a substitute for staff confirming cabins.

RUNNING THIS AGAINST PRODUCTION IS A SEPARATE AND DELIBERATE DECISION, and it
would be the wrong one: it would assert to staff that every cabin in the
registry had been checked when none had. The script refuses non-local URLs
unless you pass --i-know-this-is-not-local.

ONE SEASON AT A TIME. `lodging_units` carries a `year` since 1500000141, so
--year (default CAMPMINDER_SEASON_ID) picks which season's registry is being
vouched for. Confirming every season at once would restate, for a year whose
roster is already settled, that a human checked those cabins.

    scripts/dev/confirm_lodging_units.py                  # show what would change
    scripts/dev/confirm_lodging_units.py --apply          # confirm this season's units
    scripts/dev/confirm_lodging_units.py --apply --undo   # put it back
    scripts/dev/confirm_lodging_units.py --apply --year 2027
"""

from __future__ import annotations

import argparse
import os
import sys
from datetime import datetime
from typing import Any
from urllib.parse import urlparse

import requests

LOCAL_HOSTS = {"127.0.0.1", "localhost", "::1", "0.0.0.0"}


def is_local(url: str) -> bool:
    """Local means a loopback host. Anything else is someone's real data."""
    return (urlparse(url).hostname or "") in LOCAL_HOSTS


def _auth(base: str, identity: str, password: str) -> str:
    resp = requests.post(
        f"{base}/api/collections/_superusers/auth-with-password",
        json={"identity": identity, "password": password},
        timeout=30,
    )
    resp.raise_for_status()
    return str(resp.json()["token"])


def _units(base: str, token: str, year: int) -> list[dict[str, Any]]:
    """Fetch ONE season's units.

    `lodging_units` holds a row per unit per year since 1500000141. Confirming
    every season at once would restate, for a prior year, that a human checked
    cabins in the state that year's roster was already judged against — and
    `--undo` would clear that same prior confirmation. Same reasoning, and the
    same filter, as `apply_lodging_inventory._fetch_units`.
    """
    out: list[dict[str, Any]] = []
    page = 1
    while True:
        params: dict[str, Any] = {"filter": f"year = {year}", "perPage": 200, "page": page}
        resp = requests.get(
            f"{base}/api/collections/lodging_units/records",
            params=params,
            headers={"Authorization": token},
            timeout=60,
        )
        resp.raise_for_status()
        body = resp.json()
        out.extend(body["items"])
        if page >= body["totalPages"]:
            break
        page += 1
    return out


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default=os.environ.get("POCKETBASE_URL", "http://127.0.0.1:8090"))
    parser.add_argument("--identity", default=os.environ.get("PB_ADMIN_EMAIL", "admin@camp.local"))
    parser.add_argument("--password", default=os.environ.get("PB_ADMIN_PASSWORD", ""))
    parser.add_argument("--apply", action="store_true", help="write (default: dry run)")
    parser.add_argument("--undo", action="store_true", help="set is_confirmed back to false")
    parser.add_argument(
        "--i-know-this-is-not-local",
        action="store_true",
        help="required for a non-loopback URL; confirming cabins nobody checked is a lie to staff",
    )
    # Compute default year: use CAMPMINDER_SEASON_ID if it's numeric, else fall back to calendar year
    season_id = os.getenv("CAMPMINDER_SEASON_ID", "")
    default_year = int(season_id) if season_id.isdigit() else datetime.now().year
    parser.add_argument(
        "--year",
        type=int,
        default=default_year,
        help="Season to confirm. Defaults to CAMPMINDER_SEASON_ID.",
    )
    args = parser.parse_args(argv)

    if not is_local(args.url) and not args.i_know_this_is_not_local:
        print(
            f"refusing: {args.url} is not local.\n"
            "is_confirmed asserts a human checked the cabin. Setting it in bulk on a real\n"
            "database tells staff every cabin was verified when none were.\n"
            "Pass --i-know-this-is-not-local if you genuinely mean to.",
            file=sys.stderr,
        )
        return 2

    if not args.password:
        print("error: set PB_ADMIN_PASSWORD (or pass --password)", file=sys.stderr)
        return 2

    want = not args.undo
    token = _auth(args.url, args.identity, args.password)
    units = _units(args.url, token, args.year)
    todo = [u for u in units if bool(u.get("is_confirmed")) != want]

    print(f"{len(units)} units in {args.year}; {len(todo)} to set is_confirmed={want}")
    if not args.apply:
        print("DRY RUN — nothing written. Re-run with --apply.")
        return 0

    for u in todo:
        resp = requests.patch(
            f"{args.url}/api/collections/lodging_units/records/{u['id']}",
            json={"is_confirmed": want},
            headers={"Authorization": token},
            timeout=30,
        )
        resp.raise_for_status()
    print(f"set is_confirmed={want} on {len(todo)} unit(s).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
