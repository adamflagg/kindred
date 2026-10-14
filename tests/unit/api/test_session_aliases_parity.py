"""The client's session alias map must equal the server's.

`frontend/src/utils/sessionAliases.ts` mirrors `SESSION_NAME_ALIASES` so the
compare views map a renamed session the same way the API resolver does.
"""

import re
from pathlib import Path

from api.utils.session_aliases import SESSION_NAME_ALIASES


def test_the_client_alias_map_equals_the_servers() -> None:
    ts = Path(__file__).resolve().parents[3] / "frontend" / "src" / "utils" / "sessionAliases.ts"
    match = re.search(
        r"export const SESSION_NAME_ALIASES: Record<string, string> = \{(.*?)\}",
        ts.read_text(),
        re.DOTALL,
    )
    assert match is not None
    pairs = dict(re.findall(r"'([^']+)':\s*'([^']+)'", match.group(1)))
    assert pairs == SESSION_NAME_ALIASES
