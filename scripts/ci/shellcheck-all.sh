#!/usr/bin/env bash
# Lint every tracked shell script, from one definition.
#
# This replaced three hand-maintained copies of a `find` over four fixed roots --
# in .github/workflows/ci.yml, .lefthook.yml and scripts/pre-push-verify.sh --
# which had already drifted into two different commands and did not match what the
# repo holds. kindred#2663.
#
# Two properties the `find` version did not have:
#
#   * It selects by what git tracks, so a script added anywhere is linted the day
#     it lands. The old root list missed .claude/hooks/worktree-guard.sh entirely,
#     and its -maxdepth 3 sat exactly one level above the deepest tracked script.
#
#   * It fails LOUDLY on an empty selection. `find ... | xargs -0 -r shellcheck`
#     returns 0 when the file list is empty AND when find itself errors -- the pipe
#     returns xargs's status, so deleting a root directory silently linted nothing
#     and reported success. Measured: with tests/shell/ removed, find exits 1 and
#     the pipeline still exits 0.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

mapfile -d '' files < <(git ls-files -z '*.sh')

# A floor, not an exact count: the point is to catch a collapsed selection (a bad
# glob, a wrong working directory, a git that returned nothing), not to make every
# added or deleted script a two-file change. 52 tracked today.
readonly MIN_EXPECTED=40
if (( ${#files[@]} < MIN_EXPECTED )); then
    echo "::error::shellcheck input set collapsed to ${#files[@]} files (expected >= ${MIN_EXPECTED}). Refusing to report success on a selection this small." >&2
    exit 1
fi

echo "Linting ${#files[@]} tracked shell scripts..."
shellcheck --severity=warning -- "${files[@]}"
