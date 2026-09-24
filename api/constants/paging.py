"""Page size for PocketBase `get_full_list` reads.

The SDK's `get_full_list(batch: int = 100, ...)` fetches 100 rows per HTTP
request and recurses once per page, so a read of a few hundred rows is
round-trip-bound. `batch` is a parameter of `get_full_list` itself, NOT a
member of `query_params`: putting it in the dict is accepted silently and
leaves the default in place.

1000 is the ceiling, not a guess: PocketBase declares `MaxPerPage = 1000` and
clamps a larger request rather than rejecting it.

Never pair it with `skipTotal`. `get_full_list` decides whether to fetch the
next page from `totalItems`, which `skipTotal` makes -1, so the read would stop
after the first 1000 rows and return them as if they were everything.
"""

PB_PAGE_SIZE = 1000
