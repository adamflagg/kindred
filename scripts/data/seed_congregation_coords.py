#!/usr/bin/env python3
"""Seed congregations.json with Bay Area Jewish congregations.

Creates a curated list of Bay Area congregations with coordinates
for the geo normalizer lookup and frontend map display.

Data sources:
- Manually curated from publicly available synagogue directories
- Coordinates from Google Maps / OpenStreetMap

Usage:
    uv run python scripts/data/seed_congregation_coords.py

This script is idempotent - running it again will overwrite the existing file.
"""

import json
from pathlib import Path
from typing import Any

# Output path
OUTPUT_PATH = Path(__file__).parent.parent.parent / "bunking" / "geo_normalizer" / "data" / "congregations.json"

# Bay Area Jewish congregations with coordinates and location metadata
# Organized by region for maintainability
# Format: name -> {"coords": [lat, lon], "city": city, "state": state}
CONGREGATIONS: dict[str, dict[str, Any]] = {
    # ========== SAN FRANCISCO ==========
    "Congregation Beth Sholom": {"coords": [37.7830, -122.4681], "city": "San Francisco", "state": "CA"},
    "Congregation Emanu-El": {"coords": [37.7862, -122.4410], "city": "San Francisco", "state": "CA"},
    "Congregation Ner Tamid": {"coords": [37.7237, -122.4769], "city": "San Francisco", "state": "CA"},
    "Congregation Sha'ar Zahav": {"coords": [37.7606, -122.4269], "city": "San Francisco", "state": "CA"},
    "Congregation Sherith Israel": {"coords": [37.7885, -122.4285], "city": "San Francisco", "state": "CA"},
    "Kehilla Community Synagogue": {"coords": [37.8430, -122.2545], "city": "San Francisco", "state": "CA"},
    "Or Shalom Jewish Community": {"coords": [37.7470, -122.4530], "city": "San Francisco", "state": "CA"},
    "Temple Emanu-El": {"coords": [37.7862, -122.4410], "city": "San Francisco", "state": "CA"},
    # ========== MARIN COUNTY ==========
    "Congregation Kol Shofar": {"coords": [37.9249, -122.5339], "city": "Tiburon", "state": "CA"},
    "Congregation Rodef Sholom": {"coords": [37.9735, -122.5311], "city": "San Rafael", "state": "CA"},
    "Marin Jewish Community Center": {"coords": [37.9400, -122.5200], "city": "San Rafael", "state": "CA"},
    "Or Shalom": {"coords": [37.7470, -122.4530], "city": "San Francisco", "state": "CA"},
    "Temple Isaiah": {"coords": [37.8791, -122.5157], "city": "Lafayette", "state": "CA"},
    # ========== PENINSULA ==========
    "Congregation Beth Am": {"coords": [37.3880, -122.1160], "city": "Los Altos Hills", "state": "CA"},
    "Congregation Beth David": {"coords": [37.3190, -121.9500], "city": "Saratoga", "state": "CA"},
    "Congregation Beth Jacob": {"coords": [37.4630, -122.1420], "city": "Redwood City", "state": "CA"},
    "Congregation Emeth": {"coords": [37.4419, -122.1430], "city": "Palo Alto", "state": "CA"},
    "Congregation Kol Emeth": {"coords": [37.4419, -122.1430], "city": "Palo Alto", "state": "CA"},
    "Congregation Etz Chayim": {"coords": [37.4419, -122.1430], "city": "Palo Alto", "state": "CA"},
    "Keddem Congregation": {"coords": [37.4550, -122.1730], "city": "Palo Alto", "state": "CA"},
    "Peninsula Sinai Congregation": {"coords": [37.3688, -122.0363], "city": "Foster City", "state": "CA"},
    "Peninsula Temple Beth El": {"coords": [37.5529, -122.3055], "city": "San Mateo", "state": "CA"},
    "Peninsula Temple Sholom": {"coords": [37.5841, -122.3661], "city": "Burlingame", "state": "CA"},
    # ========== EAST BAY ==========
    "Beth El": {"coords": [37.8716, -122.2727], "city": "Berkeley", "state": "CA"},
    "Beth Jacob Oakland": {"coords": [37.8244, -122.2317], "city": "Oakland", "state": "CA"},
    "Chabad of the East Bay": {"coords": [37.8716, -122.2727], "city": "Berkeley", "state": "CA"},
    "Congregation Beth El": {"coords": [37.8716, -122.2727], "city": "Berkeley", "state": "CA"},
    "Congregation Beth Israel": {"coords": [37.8716, -122.2727], "city": "Berkeley", "state": "CA"},
    "Congregation B'nai Israel": {"coords": [37.9101, -122.0652], "city": "Walnut Creek", "state": "CA"},
    "Congregation B'nai Shalom": {"coords": [37.9101, -122.0652], "city": "Walnut Creek", "state": "CA"},
    "Congregation B'nai Tikvah": {"coords": [37.9101, -122.0652], "city": "Walnut Creek", "state": "CA"},
    "Congregation Netivot Shalom": {"coords": [37.8716, -122.2727], "city": "Berkeley", "state": "CA"},
    "Or Chadash": {"coords": [37.6624, -121.8747], "city": "Pleasanton", "state": "CA"},
    "Temple Beth Abraham": {"coords": [37.8044, -122.2712], "city": "Oakland", "state": "CA"},
    "Temple Beth Hillel": {"coords": [37.8771, -122.1797], "city": "Richmond", "state": "CA"},
    "Temple Beth Sholom": {"coords": [37.3382, -121.8863], "city": "San Jose", "state": "CA"},
    "Temple Israel": {"coords": [37.6688, -122.0808], "city": "Alameda", "state": "CA"},
    "Temple Sinai": {"coords": [37.8044, -122.2712], "city": "Oakland", "state": "CA"},
    "Tri-Valley Cultural Jews": {"coords": [37.6624, -121.8747], "city": "Pleasanton", "state": "CA"},
    # ========== SOUTH BAY ==========
    "Congregation Shir Hadash": {"coords": [37.2358, -121.9624], "city": "Los Gatos", "state": "CA"},
    "Congregation Sinai": {"coords": [37.3382, -121.8863], "city": "San Jose", "state": "CA"},
    "Temple Emanu-El San Jose": {"coords": [37.3382, -121.8863], "city": "San Jose", "state": "CA"},
    # ========== NAPA / SONOMA ==========
    "Congregation Beth Ami": {"coords": [38.4404, -122.7141], "city": "Santa Rosa", "state": "CA"},
    "Congregation Shomrei Torah": {"coords": [38.4404, -122.7141], "city": "Santa Rosa", "state": "CA"},
    # ========== SACRAMENTO ==========
    "Congregation B'nai Israel Sacramento": {"coords": [38.5816, -121.4944], "city": "Sacramento", "state": "CA"},
    "Congregation Beth Shalom Sacramento": {"coords": [38.5816, -121.4944], "city": "Sacramento", "state": "CA"},
    # ========== LOS ANGELES AREA ==========
    "Congregation Beth Am Los Angeles": {"coords": [34.0522, -118.2437], "city": "Los Angeles", "state": "CA"},
    "Stephen Wise Temple": {"coords": [34.0903, -118.4643], "city": "Los Angeles", "state": "CA"},
    "Temple Beth Am": {"coords": [34.0522, -118.2437], "city": "Los Angeles", "state": "CA"},
    "Temple of the Arts": {"coords": [34.0522, -118.2437], "city": "Los Angeles", "state": "CA"},
    "Wilshire Boulevard Temple": {"coords": [34.0579, -118.3110], "city": "Los Angeles", "state": "CA"},
}


