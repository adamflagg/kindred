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

    assert 4 not in lines
