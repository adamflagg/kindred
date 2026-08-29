#!/usr/bin/env bash
# Self-test for scripts/ci/copy-private-config.sh
#
# kindred#2575. The thing under test replaced a blanket
# `cp /tmp/kindred-local/config/* config/ 2>/dev/null || true` inside
# .github/actions/clone-kindred-local/action.yml. That one line had two
# defects and this suite pins both:
#
#   1. OVER-BREADTH. It copied the whole private config/ and local/ trees into
#      a PUBLIC repo's workspace so that one job could read one file. TEST 3 is
#      the regression: an unrequested sibling must not arrive.
#   2. SILENCE. `2>/dev/null || true` made a rename on the kindred-local side
#      indistinguishable from success -- the kindred#1867 silent-clean class,
#      which ci.yml had to grow a bespoke gate to compensate for. TEST 4 pins
#      that a missing requested path is now a hard, named failure.
#
# The allowlist is data supplied by a workflow, so TESTs 6-7 treat it as
# untrusted: an absolute path or a `..` segment must be refused rather than
# resolved, or "copy exactly these" would be able to reach outside SRC.

set -euo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
COPY_SCRIPT="$HERE/copy-private-config.sh"

if [[ ! -x "$COPY_SCRIPT" ]]; then
  echo "FAIL: $COPY_SCRIPT not executable or missing" >&2
  exit 1
fi

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

failures=0

# Build a fresh SRC that mirrors kindred-local's real shape, and an empty DEST.
# Returns via the globals SRC/DEST so each test starts from a clean slate.
new_fixture() {
  SRC="$WORK/src.$RANDOM"
  DEST="$WORK/dest.$RANDOM"
  mkdir -p "$SRC/config" "$SRC/local/assets" "$SRC/frontend" "$DEST"
  echo '{"registry":true}'  > "$SRC/config/lodging_registry.json"
  echo '{"staff":true}'     > "$SRC/config/staff_list.json"
  echo '{"branding":true}'  > "$SRC/config/branding.local.json"
  echo '{"nicknames":true}' > "$SRC/config/nicknames_override.json"
  echo 'PNG'                > "$SRC/local/assets/camp-logo.png"
  echo 'PNG'                > "$SRC/local/assets/camp-logo-nav.png"
  echo 'export const localConfig = {}' > "$SRC/frontend/vite.config.local.ts"
}

# run_copy <paths> -- runs the script, capturing output and status without
# tripping `set -e`. Sets OUT and STATUS.
run_copy() {
  STATUS=0
  OUT=$(PRIVATE_CONFIG_PATHS="$1" "$COPY_SCRIPT" "$SRC" "$DEST" 2>&1) || STATUS=$?
}

check() {
  local label="$1" condition="$2"
  if [[ "$condition" == "ok" ]]; then
    echo "PASS: $label"
  else
    echo "FAIL: $label" >&2
    failures=$((failures + 1))
  fi
}

# --- TEST 1: a requested file arrives, with its parent directory created ----
new_fixture
run_copy 'config/lodging_registry.json'
if [[ $STATUS -eq 0 && -f "$DEST/config/lodging_registry.json" ]] \
   && grep -q '"registry":true' "$DEST/config/lodging_registry.json"; then
  check "TEST 1: requested file is copied, parent dir created" ok
else
  check "TEST 1: requested file is copied, parent dir created (status=$STATUS) $OUT" no
fi

# --- TEST 2: a requested directory is copied recursively -------------------
new_fixture
run_copy 'local/assets'
if [[ $STATUS -eq 0 \
   && -f "$DEST/local/assets/camp-logo.png" \
   && -f "$DEST/local/assets/camp-logo-nav.png" ]]; then
  check "TEST 2: requested directory is copied recursively" ok
else
  check "TEST 2: requested directory is copied recursively (status=$STATUS) $OUT" no
fi

# --- TEST 3: THE REGRESSION. Unrequested siblings must not arrive ----------
# This is kindred#2575 itself: the lodging-guard job asks for the registry and
# must not receive staff names, branding or logo assets as a side effect.
new_fixture
run_copy 'config/lodging_registry.json'
leaked=""
for unwanted in \
  "$DEST/config/staff_list.json" \
  "$DEST/config/branding.local.json" \
  "$DEST/config/nicknames_override.json" \
  "$DEST/frontend/vite.config.local.ts" \
  "$DEST/local/assets/camp-logo.png"; do
  [[ -e "$unwanted" ]] && leaked="$leaked $unwanted"
done
if [[ $STATUS -eq 0 && -z "$leaked" ]]; then
  check "TEST 3: unrequested private files do not reach the workspace" ok
else
  check "TEST 3: unrequested private files do not reach the workspace (leaked:$leaked)" no
fi

