#!/usr/bin/env python3
"""Drop grep hits that sit in a comment or a docstring.

Spec 3.8 forbids the lodging registry from living in source. A registry lives
in *code* -- string literals, lists, maps. Prose that names a unit to explain a
rule is documentation, and failing on it made the guard red on `main` for a
docstring at `api/services/lodging_rules.py` (kindred#1891), which opened
Phase C on a failure that was not Phase C's.

Reads `path:lineno:text` on stdin (grep -In output, repo-relative) and writes
through only the hits that land on a code line.

SCOPE, honestly stated, matching the guard this serves:
  * Python uses the real tokenizer, so comments and docstrings are exact.
  * C-style files (.go/.js/.ts/.tsx) use a character scan that tracks string
    and block-comment state. It understands quotes well enough not to mistake
    "https://example/Tuolumne" for a comment, but it is not a parser.
  * .jsx/.tsx additionally recognize `{/*` and `*/}` as a fused JSX comment
    delimiter (kindred#2181): the braces are the comment container's own
    syntax, not code that happens to share a line with one. Without this, a
    multi-line `{/* ... */}` comment's opening and closing lines each carry
    a leftover `{` or `}` after the comment content is stripped, so the
    "is this line all comment" check never sees an empty line and the whole
    comment -- prose included -- reads as code. That is what let a real unit
    name sit in a JSX comment on `main` until #2178 scrubbed it at the
    source. The fusion only fires when `{`/`}` sit flush against `/*`/`*/`
    (no space), so `{ /* note */ x() }` -- real code around a comment -- is
    untouched.
  * A file that will not parse or read is treated as ALL CODE, so its hits
    survive. A guard that goes quiet because a file is malformed is worse than
    one that reports a line you have to read.
"""

from __future__ import annotations

import ast
import io
import sys
import tokenize
from pathlib import Path

C_STYLE_SUFFIXES = {".go", ".js", ".jsx", ".ts", ".tsx"}
# Files where a `{/* ... */}` JSX comment is possible -- restricted so a
# .go/.js/.ts file's `{ /* note */ }` (a real block scoping a comment) never
# gets the fused-brace treatment meant only for JSX's own comment syntax.
JSX_SUFFIXES = {".jsx", ".tsx"}


def _python_noncode_lines(source: str) -> set[int]:
    """Line numbers occupied by a comment or a docstring."""
    noncode: set[int] = set()

    try:
        for token in tokenize.generate_tokens(io.StringIO(source).readline):
            if token.type == tokenize.COMMENT:
                noncode.update(range(token.start[0], token.end[0] + 1))
    except Exception:
        # Deliberately broad, and deliberately NOT a parenthesized tuple of
        # TokenError/IndentationError/SyntaxError: this file is run by the
        # guard's bare `python3`, which may predate 3.14, while ruff formats
        # it for the repo's 3.14 target and rewrites a tuple into the
        # bare-comma form that older interpreters reject. Any tokenize failure
        # means the same thing anyway -- we learned nothing, so keep every hit.
        return set()

    try:
        tree = ast.parse(source)
    except SyntaxError:
        return noncode

    for node in ast.walk(tree):
        if not isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        body = getattr(node, "body", None)
        if not body:
            continue
        first = body[0]
        # A docstring is a bare string expression in first position. Any other
        # string literal is data and stays in scope.
        if (
            isinstance(first, ast.Expr)
            and isinstance(first.value, ast.Constant)
            and isinstance(first.value.value, str)
            and first.end_lineno is not None
        ):
            noncode.update(range(first.lineno, first.end_lineno + 1))

    return noncode


def _c_style_noncode_lines(source: str, *, jsx: bool = False) -> set[int]:
    """Line numbers wholly given over to `//` or `/* */` comments.

    A line counts as non-code only if everything on it outside a comment is
    whitespace, so `const x = "Tuolumne" // note` still reports.

    When `jsx` is set, a `{` flush against an opening `/*` and a `}` flush
    against a closing `*/` are folded into the comment delimiter rather than
    counted as leftover code (kindred#2181) -- see the module docstring for
    why that is exactly what a JSX `{/* ... */}` comment needs.
    """
    noncode: set[int] = set()
    in_block = False
    in_string: str | None = None

    for lineno, line in enumerate(source.splitlines(), start=1):
        code_chars: list[str] = []
        index = 0
        while index < len(line):
            char = line[index]
            pair = line[index : index + 2]

            if in_block:
                if pair == "*/":
                    in_block = False
                    # `*/}` -- the `}` closes the JSX expression container
                    # that the comment opened; it is the delimiter, not code.
                    if jsx and line[index + 2 : index + 3] == "}":
                        index += 3
                    else:
                        index += 2
                    continue
                index += 1
                continue

            if in_string is not None:
                code_chars.append(char)
                if char == "\\":
                    index += 2
                    continue
                if char == in_string:
                    in_string = None
                index += 1
                continue

            if char in "\"'`":
                in_string = char
                code_chars.append(char)
                index += 1
                continue

            # `{/*` -- the `{` opens the JSX expression container that only
            # exists to hold this comment; it is the delimiter, not code.
            if jsx and line[index : index + 3] == "{/*":
                in_block = True
                index += 3
                continue

            if pair == "//":
                break  # rest of the line is comment
            if pair == "/*":
                in_block = True
                index += 2
                continue

            code_chars.append(char)
            index += 1

        if not "".join(code_chars).strip():
            noncode.add(lineno)

    return noncode


def noncode_lines(path: Path) -> set[int]:
    try:
        source = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return set()

    if path.suffix == ".py":
        return _python_noncode_lines(source)
    if path.suffix in C_STYLE_SUFFIXES:
        return _c_style_noncode_lines(source, jsx=path.suffix in JSX_SUFFIXES)
    return set()


def main() -> int:
    cache: dict[str, set[int]] = {}
    for raw in sys.stdin:
        hit = raw.rstrip("\n")
        if not hit:
            continue
        parts = hit.split(":", 2)
        if len(parts) < 3 or not parts[1].isdigit():
            # Not a path:lineno:text hit -- pass it through rather than eat it.
            print(hit)
            continue
        path, lineno = parts[0], int(parts[1])
        if path not in cache:
            cache[path] = noncode_lines(Path(path))
        if lineno not in cache[path]:
            print(hit)
    return 0


if __name__ == "__main__":
    sys.exit(main())
