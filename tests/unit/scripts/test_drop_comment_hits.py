"""Tests for scripts/dev/lib/drop_comment_hits.py.

kindred#2181: the C-style scanner correctly tracks `/* ... */` state across
line breaks, but the *line-level* classification in `_c_style_noncode_lines`
only marks a line non-code when the ENTIRE line -- after stripping comment
content -- is blank. A JSX comment's `{` (before `/*`) and `}` (after `*/`)
survive that strip as leftover "code" characters, so a multi-line JSX
`{/* ... */}` comment is never recognized as a comment at all, and every hit
inside it (including the interior prose) stays in scope. This is the exact
construct that carried a real unit name past the guard on `main` until #2178
scrubbed it at the source (kindred#1909 precedent: fix the parser, not the
filter). Uses an invented placeholder string, never a real unit name.
"""

from pathlib import Path

from scripts.dev.lib.drop_comment_hits import noncode_lines

JSX_COMMENT_SOURCE = """\
export function Foo() {
  return (
    <div>
      {/* Historical note: the backdrop hides the row, so we show
          "which ZzyzxPlaceholderUnit is this" here for clarity. */}
      <span>hi</span>
    </div>
  );
}
"""


def test_multiline_jsx_comment_is_recognized_as_noncode(tmp_path: Path) -> None:
    """Every line of a multi-line `{/* ... */}` comment must count as noncode.

    Line 4 opens with `{/*` and line 5 closes with `*/}` -- the JSX comment
    scaffolding braces that made the old scanner treat both lines as "code"
    even though everything on them outside the JSX braces themselves is
    comment prose.
    """
    path = tmp_path / "probe.tsx"
    path.write_text(JSX_COMMENT_SOURCE)

    lines = noncode_lines(path)

    # None means "could not classify this file", which for a well-formed .tsx
    # would be a bug in its own right -- assert it before the set comparison so
    # a regression there reads as itself rather than as a set mismatch.
    assert lines is not None
    assert lines == {4, 5}, f"expected lines 4-5 (the full JSX comment) to be noncode, got {sorted(lines)}"


def test_code_immediately_after_jsx_comment_close_still_reports(tmp_path: Path) -> None:
    """A JSX comment followed by real code on the SAME line is still code.

    `{/* note */} <ZzyzxPlaceholderUnit />` mixes a closed comment with a real
    JSX element on one line -- the line must stay in scope, or the fix would
    have gone too far and started hiding actual code hits.
    """
    path = tmp_path / "probe.tsx"
    path.write_text(
        "export function Foo() {\n"
        "  return (\n"
        "    <div>\n"
        "      {/* note */} <ZzyzxPlaceholderUnit />\n"
        "    </div>\n"
        "  );\n"
        "}\n"
    )

    lines = noncode_lines(path)

    assert lines is not None
    assert 4 not in lines


# --- kindred#2512 review: shell comments, and fail-open on "we learned nothing"
#
# The module promises fail-OPEN -- "a file that will not parse or read is
# treated as ALL CODE, so its hits survive". Under `--only-comments`, which is
# the only mode verify-no-hardcoded-lodging.sh still uses, "all code" means
# "all DROPPED": fail-CLOSED, the exact opposite. Two live consequences, both
# pinned below:
#
#   * the guard greps '*.sh', but every suffix outside {.py, C-style} returned
#     an empty set, so a needle in a '#' comment in a test shell script was
#     classified as code and exempted;
#   * a .py file that will not tokenize lost its comment hits the same way.
#
# `noncode_lines` now returns None for "could not determine", and main() writes
# such hits through in BOTH modes.


def test_shell_comment_lines_are_noncode(tmp_path: Path) -> None:
    """A '#' comment in a .sh file must be recognised as noncode."""
    path = tmp_path / "probe.sh"
    path.write_text(
        "#!/usr/bin/env bash\n"
        "# Explanatory prose naming ZzyzxPlaceholderUnit.\n"
        "UNITS=(ZzyzxPlaceholderUnit)\n"
        "  # indented comment\n"
    )

    assert noncode_lines(path) == {1, 2, 4}


def test_shell_code_with_trailing_comment_still_reports(tmp_path: Path) -> None:
    """`UNITS=(...)  # note` is code, matching the C-style whole-line rule.

    A line only counts as noncode when there is nothing on it but comment, so a
    needle sitting in the CODE half of a mixed line is never hidden by the
    comment half.
    """
    path = tmp_path / "probe.sh"
    path.write_text('UNITS="ZzyzxPlaceholderUnit"  # note\n')

    assert noncode_lines(path) == set()


def test_unparseable_python_is_unknown(tmp_path: Path) -> None:
    """A .py file that will not tokenize returns None, not an empty set.

    An empty set means "this file has no comment lines", which under
    --only-comments discards every hit in it. None means "we learned nothing",
    which keeps them.
    """
    path = tmp_path / "probe_test.py"
    path.write_text("# Comment naming ZzyzxPlaceholderUnit.\nUNITS = (\n")

    assert noncode_lines(path) is None


def test_unreadable_path_is_unknown(tmp_path: Path) -> None:
    """A path that cannot be read at all is unknown, so its hits survive."""
    assert noncode_lines(tmp_path / "does_not_exist.py") is None


def test_unhandled_suffix_is_unknown(tmp_path: Path) -> None:
    """A suffix this module has no scanner for is unknown, not "all code"."""
    path = tmp_path / "probe.rb"
    path.write_text("# Comment naming ZzyzxPlaceholderUnit.\n")

    assert noncode_lines(path) is None


def _run_filter(stdin: str, *args: str) -> str:
    import subprocess
    import sys

    module = Path(__file__).resolve().parents[3] / "scripts" / "dev" / "lib" / "drop_comment_hits.py"
    return subprocess.run(
        [sys.executable, str(module), *args],
        input=stdin,
        capture_output=True,
        text=True,
        check=True,
    ).stdout


def test_unknown_file_hits_survive_in_both_modes(tmp_path: Path) -> None:
    """Fail-open means the hit is written through whichever way the filter points.

    This is the assertion that makes the docstring's promise true under
    --only-comments: a file we could not classify must not have its hits
    silently swallowed by the mode that keeps comments.
    """
    path = tmp_path / "probe_test.py"
    path.write_text("# Comment naming ZzyzxPlaceholderUnit.\nUNITS = (\n")
    hit = f"{path}:1:# Comment naming ZzyzxPlaceholderUnit.\n"

    assert _run_filter(hit) == hit
    assert _run_filter(hit, "--only-comments") == hit
