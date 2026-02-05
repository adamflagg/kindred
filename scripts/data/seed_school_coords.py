#!/usr/bin/env python3
"""Seed schools.json from NCES (National Center for Education Statistics) data.

Reads the NCES EDGE geocode file (pipe-delimited TXT with lat/lng) and the
CCD Directory CSV (for school status), filters to California, and writes to
bunking/geo_normalizer/data/schools.json.

Data sources:
- EDGE Geocode: https://nces.ed.gov/programs/edge/geographic/schoollocations
  Download URL (2024-25): https://nces.ed.gov/ccd/Data/zip/ccd_sch_029_2425_w_1a_073025.zip
- CCD Directory: https://nces.ed.gov/ccd/files.asp
  Select: Nonfiscal > School level > Directory > Most recent year

EDGE geocode file format (pipe-delimited, no header):
  NCESSCH|LEAID|SCH_NAME|STATE_FIPS|ADDRESS|CITY|STATE|ZIP|...|LAT|LON|...

CCD Directory CSV columns used:
  NCESSCH, SCH_NAME, FIPST, SY_STATUS_TEXT

Usage:
    # With both files in the repo root:
    uv run python scripts/data/seed_school_coords.py

    # Or specify paths:
    uv run python scripts/data/seed_school_coords.py \\
        --geocode path/to/EDGE_GEOCODE_PUBLICSCH_2425.TXT \\
        --directory path/to/ccd_sch_029_2425_w_1a_073025.csv

This script is idempotent - running it again will overwrite the existing file.
"""

import argparse
import csv
import json
from pathlib import Path

# California FIPS state code
CA_FIPS = "06"

# Script and output paths
SCRIPT_DIR = Path(__file__).parent
REPO_ROOT = SCRIPT_DIR.parent.parent
OUTPUT_PATH = REPO_ROOT / "bunking" / "geo_normalizer" / "data" / "schools.json"

# Known private/independent schools not in NCES public data
# These are common Bay Area Jewish day schools and private schools
SUPPLEMENTAL_SCHOOLS: dict[str, list[float]] = {
    "Brandeis Marin": [37.9453, -122.5097],
    "Brandeis School of San Francisco": [37.7849, -122.4094],
    "Gideon Hausner Jewish Day School": [37.4419, -122.1430],
    "Jewish Community High School of the Bay": [37.7749, -122.4194],
    "Kehillah Jewish High School": [37.4419, -122.1430],
    "Lick-Wilmerding High School": [37.7422, -122.4281],
    "Mark Day School": [37.9600, -122.5350],
    "Marin Academy": [37.9735, -122.5311],
    "Marin Country Day School": [37.8970, -122.5310],
    "Marin Primary & Middle School": [37.8726, -122.5000],
    "Marin Waldorf School": [37.9700, -122.5600],
    "Park Day School": [37.8395, -122.2530],
    "Redwood Day School": [37.8100, -122.2350],
    "Ronald C. Wornick Jewish Day School": [37.3861, -122.0839],
    "San Francisco Day School": [37.7505, -122.4337],
    "San Francisco University High School": [37.7870, -122.4490],
    "Stuart Hall for Boys": [37.7925, -122.4388],
    "The Bay School of San Francisco": [37.8013, -122.4525],
    "The Hamlin School": [37.7945, -122.4390],
    "The Saklan School": [37.8350, -122.1300],
    "Town School for Boys": [37.7935, -122.4370],
    "Urban School of San Francisco": [37.7856, -122.4390],
    "Yavneh Day School": [37.3400, -122.0600],
}


def find_file(pattern: str) -> Path | None:
    """Find a file matching pattern in the repo root."""
    matches = list(REPO_ROOT.glob(pattern))
    return matches[0] if matches else None