# --- TEST 4: a missing requested path fails loudly, naming EVERY miss ------
# The old `|| true` swallowed exactly this. A rename in kindred-local must be
# a red build, not a quietly degraded one.
#
# Two missing paths are requested on purpose. `cp` under `set -e` would abort
# on the first one, so asserting that BOTH are named is what pins the
# deliberate pre-flight check rather than an incidental copy failure -- and it
# is the better failure for a human: one run names the whole set to fix.
new_fixture
run_copy 'config/renamed_away.json
config/also_gone.json'
if [[ $STATUS -ne 0 ]] \
   && printf '%s' "$OUT" | grep -q 'config/renamed_away.json' \
   && printf '%s' "$OUT" | grep -q 'config/also_gone.json'; then
  check "TEST 4: missing requested paths exit non-zero and are all named" ok
else
  check "TEST 4: missing requested paths exit non-zero and are all named (status=$STATUS) $OUT" no
fi

# --- TEST 5: an empty allowlist is a configuration error, not a no-op ------
new_fixture
run_copy ''
if [[ $STATUS -ne 0 ]]; then
  check "TEST 5: empty allowlist is rejected" ok
else
  check "TEST 5: empty allowlist is rejected (status=$STATUS) $OUT" no
fi

# --- TEST 6: an absolute path is refused, as an absolute path ---------------
# Asserting only "non-zero" would pass without the guard too, since
# "$SRC_ROOT//abs/path" does not exist and the miss check would fire. The
# assertion is therefore on the REASON: the allowlist is repo-relative by
# contract, and an absolute entry is a caller mistake worth naming as one.
new_fixture
mkdir -p "$WORK/outside"
echo 'SECRET' > "$WORK/outside/secret.txt"
run_copy "$WORK/outside/secret.txt"
if [[ $STATUS -ne 0 ]] && printf '%s' "$OUT" | grep -qi 'relative'; then
  check "TEST 6: absolute path in the allowlist is refused as absolute" ok
else
  check "TEST 6: absolute path in the allowlist is refused as absolute (status=$STATUS) $OUT" no
fi

# --- TEST 7: a parent-traversal segment cannot reach outside either root ----
# Load-bearing only when the escape target EXISTS: without the guard,
# "$SRC_ROOT/../escape.txt" resolves, gets copied, and the rm -rf that clears
# the destination first runs at "$DEST_ROOT/../escape.txt" -- outside DEST.
# The fixture below plants exactly that file so the guard is the only thing
# standing between the allowlist and a write outside the workspace.
new_fixture
echo 'OUTSIDE' > "$WORK/escape.txt"
run_copy '../escape.txt'
if [[ $STATUS -ne 0 ]] \
   && printf '%s' "$OUT" | grep -q '\.\.' \
   && [[ -f "$WORK/escape.txt" ]] \
   && grep -q 'OUTSIDE' "$WORK/escape.txt"; then
  check "TEST 7: '..' traversal is refused and writes nothing outside the roots" ok
else
  check "TEST 7: '..' traversal is refused and writes nothing outside the roots (status=$STATUS) $OUT" no
fi

# --- TEST 8: blank lines and stray whitespace are tolerated -----------------
# The allowlist arrives as a YAML block scalar, so trailing newlines and
# indentation are normal, not a caller error.
new_fixture
run_copy '
  config/staff_list.json

config/branding.local.json
'
if [[ $STATUS -eq 0 \
   && -f "$DEST/config/staff_list.json" \
   && -f "$DEST/config/branding.local.json" ]]; then
  check "TEST 8: blank lines and indentation in the allowlist are tolerated" ok
else
  check "TEST 8: blank lines and indentation in the allowlist are tolerated (status=$STATUS) $OUT" no
fi

# --- TEST 9: re-running over an existing destination overwrites cleanly -----
# Composite actions can run twice in one job; a second pass must not fail on
# "file exists" nor leave a stale first-pass copy behind.
new_fixture
run_copy 'config/staff_list.json'
echo 'STALE' > "$DEST/config/staff_list.json"
run_copy 'config/staff_list.json'
if [[ $STATUS -eq 0 ]] && grep -q '"staff":true' "$DEST/config/staff_list.json"; then
  check "TEST 9: a second run overwrites a stale copy" ok
else
  check "TEST 9: a second run overwrites a stale copy (status=$STATUS) $OUT" no
fi

# --- TEST 10: every copied path is announced --------------------------------
# ci.yml's GATE 1 reads the workspace, but a human reading a CD log needs to
# see what a build actually received. Silence is what got us here.
new_fixture
run_copy 'config/branding.local.json
local/assets'
if [[ $STATUS -eq 0 ]] \
   && printf '%s' "$OUT" | grep -q 'config/branding.local.json' \
   && printf '%s' "$OUT" | grep -q 'local/assets'; then
  check "TEST 10: each copied path is named in the output" ok