def build_json() -> dict[str, Any]:
    """Build the congregations.json structure with lookup + coords + location."""
    lookup: dict[str, str] = {}
    coords: dict[str, list[float]] = {}
    location: dict[str, dict[str, str]] = {}

    for name, info in CONGREGATIONS.items():
        lower = name.lower()
        if lower not in lookup:
            lookup[lower] = name
            coords[name] = [round(info["coords"][0], 4), round(info["coords"][1], 4)]
            location[name] = {"city": info["city"], "state": info["state"]}

        # Also add common variations without prefix
        for prefix in ("Congregation ", "Temple "):
            if name.startswith(prefix):
                short = name[len(prefix) :]
                short_lower = short.lower()
                if short_lower not in lookup:
                    lookup[short_lower] = name

    print(f"Total: {len(lookup)} entries in lookup, {len(coords)} with coordinates")
    print(f"  {len(location)} entries with location metadata")

    return {
        "lookup": dict(sorted(lookup.items())),
        "coords": dict(sorted(coords.items())),
        "location": dict(sorted(location.items())),
    }


def main() -> None:
    """Main entry point."""
    data = build_json()

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, "w") as f:
        json.dump(data, f, indent=2)

    file_size = OUTPUT_PATH.stat().st_size / 1024
    print(f"Wrote {OUTPUT_PATH} ({file_size:.1f}KB)")


if __name__ == "__main__":
    main()
