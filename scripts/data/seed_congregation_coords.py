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

# Bay Area Jewish congregations with coordinates
# Organized by region for maintainability
CONGREGATIONS: dict[str, list[float]] = {
    # ========== SAN FRANCISCO ==========
    "Congregation Beth Sholom": [37.7830, -122.4681],
    "Congregation Emanu-El": [37.7862, -122.4410],
    "Congregation Ner Tamid": [37.7237, -122.4769],
    "Congregation Sha'ar Zahav": [37.7606, -122.4269],
    "Congregation Sherith Israel": [37.7885, -122.4285],
    "Kehilla Community Synagogue": [37.8430, -122.2545],
    "Or Shalom Jewish Community": [37.7470, -122.4530],
    "Temple Emanu-El": [37.7862, -122.4410],
    # ========== MARIN COUNTY ==========
    "Congregation Kol Shofar": [37.9249, -122.5339],
    "Congregation Rodef Sholom": [37.9735, -122.5311],
    "Marin Jewish Community Center": [37.9400, -122.5200],
    "Or Shalom": [37.7470, -122.4530],
    "Temple Isaiah": [37.8791, -122.5157],
    # ========== PENINSULA ==========
    "Congregation Beth Am": [37.3880, -122.1160],
    "Congregation Beth David": [37.3190, -121.9500],
    "Congregation Beth Jacob": [37.4630, -122.1420],
    "Congregation Emeth": [37.4419, -122.1430],
    "Congregation Kol Emeth": [37.4419, -122.1430],
    "Congregation Etz Chayim": [37.4419, -122.1430],
    "Keddem Congregation": [37.4550, -122.1730],
    "Peninsula Sinai Congregation": [37.3688, -122.0363],
    "Peninsula Temple Beth El": [37.5529, -122.3055],
    "Peninsula Temple Sholom": [37.5841, -122.3661],
    # ========== EAST BAY ==========
    "Beth El": [37.8716, -122.2727],
    "Beth Jacob Oakland": [37.8244, -122.2317],
    "Chabad of the East Bay": [37.8716, -122.2727],
    "Congregation Beth El": [37.8716, -122.2727],
    "Congregation Beth Israel": [37.8716, -122.2727],
    "Congregation B'nai Israel": [37.9101, -122.0652],
    "Congregation B'nai Shalom": [37.9101, -122.0652],
    "Congregation B'nai Tikvah": [37.9101, -122.0652],
    "Congregation Netivot Shalom": [37.8716, -122.2727],
    "Or Chadash": [37.6624, -121.8747],
    "Temple Beth Abraham": [37.8044, -122.2712],
    "Temple Beth Hillel": [37.8771, -122.1797],
    "Temple Beth Sholom": [37.3382, -121.8863],
    "Temple Israel": [37.6688, -122.0808],
    "Temple Sinai": [37.8044, -122.2712],
    "Tri-Valley Cultural Jews": [37.6624, -121.8747],
    # ========== SOUTH BAY ==========
    "Congregation Shir Hadash": [37.2358, -121.9624],
    "Congregation Sinai": [37.3382, -121.8863],
    "Temple Emanu-El San Jose": [37.3382, -121.8863],
    # ========== NAPA / SONOMA ==========
    "Congregation Beth Ami": [38.4404, -122.7141],
    "Congregation Shomrei Torah": [38.4404, -122.7141],
    # ========== SACRAMENTO ==========
    "Congregation B'nai Israel Sacramento": [38.5816, -121.4944],
    "Congregation Beth Shalom Sacramento": [38.5816, -121.4944],
    # ========== LOS ANGELES AREA ==========
    "Congregation Beth Am Los Angeles": [34.0522, -118.2437],
    "Stephen Wise Temple": [34.0903, -118.4643],
    "Temple Beth Am": [34.0522, -118.2437],
    "Temple of the Arts": [34.0522, -118.2437],
    "Wilshire Boulevard Temple": [34.0579, -118.3110],
}


def build_json() -> dict[str, Any]:
    """Build the congregations.json structure with lookup + coords."""
    lookup: dict[str, str] = {}
    coords: dict[str, list[float]] = {}

    for name, coord in CONGREGATIONS.items():
        lower = name.lower()
        if lower not in lookup:
            lookup[lower] = name
            coords[name] = [round(coord[0], 4), round(coord[1], 4)]

        # Also add common variations without prefix
        for prefix in ("Congregation ", "Temple "):
            if name.startswith(prefix):
                short = name[len(prefix) :]
                short_lower = short.lower()
                if short_lower not in lookup:
                    lookup[short_lower] = name

    print(f"Total: {len(lookup)} entries in lookup, {len(coords)} with coordinates")

    return {
        "lookup": dict(sorted(lookup.items())),
        "coords": dict(sorted(coords.items())),
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
