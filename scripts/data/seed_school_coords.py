#!/usr/bin/env python3
"""Seed schools.json from NCES (National Center for Education Statistics) data.

Reads the NCES EDGE geocode file (pipe-delimited TXT with lat/lng), the
CCD Directory CSV (for school status), and the PSS (Private School Survey)
CSV for private schools.  Filters to California and writes to
bunking/geo_normalizer/data/schools.json.

Data sources:
- EDGE Geocode: https://nces.ed.gov/programs/edge/geographic/schoollocations
  Download URL (2024-25): https://nces.ed.gov/ccd/Data/zip/ccd_sch_029_2425_w_1a_073025.zip
- CCD Directory: https://nces.ed.gov/ccd/files.asp
  Select: Nonfiscal > School level > Directory > Most recent year
- PSS (Private School Survey): https://nces.ed.gov/surveys/pss/pssdata.asp
  Most recent: 2021-22 (pss2122_pu.csv)

EDGE geocode file format (pipe-delimited, no header):
  NCESSCH|LEAID|SCH_NAME|STATE_FIPS|ADDRESS|CITY|STATE|ZIP|...|LAT|LON|...

CCD Directory CSV columns used:
  NCESSCH, SCH_NAME, FIPST, SY_STATUS_TEXT

PSS CSV columns used:
  PINST (name), PCITY (city), PSTABB (state abbrev), LATITUDE22, LONGITUDE22

Usage:
    # With files in tempsources/:
    uv run python scripts/data/seed_school_coords.py \\
        --geocode tempsources/EDGE_GEOCODE_PUBLICSCH_2425.TXT \\
        --directory tempsources/ccd_sch_029_2425_w_1a_073025.csv \\
        --pss tempsources/pss2122_pu.csv

    # Or let auto-discovery find them in the repo root:
    uv run python scripts/data/seed_school_coords.py

This script is idempotent - running it again will overwrite the existing file.
"""

import argparse
import csv
import json
from pathlib import Path
from typing import Any

# California FIPS state code
CA_FIPS = "06"

# Script and output paths
SCRIPT_DIR = Path(__file__).parent
REPO_ROOT = SCRIPT_DIR.parent.parent
OUTPUT_PATH = REPO_ROOT / "bunking" / "geo_normalizer" / "data" / "schools.json"

# Known private/independent schools not in NCES public data
# Format: name -> {"coords": [lat, lon], "city": city, "state": state}
SUPPLEMENTAL_SCHOOLS: dict[str, dict[str, Any]] = {
    "Brandeis Marin": {"coords": [37.9453, -122.5097], "city": "San Rafael", "state": "CA"},
    "Brandeis School of San Francisco": {"coords": [37.7849, -122.4094], "city": "San Francisco", "state": "CA"},
    "Gideon Hausner Jewish Day School": {"coords": [37.4419, -122.1430], "city": "Palo Alto", "state": "CA"},
    "Jewish Community High School of the Bay": {"coords": [37.7749, -122.4194], "city": "San Francisco", "state": "CA"},
    "Kehillah Jewish High School": {"coords": [37.4419, -122.1430], "city": "Palo Alto", "state": "CA"},
    "Lick-Wilmerding High School": {"coords": [37.7422, -122.4281], "city": "San Francisco", "state": "CA"},
    "Mark Day School": {"coords": [37.9600, -122.5350], "city": "San Rafael", "state": "CA"},
    "Marin Academy": {"coords": [37.9735, -122.5311], "city": "San Rafael", "state": "CA"},
    "Marin Country Day School": {"coords": [37.8970, -122.5310], "city": "Corte Madera", "state": "CA"},
    "Marin Primary & Middle School": {"coords": [37.8726, -122.5000], "city": "Larkspur", "state": "CA"},
    "Marin Waldorf School": {"coords": [37.9700, -122.5600], "city": "San Rafael", "state": "CA"},
    "Park Day School": {"coords": [37.8395, -122.2530], "city": "Oakland", "state": "CA"},
    "Redwood Day School": {"coords": [37.8100, -122.2350], "city": "Oakland", "state": "CA"},
    "Ronald C. Wornick Jewish Day School": {"coords": [37.3861, -122.0839], "city": "Foster City", "state": "CA"},
    "San Francisco Day School": {"coords": [37.7505, -122.4337], "city": "San Francisco", "state": "CA"},
    "San Francisco University High School": {"coords": [37.7870, -122.4490], "city": "San Francisco", "state": "CA"},
    "Stuart Hall for Boys": {"coords": [37.7925, -122.4388], "city": "San Francisco", "state": "CA"},
    "The Bay School of San Francisco": {"coords": [37.8013, -122.4525], "city": "San Francisco", "state": "CA"},
    "The Hamlin School": {"coords": [37.7945, -122.4390], "city": "San Francisco", "state": "CA"},
    "The Saklan School": {"coords": [37.8350, -122.1300], "city": "Moraga", "state": "CA"},
    "Town School for Boys": {"coords": [37.7935, -122.4370], "city": "San Francisco", "state": "CA"},
    "Urban School of San Francisco": {"coords": [37.7856, -122.4390], "city": "San Francisco", "state": "CA"},
    "Yavneh Day School": {"coords": [37.3400, -122.0600], "city": "Los Altos", "state": "CA"},
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


def parse_geocode_file(geocode_path: Path, closed_ids: set[str]) -> list[dict[str, Any]]:
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
            city = fields[5].strip()
            state = fields[6].strip()
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
                    "city": city.title() if city else "",
                    "state": state.upper() if state else "CA",
                    "lat": lat,
                    "lon": lon,
                }
            )

    print(f"Found {len(schools)} California public schools with coordinates")
    return schools