else
  check "TEST 10: each copied path is named in the output (status=$STATUS) $OUT" no
fi

# --- TEST 16: a symlinked destination directory cannot be escaped through ----
# TESTs 6-7 validate the allowlist STRING, which a symlinked intermediate
# directory sidesteps entirely: with DEST/config linked elsewhere,
# "$DEST_ROOT/config/x" resolves outside DEST_ROOT, and `rm -rf` follows a
# symlinked DIRECTORY component even though it would not follow a symlinked
# file. This is not reachable from CI -- GITHUB_WORKSPACE is a fresh checkout
# with no symlinked directories -- but it is reachable in a dev worktree,
# where `local/assets` really is a symlink into kindred-local, so a stray
# invocation could delete out of the private repo itself.
new_fixture
mkdir -p "$WORK/outside_dest"
echo 'EXTERNAL' > "$WORK/outside_dest/lodging_registry.json"
rm -rf "$DEST/config"
ln -s "$WORK/outside_dest" "$DEST/config"
run_copy 'config/lodging_registry.json'
if [[ $STATUS -ne 0 ]] \
   && [[ -f "$WORK/outside_dest/lodging_registry.json" ]] \
   && grep -q 'EXTERNAL' "$WORK/outside_dest/lodging_registry.json"; then
  check "TEST 16: a symlinked destination directory is refused, target untouched" ok
else
  check "TEST 16: a symlinked destination directory is refused, target untouched (status=$STATUS) $OUT" no
fi

# --- TEST 17: a bad path late in the list mutates nothing before it ----------
# The copy loop clears each destination before writing it, so validating
# inside that loop would let every path BEFORE the offender take effect --
# a half-applied allowlist, which for a destructive step is the worst outcome.
new_fixture
mkdir -p "$WORK/outside_late"
echo 'EXTERNAL' > "$WORK/outside_late/staff_list.json"
printf 'PRE-EXISTING' > "$DEST/marker.json"
rm -rf "$DEST/config"
ln -s "$WORK/outside_late" "$DEST/config"
run_copy 'local/assets
config/staff_list.json'
if [[ $STATUS -ne 0 ]] \
   && [[ ! -e "$DEST/local/assets/camp-logo.png" ]] \
   && grep -q 'EXTERNAL' "$WORK/outside_late/staff_list.json"; then
  check "TEST 17: an escaping path aborts before any earlier path is copied" ok
else
  check "TEST 17: an escaping path aborts before any earlier path is copied (status=$STATUS) $OUT" no
fi

