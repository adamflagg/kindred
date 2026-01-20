#!/usr/bin/env python3
"""Show bunk request statistics: raw CampMinder data vs processed requests."""

import requests


def get_auth_headers() -> dict:
    """Authenticate and return headers."""
    auth = requests.post(
        "http://127.0.0.1:8090/api/collections/_superusers/auth-with-password",
        json={"identity": "admin@camp.local", "password": "campbunking123"},
    ).json()
    return {"Authorization": auth["token"]}


def get_all_records(
    headers: dict, collection: str, filter_str: str | None = None
) -> tuple[list, int]:
    """Fetch all records with pagination."""
    items = []
    page = 1
    while True:
        params: dict[str, int | str] = {"perPage": 500, "page": page}
        if filter_str:
            params["filter"] = filter_str
        r = requests.get(
            f"http://127.0.0.1:8090/api/collections/{collection}/records",
            params=params,
            headers=headers,
        )
        data = r.json()
        items.extend(data.get("items", []))
        if page * 500 >= data.get("totalItems", 0):
            break
        page += 1
    return items, data.get("totalItems", 0)


def main() -> None:
    headers = get_auth_headers()

    print("=" * 60)
    print("ORIGINAL BUNK REQUESTS (raw CampMinder data)")
    print("=" * 60)
    fields = [
        "bunk_with",
        "not_bunk_with",
        "bunking_notes",
        "internal_notes",
        "socialize_with",
    ]
    total_raw = 0
    for field in fields:
        _, count = get_all_records(
            headers, "original_bunk_requests", f"field = '{field}'"
        )
        total_raw += count
        print(f"  {field:20} {count:>5}")
    print(f"  {'TOTAL':20} {total_raw:>5}")

    print("\n" + "=" * 60)
    print("PROCESSED BUNK REQUESTS (final table)")
    print("=" * 60)
    request_types = ["bunk_with", "not_bunk_with", "age_preference"]
    for rtype in request_types:
        items, count = get_all_records(
            headers, "bunk_requests", f"request_type = '{rtype}'"
        )
        print(f"\n{rtype}: {count}")

        source_counts: dict[str, int] = {}
        for item in items:
            src = item.get("source_field", "unknown")
            source_counts[src] = source_counts.get(src, 0) + 1

        for src, cnt in sorted(source_counts.items(), key=lambda x: -x[1]):
            print(f"    <- {src:30} {cnt:>4}")

    _, total = get_all_records(headers, "bunk_requests")
    print(f"\nTOTAL PROCESSED: {total}")


if __name__ == "__main__":
    main()