def parse_pss_file(pss_path: Path) -> list[dict[str, Any]]:
    """Parse PSS (Private School Survey) CSV.

    Reads pss2122_pu.csv, filters to CA, and returns private school records.
    PSS names are ALL CAPS - we title-case them.

    Key columns: PINST (name), PCITY (city), PSTABB (state), LATITUDE22, LONGITUDE22
    """
    schools = []

    with open(pss_path, encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            state = (row.get("PSTABB") or "").strip()
            if state != "CA":
                continue

            name = (row.get("PINST") or "").strip()
            city = (row.get("PCITY") or "").strip()
            lat_str = (row.get("LATITUDE22") or "").strip()
            lon_str = (row.get("LONGITUDE22") or "").strip()

            if not name or not lat_str or not lon_str:
                continue

            try:
                lat = float(lat_str)
                lon = float(lon_str)
            except ValueError:
                continue

            # Validate California coordinate range
            if not (32 < lat < 42 and -125 < lon < -114):
                continue

            schools.append(
                {
                    "name": name.title(),
                    "city": city.title(),
                    "state": "CA",
                    "lat": lat,
                    "lon": lon,
                }
            )

    print(f"Found {len(schools)} California private schools from PSS")
    return schools


def build_json(
    public_schools: list[dict[str, Any]],
    pss_schools: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Build the schools.json structure with lookup + coords + location."""
    lookup: dict[str, str] = {}
    coords: dict[str, list[float]] = {}
    location: dict[str, dict[str, str]] = {}

    # Process public schools from NCES geocode
    for school in public_schools:
        name: str = school["name"]
        # Keep original NCES casing (usually ALL CAPS) but title-case it
        canonical = name.title()

        # Deduplicate: keep first occurrence
        lower = canonical.lower()
        if lower not in lookup:
            lookup[lower] = canonical
            coords[canonical] = [round(school["lat"], 4), round(school["lon"], 4)]
            if school.get("city") or school.get("state"):
                location[canonical] = {}
                if school.get("city"):
                    location[canonical]["city"] = school["city"]
                if school.get("state"):
                    location[canonical]["state"] = school["state"]

    # Process PSS private schools
    if pss_schools:
        for school in pss_schools:
            canonical = school["name"]
            lower = canonical.lower()
            if lower not in lookup:
                lookup[lower] = canonical
                coords[canonical] = [round(school["lat"], 4), round(school["lon"], 4)]
                if school.get("city") or school.get("state"):
                    location[canonical] = {}
                    if school.get("city"):
                        location[canonical]["city"] = school["city"]
                    if school.get("state"):
                        location[canonical]["state"] = school["state"]

    # Add supplemental private schools
    for name, info in SUPPLEMENTAL_SCHOOLS.items():
        lower = name.lower()
        if lower not in lookup:
            lookup[lower] = name
            coords[name] = info["coords"]
            location[name] = {"city": info["city"], "state": info["state"]}

    print(f"Total: {len(lookup)} unique schools in lookup, {len(coords)} with coordinates")
    print(f"  {len(location)} entries with location metadata")

    return {
        "lookup": dict(sorted(lookup.items())),
        "coords": dict(sorted(coords.items())),
        "location": dict(sorted(location.items())),
    }


def main() -> None:
    """Main entry point."""
    parser = argparse.ArgumentParser(description="Seed schools.json from NCES data")
    parser.add_argument("--geocode", type=Path, help="Path to EDGE geocode TXT file")
    parser.add_argument("--directory", type=Path, help="Path to CCD Directory CSV file")
    parser.add_argument("--pss", type=Path, help="Path to PSS private school CSV file")
    args = parser.parse_args()

    # Find files
    geocode_path = args.geocode or find_file("EDGE_GEOCODE_PUBLICSCH_*.TXT")
    directory_path = args.directory or find_file("ccd_sch_029_*.csv")
    pss_path = args.pss or find_file("pss2122_pu.csv")

    if geocode_path is None or not geocode_path.exists():
        print("ERROR: EDGE geocode file not found.")
        print("Download from: https://nces.ed.gov/programs/edge/geographic/schoollocations")
        print("Or specify: --geocode path/to/EDGE_GEOCODE_PUBLICSCH_XXXX.TXT")
        print("\nFalling back to supplemental schools only...")
        public_schools: list[dict[str, Any]] = []
    else:
        print(f"Using geocode file: {geocode_path}")
        closed_ids = load_closed_schools(directory_path)
        public_schools = parse_geocode_file(geocode_path, closed_ids)

    pss_schools: list[dict[str, Any]] = []
    if pss_path is not None and pss_path.exists():
        print(f"Using PSS file: {pss_path}")
        pss_schools = parse_pss_file(pss_path)
    else:
        print("No PSS file found - skipping private school data")

    data = build_json(public_schools, pss_schools)

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, "w") as f:
        json.dump(data, f, indent=2)

    file_size = OUTPUT_PATH.stat().st_size / 1024
    print(f"Wrote {OUTPUT_PATH} ({file_size:.0f}KB)")


if __name__ == "__main__":
    main()
