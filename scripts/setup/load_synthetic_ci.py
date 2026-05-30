#!/usr/bin/env python3
"""Load the committed synthetic seed artifact into PocketBase's data dir (issue #1623).

Used by the CD ``integration-test`` job before the stack boots, so the data-dependent
server suites have a deterministic, no-PII dataset to read. The artifact already
carries the migrated schema + ``_migrations`` and is in WAL mode, so PocketBase boots
on it directly and the metrics code opens it read-only without converting journal mode.

Usage:
    uv run python scripts/setup/load_synthetic_ci.py --dest /path/to/pocketbase/data.db
"""

import argparse
import gzip
import shutil
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_ARTIFACT = _REPO_ROOT / "tests" / "fixtures" / "synthetic_pb" / "data.db.gz"


def load_synthetic(gz_path: str | Path, dest: str | Path) -> Path:
    """Gunzip the synthetic artifact at ``gz_path`` to ``dest`` (a data.db path)."""
    gz_path = Path(gz_path)
    dest = Path(dest)
    if not gz_path.is_file():
        raise FileNotFoundError(f"synthetic artifact not found: {gz_path}")
    dest.parent.mkdir(parents=True, exist_ok=True)
    # Remove any stale WAL/SHM siblings so the fresh single-file DB boots cleanly.
    for suffix in ("", "-wal", "-shm"):
        sib = dest.with_name(dest.name + suffix)
        if sib.exists():
            sib.unlink()
    with gzip.open(gz_path, "rb") as fin, open(dest, "wb") as fout:
        shutil.copyfileobj(fin, fout)
    return dest


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Load the synthetic seed DB for CI.")
    parser.add_argument("--dest", required=True, help="Destination data.db path.")
    parser.add_argument("--gz", default=str(DEFAULT_ARTIFACT), help="Source .db.gz artifact.")
    args = parser.parse_args(argv)
    dest = load_synthetic(args.gz, args.dest)
    print(f"Loaded synthetic seed -> {dest} ({dest.stat().st_size / 1024:.0f} KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
