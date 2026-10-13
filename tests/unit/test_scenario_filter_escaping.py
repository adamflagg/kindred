"""A scenario id never reaches a PocketBase filter unescaped.

The API and the graph builder query PocketBase as superuser, so a quote in a
scenario id would otherwise rewrite the filter and widen what the query reads.
Every sink goes through ``pb_escape``, as the lodging repository already does.
"""

import re
from pathlib import Path

from bunking.graph.social_graph_builder import SocialGraphBuilder

REPO_ROOT = Path(__file__).resolve().parents[2]
SCANNED_DIRS = ("api", "bunking")

# `scenario = "{value}"` or `scenario = '{value}'` inside an f-string, where the
# interpolated value is not wrapped in pb_escape(...).
UNESCAPED_SCENARIO_SINK = re.compile(r"""\bscenario\s*=\s*["']\{(?!pb_escape\()""")


def test_no_scenario_filter_interpolates_an_unescaped_value() -> None:
    offenders = []
    for top in SCANNED_DIRS:
        for path in sorted((REPO_ROOT / top).rglob("*.py")):
            if "tests" in path.parts:
                continue
            for lineno, line in enumerate(path.read_text().splitlines(), start=1):
                if UNESCAPED_SCENARIO_SINK.search(line):
                    offenders.append(f"{path.relative_to(REPO_ROOT)}:{lineno}: {line.strip()}")
    assert offenders == [], "wrap the scenario value in pb_escape():\n" + "\n".join(offenders)


def test_graph_builder_scenario_clause_cannot_break_out_of_its_quotes() -> None:
    _, clause = SocialGraphBuilder._assignment_source('abc" || id != "')
    assert clause == ' && scenario = "abc\\" || id != \\""'


def test_graph_builder_scenario_clause_keeps_a_real_id_unchanged() -> None:
    _, clause = SocialGraphBuilder._assignment_source("abcdefghij12345")
    assert clause == ' && scenario = "abcdefghij12345"'