# --- TEST 11: every consumer of the action passes a `paths` allowlist -------
# A SOURCE-GREP anchor, in the spirit of scripts/dev/test-verify-no-hardcoded-lodging.sh.
# The script above cannot see a workflow that forgets the input; the action
# fails such a job at runtime, but only on a run that reaches it -- and the
# whole point of kindred#2575 is that over-broad copying is invisible until it
# is not. This catches it at PR time instead.
REPO_ROOT=$(git rev-parse --show-toplevel)
CI_WORKFLOW="$REPO_ROOT/.github/workflows/ci.yml"
offenders=$(
  for wf in "$REPO_ROOT"/.github/workflows/*.yml; do
    awk -v file="$wf" '
      /uses:[[:space:]]*\.\/\.github\/actions\/clone-kindred-local/ {
        found = 0
        start = FNR
        # Scan the rest of this step: `with:` and its inputs are indented
        # under the `uses:` line, and the next `- ` at any indent starts a new
        # step or list item.
        while ((getline line) > 0) {
          if (line ~ /^[[:space:]]*-[[:space:]]/) break
          if (line ~ /^[[:space:]]*paths:/) { found = 1; break }
        }
        if (!found) print file ":" start
      }
    ' "$wf"
  done
)
if [[ -z "$offenders" ]]; then
  check "TEST 11: every clone-kindred-local consumer passes a paths allowlist" ok
else
  check "TEST 11: every clone-kindred-local consumer passes a paths allowlist (missing at: $offenders)" no
fi

# --- TEST 12: the action itself keeps the allowlist mandatory ---------------
# `required: true` is advisory for composite-action inputs -- GitHub does not
# enforce it -- so the action validates the input itself. If someone reverts
# either half, "copy everything" becomes reachable again by simply omitting
# the input, which is the exact state kindred#2575 was filed about.
ACTION_YML="$REPO_ROOT/.github/actions/clone-kindred-local/action.yml"
# shellcheck disable=SC2016  # the literal ${{ }} below is the thing being matched
if [[ ! -f "$ACTION_YML" ]]; then
  check "TEST 12: action.yml not found at $ACTION_YML" no
elif grep -qE '^\s+cp .*kindred-local/config/\*' "$ACTION_YML"; then
  check "TEST 12: action.yml still contains the blanket 'cp config/*' copy" no
elif ! grep -qF 'PRIVATE_CONFIG_PATHS: ${{ inputs.paths }}' "$ACTION_YML"; then
  # Matching the exact wiring, not just the variable name: the variable also
  # appears in the guard asserted by TEST 13, so a loose grep stays green
  # while the input is quietly disconnected from the copy.
  check "TEST 12: action.yml does not wire inputs.paths into PRIVATE_CONFIG_PATHS" no
elif ! grep -qF 'scripts/ci/copy-private-config.sh' "$ACTION_YML"; then
  check "TEST 12: action.yml does not call the allowlist copy script" no
else
  check "TEST 12: action.yml delegates to the allowlist copy, with no blanket cp" ok
fi

# --- TEST 13: the action rejects an empty allowlist before touching the key --
# The copy script rejects an empty list too (TEST 5), but it is never reached
# on a fork or Dependabot PR: no Actions secrets means no deploy key, and the
# action returns early. Without this check in the action, a consumer that
# forgot its `paths` would look fine on every PR and only fail once it ran on
# main with the key present.
if ! grep -qE 'PRIVATE_CONFIG_PATHS.*\[\[:space:\]\]' "$ACTION_YML"; then
  check "TEST 13: action.yml checks for an empty allowlist" no
elif ! awk '
    /PRIVATE_CONFIG_PATHS.*\[\[:space:\]\]/ { empty_check = NR }
    /if \[ -z "\$DEPLOY_KEY" \]/            { key_check = NR }
    END { exit !(empty_check && key_check && empty_check < key_check) }
  ' "$ACTION_YML"; then
  check "TEST 13: the empty-allowlist check runs BEFORE the deploy-key early return" no
else
  check "TEST 13: an empty allowlist is rejected before the deploy-key early return" ok
fi

# --- TEST 14: this suite is itself wired into CI ----------------------------
# A self-test nobody runs is worth nothing, which is the kindred#2370 lesson
# the guard-self-tests job exists to apply. Assert both halves: the job runs
# this script, and the paths filter that gates that job watches the files the
# script is about -- either alone leaves the suite unwired in practice.
if ! grep -qF 'run: ./scripts/ci/test-copy-private-config.sh' "$CI_WORKFLOW"; then
  # The `run:` prefix matters: this filename also appears in the paths filter
  # asserted below, so a bare filename grep stays green after the step that
  # EXECUTES the suite is deleted -- suite listed, suite never run.
  check "TEST 14: ci.yml never runs this self-test" no
elif ! grep -qF -- "- '.github/actions/**'" "$CI_WORKFLOW"; then
  check "TEST 14: ci.yml's guardSelfTests filter does not watch .github/actions" no
elif ! grep -qF -- "- 'scripts/ci/copy-private-config.sh'" "$CI_WORKFLOW"; then
  check "TEST 14: ci.yml's guardSelfTests filter does not watch the copy script" no
elif ! grep -qF -- "- '.github/workflows/**'" "$CI_WORKFLOW"; then
  # TEST 11 scans EVERY workflow, so a filter watching only ci.yml lets an
  # allowlist change in cd.yml or release.yml merge untested.
  check "TEST 14: ci.yml's guardSelfTests filter does not watch all workflows" no
else
  check "TEST 14: this suite is wired into ci.yml and its filter watches its subjects" ok
fi

# --- TEST 15: the deploy key is isolated, and cleanup precedes the write ----
# Two properties of the action's key handling, both raised in review on the PR
# that introduced this suite:
#
#   * The key goes to its own mktemp file, not ~/.ssh/id_ed25519. Clobbering
#     the runner's default identity is harmless only because these jobs run on
#     ephemeral GitHub-hosted runners -- a property of the runner, not of this
#     action, and not one to depend on.
#   * The cleanup trap is installed BEFORE the key is written. Adding
#     `set -euo pipefail` to this action (this PR did) means any failure
#     between the write and the clone exits with the private key still on disk
#     unless the trap is already armed.
if grep -qE '>[[:space:]]*~/\.ssh/id_ed25519' "$ACTION_YML"; then
  check "TEST 15: action.yml writes the deploy key over ~/.ssh/id_ed25519" no
elif ! awk '
    /trap cleanup EXIT/         { trap_line = NR }
    /> "\$KEY_FILE"/            { write_line = NR }
    END { exit !(trap_line && write_line && trap_line < write_line) }
  ' "$ACTION_YML"; then
  check "TEST 15: the cleanup trap is not installed before the key is written" no
else
  check "TEST 15: the deploy key is isolated and the cleanup trap precedes it" ok
fi

echo
if [[ $failures -ne 0 ]]; then
  echo "$failures test(s) failed." >&2
  exit 1
fi
echo "All tests passed."
