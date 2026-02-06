#!/usr/bin/env python3
"""Generate frontend city coordinate data from uscities.csv.

Reads the SimpleMaps uscities.csv and generates frontend/src/data/cityGeo.ts
containing US_CITY_COORDS and US_CITY_STATES lookups.

For duplicate city names (e.g., Portland OR vs ME), resolves using actual
camper data from PocketBase: persons.address_state with fallback to
households.billing_state. Cities not in camper data use the most populous
version.

Usage:
    # With PocketBase running (uses camper data for disambiguation):
    uv run python scripts/data/seed_city_coords.py

    # Without PocketBase (falls back to most populous for all dupes):
    uv run python scripts/data/seed_city_coords.py --no-pb

    # Custom PocketBase URL:
    uv run python scripts/data/seed_city_coords.py --pb-url http://localhost:8120
"""

import argparse
import csv
import sys
from pathlib import Path

import requests

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
CSV_PATH = REPO_ROOT / "uscities.csv"
OUTPUT_PATH = REPO_ROOT / "frontend" / "src" / "data" / "cityGeo.ts"

DEFAULT_PB_URL = "http://127.0.0.1:8090"


def load_csv() -> list[dict[str, str]]:
    """Load uscities.csv rows."""
    if not CSV_PATH.exists():
        print(f"Error: {CSV_PATH} not found", file=sys.stderr)
        sys.exit(1)
    with open(CSV_PATH, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def query_camper_city_states(pb_url: str) -> dict[str, str]:
    """Query PocketBase for (city, state) pairs from actual camper data.

    Uses persons.address_city + address_state, with fallback to
    households.billing_state via household_id join.

    Returns dict mapping lowercase city name to state abbreviation (e.g., "CA").
    When multiple states exist for a city, picks the one with more campers.
    """
    # Authenticate
    try:
        auth = requests.post(
            f"{pb_url}/api/collections/_superusers/auth-with-password",
            json={"identity": "admin@camp.local", "password": "campbunking123"},
            timeout=5,
        )
        auth.raise_for_status()
        token = auth.json()["token"]
    except (requests.RequestException, KeyError) as e:
        print(f"Warning: Cannot auth to PocketBase ({e}), skipping camper data", file=sys.stderr)
        return {}

    headers = {"Authorization": token}

    # Fetch all persons with address_city (paginated)
    city_state_counts: dict[str, dict[str, int]] = {}  # city_lower -> {state: count}
    page = 1
    per_page = 500

    while True:
        try:
            resp = requests.get(
                f"{pb_url}/api/collections/persons/records",
                params={
                    "fields": "address_city,address_state,household_id",
                    "filter": 'address_city != ""',
                    "perPage": per_page,
                    "page": page,
                },
                headers=headers,
                timeout=30,
            )
            resp.raise_for_status()
            data = resp.json()
        except requests.RequestException as e:
            print(f"Warning: PocketBase query failed on page {page} ({e})", file=sys.stderr)
            break

        items = data.get("items", [])
        if not items:
            break

        for item in items:
            city = (item.get("address_city") or "").strip()
            state = (item.get("address_state") or "").strip()
            if not city:
                continue
            city_lower = city.lower()
            if state:
                city_state_counts.setdefault(city_lower, {})
                city_state_counts[city_lower][state] = city_state_counts[city_lower].get(state, 0) + 1

        if page >= data.get("totalPages", 1):
            break
        page += 1

    # If we got persons with city but no state, try household billing_state
    # Build a household lookup for fallback
    persons_missing_state: list[dict] = []
    page = 1
    while True:
        try:
            resp = requests.get(
                f"{pb_url}/api/collections/persons/records",
                params={
                    "fields": "address_city,address_state,household_id",
                    "filter": 'address_city != "" && address_state = ""',
                    "perPage": per_page,
                    "page": page,
                },
                headers=headers,
                timeout=30,
            )
            resp.raise_for_status()
            data = resp.json()
        except requests.RequestException:
            break

        items = data.get("items", [])
        if not items:
            break
        persons_missing_state.extend(items)
        if page >= data.get("totalPages", 1):
            break
        page += 1

    if persons_missing_state:
        # Get unique household IDs that need billing_state lookup
        hh_ids = {str(int(p["household_id"])) for p in persons_missing_state if p.get("household_id")}

        # Fetch households in batches
        hh_state: dict[str, str] = {}
        hh_list = list(hh_ids)
        batch_size = 50
        for i in range(0, len(hh_list), batch_size):
            batch = hh_list[i : i + batch_size]
            filter_expr = " || ".join(f'household_id = "{hid}"' for hid in batch)
            try:
                resp = requests.get(
                    f"{pb_url}/api/collections/households/records",
                    params={
                        "fields": "household_id,billing_state",
                        "filter": filter_expr,
                        "perPage": batch_size,
                    },
                    headers=headers,
                    timeout=30,
                )
                resp.raise_for_status()
                for hh in resp.json().get("items", []):
                    hid = str(int(hh.get("household_id", 0)))
                    bs = (hh.get("billing_state") or "").strip()
                    if bs:
                        hh_state[hid] = bs
            except requests.RequestException:
                continue

        # Apply household billing_state as fallback
        for p in persons_missing_state:
            city = (p.get("address_city") or "").strip()
            hid = str(int(p.get("household_id", 0))) if p.get("household_id") else ""
            state = hh_state.get(hid, "")
            if city and state:
                city_lower = city.lower()
                city_state_counts.setdefault(city_lower, {})
                city_state_counts[city_lower][state] = city_state_counts[city_lower].get(state, 0) + 1

    # Resolve: for each city, pick the state with the most campers
    result: dict[str, str] = {}
    for city_lower, states in city_state_counts.items():
        best_state = max(states, key=lambda s: states[s])
        result[city_lower] = best_state

    print(f"  Loaded {len(result)} city-state pairs from camper data", file=sys.stderr)
    return result


def generate(camper_states: dict[str, str]) -> None:
    """Generate cityGeo.ts from uscities.csv + camper state data."""
    rows = load_csv()
    print(f"  Loaded {len(rows)} rows from uscities.csv", file=sys.stderr)

    # Group by city name (lowercase) -> (display_name, list of (state, lat, lng, population))
    city_variants: dict[str, tuple[str, list[tuple[str, float, float, int]]]] = {}
    for row in rows:
        name = row["city"].strip()
        state = row["state_id"].strip()
        try:
            lat = float(row["lat"])
            lng = float(row["lng"])
            pop = int(row["population"])
        except (ValueError, KeyError):
            continue
        key = name.lower()
        if key not in city_variants:
            city_variants[key] = (name, [])
        city_variants[key][1].append((state, lat, lng, pop))

    # Resolve each city name to one (coords, state) using camper data or population
    coords: dict[str, tuple[float, float]] = {}  # display_name -> (lat, lng)
    states: dict[str, str] = {}  # display_name -> state_id

    for city_lower, (display_name, variants) in city_variants.items():
        if len(variants) == 1:
            # Unambiguous - only one city with this name
            state, lat, lng, _pop = variants[0]
            coords[display_name] = (lat, lng)
            states[display_name] = state
        else:
            # Ambiguous - check camper data first
            camper_state = camper_states.get(city_lower)
            if camper_state:
                # Find the variant matching the camper state
                match = [v for v in variants if v[0] == camper_state]
                if match:
                    state, lat, lng, _pop = match[0]
                    coords[display_name] = (lat, lng)
                    states[display_name] = state
                    continue

            # Fallback: most populous
            variants.sort(key=lambda v: -v[3])
            state, lat, lng, _pop = variants[0]
            coords[display_name] = (lat, lng)
            states[display_name] = state

    print(f"  Resolved {len(coords)} unique city names", file=sys.stderr)

    # Generate TypeScript
    lines = [
        "/**",
        " * US city coordinates and state mappings.",
        " *",
        " * Auto-generated by scripts/data/seed_city_coords.py from SimpleMaps uscities.csv.",
        " * Do not edit manually - re-run the script to update.",
        " *",
        f" * {len(coords)} cities included.",
        " */",
        "",
        "import type { LatLng } from './californiaGeo'",
        "",
        "export const US_CITY_COORDS: Record<string, LatLng> = {",
    ]

    for name in sorted(coords.keys()):
        lat, lng = coords[name]
        # Quote keys that need it (contain spaces, hyphens, etc.)
        key = repr(name) if not name.isidentifier() else name
        lines.append(f"  {key}: [{lat}, {lng}],")

    lines.append("}")
    lines.append("")
    lines.append("export const US_CITY_STATES: Record<string, string> = {")

    for name in sorted(states.keys()):
        key = repr(name) if not name.isidentifier() else name
        lines.append(f"  {key}: {repr(states[name])},")

    lines.append("}")
    lines.append("")

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text("\n".join(lines), encoding="utf-8")
    size_kb = OUTPUT_PATH.stat().st_size / 1024
    print(f"  Generated {OUTPUT_PATH.name} ({size_kb:.0f} KB)", file=sys.stderr)


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate frontend city coordinate data")
    parser.add_argument(
        "--no-pb",
        action="store_true",
        help="Skip PocketBase query (use most populous for all duplicates)",
    )
    parser.add_argument(
        "--pb-url",
        default=DEFAULT_PB_URL,
        help=f"PocketBase URL (default: {DEFAULT_PB_URL})",
    )
    args = parser.parse_args()

    print("Generating city coordinates...", file=sys.stderr)

    camper_states: dict[str, str] = {}
    if not args.no_pb:
        camper_states = query_camper_city_states(args.pb_url)
    else:
        print("  Skipping PocketBase (--no-pb), using most populous for duplicates", file=sys.stderr)

    generate(camper_states)
    print("Done.", file=sys.stderr)


if __name__ == "__main__":
    main()
