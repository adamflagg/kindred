#!/usr/bin/env python3
"""Drop grep hits that sit in a comment or a docstring.

With `--only-comments`, the filter inverts: it keeps ONLY the hits that sit
in a comment or docstring and drops everything else. verify-no-hardcoded-
lodging.sh uses this second mode for frontend/src/** test files, where a
fixture literal (code) is a deliberate, exempted case but a needle named in
an explanatory comment is not (kindred#2367) -- so a test file's hits split
into "genuine leak" (comment) and "known-legitimate fixture" (code) instead
of the normal code/comment split going the other way.

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
  * `.sh` files recognize a `#` comment, on the same whole-line rule the
    C-style scanner uses: a line counts only when there is nothing on it but
    comment. The guard greps `*.sh`, so without this a shell comment came back
    classified as code -- which under `--only-comments` means EXEMPT, and the
    rule table's "a test file -> comment hits fail" was simply untrue for
    shell (kindred#2512 review).
  * A file that cannot be read, will not parse, or has a suffix with no scanner
    here yields None -- "we learned nothing" -- and main() writes its hits
    through in BOTH modes. That is what fail-open has to mean once
    `--only-comments` exists: under that flag "treat it as all code" would
    DROP every hit rather than keep it, so the promise inverted itself exactly
    where the guard relies on it. A guard that goes quiet because a file is
    malformed is worse than one that reports a line you have to read.
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
# Files whose comments start with `#`. Kept in step with the guard's own
# --include list: every suffix it greps needs a scanner here, or that suffix's
# comment hits are misclassified as code and exempted in test files.
HASH_STYLE_SUFFIXES = {".sh"}


def _hash_style_noncode_lines(source: str) -> set[int]:
    """Line numbers whose only content is a `#` comment.

    Deliberately not a shell parser. It marks a line non-code when its first
    non-blank character is `#`, which is right for a comment line and right to
    refuse for `UNITS=(...)  # note` -- a needle in the code half of a mixed
    line must still report. The known imprecision is a heredoc body line that
    begins with `#`; that direction over-reports under `--only-comments`, which
    is the safe way to be wrong here.
    """
    return {lineno for lineno, line in enumerate(source.splitlines(), start=1) if line.lstrip().startswith("#")}


def _python_noncode_lines(source: str) -> set[int] | None:
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
        return None

    try:
        tree = ast.parse(source)
    except SyntaxError:
        # Comments found by the tokenizer are real, but the docstring scan
        # below never ran, so the classification is incomplete. Report unknown
        # rather than a partial answer: an unfound docstring line would be
        # dropped as "code" under --only-comments, which is the failure mode
        # this whole return type exists to prevent.
        return None

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


def noncode_lines(path: Path) -> set[int] | None:
    """Comment/docstring line numbers, or None when they cannot be determined.

    None is not "no comments" -- it is "we learned nothing about this file",
    and main() keeps every hit in such a file regardless of which way the
    filter points.
    """
    try:
        source = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None

    if path.suffix == ".py":
        return _python_noncode_lines(source)
    if path.suffix in C_STYLE_SUFFIXES:
        return _c_style_noncode_lines(source, jsx=path.suffix in JSX_SUFFIXES)
    if path.suffix in HASH_STYLE_SUFFIXES:
        return _hash_style_noncode_lines(source)
    return None


def main() -> int:
    only_comments = "--only-comments" in sys.argv[1:]
    cache: dict[str, set[int] | None] = {}
    for raw in sys.stdin:
        hit = raw.rstrip("\n")
        if not hit:
            continue
        parts = hit.split(":", 2)
        if len(parts) < 3 or not parts[1].isdigit():
            # Not a path:lineno:text hit -- pass it through rather than eat
            # it, in either mode: unparseable input means we learned nothing,
            # so keep it reportable rather than silently dropping it.
            print(hit)
            continue
        path, lineno = parts[0], int(parts[1])
        if path not in cache:
            cache[path] = noncode_lines(Path(path))
        classified = cache[path]
        if classified is None:
            # Fail open, in BOTH modes -- see the module docstring. Keeping the
            # hit costs a line someone has to read; dropping it is how a real
            # leak goes unreported because a file happened not to parse.
            print(hit)
            continue
        is_comment = lineno in classified
        if is_comment == only_comments:
            print(hit)
    return 0


if __name__ == "__main__":
    sys.exit(main())