def load_closed_schools(directory_path: Path | None) -> set[str]:
    """Load NCESSCH IDs of closed/inactive schools from CCD Directory CSV."""
    if directory_path is None or not directory_path.exists():
        print("No CCD Directory file found - skipping closed school filtering")
        return set()

    closed = set()
    with open(directory_path, encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for row in reader:
            status = row.get("SY_STATUS_TEXT", "").strip().lower()
            if "closed" in status or "inactive" in status:
                ncessch = row.get("NCESSCH", "").strip()
                if ncessch:
                    closed.add(ncessch)

    print(f"Found {len(closed)} closed/inactive schools in CCD Directory")
    return closed


def parse_geocode_file(geocode_path: Path, closed_ids: set[str]) -> list[dict]:
    """Parse NCES EDGE geocode file (pipe-delimited, no header).

    Columns (0-indexed):
      0: NCESSCH, 1: LEAID, 2: SCH_NAME, 3: STATE_FIPS,
      4: ADDRESS, 5: CITY, 6: STATE, 7: ZIP, 8: ?, 9: ?,
      10: COUNTY_NAME, 11: ?, 12: LAT, 13: LON, ...
    """
    schools = []

    with open(geocode_path, encoding="utf-8-sig") as f:
        for line in f:
            fields = line.strip().split("|")
            if len(fields) < 14:
                continue

            ncessch = fields[0].strip()
            name = fields[2].strip()
            state_fips = fields[3].strip()
            lat_str = fields[12].strip()
            lon_str = fields[13].strip()

            # Filter to California only
            if state_fips != CA_FIPS:
                continue

            # Skip closed schools
            if ncessch in closed_ids:
                continue

            # Skip schools without valid coordinates
            if not lat_str or not lon_str:
                continue

            try:
                lat = float(lat_str)
                lon = float(lon_str)
            except ValueError:
                continue

            # Validate California coordinate range
            if not (32 < lat < 42 and -125 < lon < -114):
                continue

            if not name:
                continue

            schools.append(
                {
                    "name": name,
                    "lat": lat,
                    "lon": lon,
                }
            )

    print(f"Found {len(schools)} California public schools with coordinates")
    return schools


def build_json(schools: list[dict]) -> dict:
    """Build the schools.json structure with lookup + coords."""
    lookup: dict[str, str] = {}
    coords: dict[str, list[float]] = {}

    for school in schools:
        name: str = school["name"]
        # Keep original NCES casing (usually ALL CAPS) but title-case it
        canonical = name.title()

        # Deduplicate: keep first occurrence
        lower = canonical.lower()
        if lower not in lookup:
            lookup[lower] = canonical
            coords[canonical] = [round(school["lat"], 4), round(school["lon"], 4)]

    # Add supplemental private schools
    for name, coord in SUPPLEMENTAL_SCHOOLS.items():
        lower = name.lower()
        if lower not in lookup:
            lookup[lower] = name
            coords[name] = coord

    print(f"Total: {len(lookup)} unique schools in lookup, {len(coords)} with coordinates")

    return {
        "lookup": dict(sorted(lookup.items())),
        "coords": dict(sorted(coords.items())),
    }


def main() -> None:
    """Main entry point."""
    parser = argparse.ArgumentParser(description="Seed schools.json from NCES data")
    parser.add_argument("--geocode", type=Path, help="Path to EDGE geocode TXT file")
    parser.add_argument("--directory", type=Path, help="Path to CCD Directory CSV file")
    args = parser.parse_args()

    # Find files
    geocode_path = args.geocode or find_file("EDGE_GEOCODE_PUBLICSCH_*.TXT")
    directory_path = args.directory or find_file("ccd_sch_029_*.csv")

    if geocode_path is None or not geocode_path.exists():
        print("ERROR: EDGE geocode file not found.")
        print("Download from: https://nces.ed.gov/programs/edge/geographic/schoollocations")
        print("Or specify: --geocode path/to/EDGE_GEOCODE_PUBLICSCH_XXXX.TXT")
        print("\nFalling back to supplemental schools only...")
        schools: list[dict] = []
    else:
        print(f"Using geocode file: {geocode_path}")
        closed_ids = load_closed_schools(directory_path)
        schools = parse_geocode_file(geocode_path, closed_ids)

    data = build_json(schools)

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, "w") as f:
        json.dump(data, f, indent=2)

    file_size = OUTPUT_PATH.stat().st_size / 1024
    print(f"Wrote {OUTPUT_PATH} ({file_size:.0f}KB)")


if __name__ == "__main__":
    main()
