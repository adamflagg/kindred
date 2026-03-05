"""CLI entry point for geo normalizer.

Usage:
    uv run python -m bunking.geo_normalizer --category city --values '["SF", "San Francisco"]'

Output:
    {"SF": {"canonical": "San Francisco", "confidence": 0.95}, ...}
"""

import argparse
import json
import sys

from bunking.geo_normalizer.normalizer import normalize_values


def main() -> int:
    """Main CLI entry point."""
    parser = argparse.ArgumentParser(description="Normalize geographic values using fuzzy matching")
    parser.add_argument(
        "--category",
        required=True,
        choices=["city", "school", "congregation"],
        help="Category of values to normalize",
    )
    parser.add_argument(
        "--values",
        required=True,
        type=json.loads,
        help="JSON array of values to normalize",
    )

    args = parser.parse_args()

    try:
        result = normalize_values(args.category, args.values)
        print(json.dumps(result))  # noqa: T201
        return 0
    except Exception as e:
        print(json.dumps({"error": str(e)}), file=sys.stderr)  # noqa: T201
        return 1


if __name__ == "__main__":
    sys.exit(main())
