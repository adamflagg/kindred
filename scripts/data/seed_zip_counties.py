#!/usr/bin/env python3
"""Generate bunking/geo_normalizer/data/us_zip_counties.json from the Census 2020 ZCTA-to-county relationship file
(Decision 8a of the slice 1 reads part 2 plan, ruled by the lead). Each five-digit ZIP maps to the county holding MORE
THAN HALF of its land area, by the Census legal name ("Alameda County"). A ZIP split with no majority, one with no land,
and a ZIP with no ZCTA are left out, so the card shows no county rather than a wrong one.

Source (US Census Bureau, public domain; 6.5 MB, pipe-delimited, UTF-8 with a BOM; never committed):
    https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_county20_natl.txt

Usage:
    uv run python scripts/data/seed_zip_counties.py --source path/to/tab20_zcta520_county20_natl.txt
"""

from __future__ import annotations

import argparse
import csv
import json
from collections.abc import Iterable, Mapping
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
OUTPUT = REPO_ROOT / "bunking" / "geo_normalizer" / "data" / "us_zip_counties.json"
COLUMNS = ("GEOID_ZCTA5_20", "NAMELSAD_COUNTY_20", "AREALAND_ZCTA5_20", "AREALAND_PART")


def crosswalk(rows: Iterable[Mapping[str, str]]) -> dict[str, str]:
    """ZIP -> the county holding more than half of its land; nothing for a ZIP with no such county."""
    land: dict[str, int] = {}
    best: dict[str, tuple[int, str]] = {}
    for row in rows:
        zcta = row["GEOID_ZCTA5_20"].strip()
        if not zcta:
            continue  # a county piece in no ZCTA
        land[zcta] = int(row["AREALAND_ZCTA5_20"] or 0)
        part = int(row["AREALAND_PART"] or 0)
        if zcta not in best or part > best[zcta][0]:
            best[zcta] = (part, row["NAMELSAD_COUNTY_20"].strip())
    return {z: name for z, (part, name) in sorted(best.items()) if len(z) == 5 and land[z] > 0 and part * 2 > land[z]}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    args = parser.parse_args()
    with args.source.open(newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f, delimiter="|")
        missing = [c for c in COLUMNS if c not in (reader.fieldnames or [])]
        if missing:
            raise SystemExit(f"not the ZCTA-to-county file: no {missing}")
        table = crosswalk(reader)
    OUTPUT.write_text(json.dumps(table, separators=(",", ":"), sort_keys=True) + "\n", encoding="utf-8")
    print(f"{len(table)} ZIPs -> {OUTPUT}")


if __name__ == "__main__":
    main()
