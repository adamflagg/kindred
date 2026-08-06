#!/usr/bin/env bash
# Test for scripts/dev/lib/pb-harness.sh
#
# Verifies the tool-absence contract from kindred#1869: a required tool
# missing from PATH must normalize to exit 2 (harness error), not leak a 127
# from `set -e`/exec failure or get misread by a caller as an assertion
# failure (exit 1). Follows the sandboxed-PATH pattern established in
# test-migration-schema-diff.sh's "missing sqlite3" test.
#
# Covers pb_harness_require_tools directly, plus verify-lodging-schema.sh and
# verify-lodging-seed.sh, which (as of kindred#1868) delegate their own
# tool-absence contract to the shared lib instead of each repeating the
# check -- so the assertion belongs here, once, rather than being
# re-implemented per caller.

set -euo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
LIB="$HERE/lib/pb-harness.sh"
SCHEMA_SCRIPT="$HERE/verify-lodging-schema.sh"
SEED_SCRIPT="$HERE/verify-lodging-seed.sh"

[[ -f "$LIB" ]] || { echo "FAIL: $LIB missing" >&2; exit 1; }
for f in "$SCHEMA_SCRIPT" "$SEED_SCRIPT"; do
  [[ -x "$f" ]] || { echo "FAIL: $f not executable or missing" >&2; exit 1; }
done

SCRATCH=$(mktemp -d -t pb-harness-test-XXXX)
trap 'rm -rf "$SCRATCH"' EXIT INT TERM

# Every tool any of the exercised code paths might need before the
# tool-absence check fires, so a *different* missing tool never masks the one
# under test. bash/env matter for the two scripts' `#!/usr/bin/env bash`
# shebang; dirname/basename for their `$(dirname "${BASH_SOURCE[0]}")` setup.
ALL_TOOLS=(bash env git sqlite3 curl python3 grep sed awk mktemp rm cat mkdir \
           dirname basename type command ln seq kill wait sleep go jq diff)

# build_sandbox <dir> <excluded tool> -- symlink every tool in ALL_TOOLS into
# <dir> except <excluded tool>, so PATH=<dir> reproduces "every dependency
# present except this one" rather than "nothing present".
build_sandbox() {
  local dir="$1" exclude="$2" tool src
  mkdir -p "$dir"
  for tool in "${ALL_TOOLS[@]}"; do
    [[ "$tool" == "$exclude" ]] && continue
    src="$(command -v "$tool" 2>/dev/null || true)"
    [[ -n "$src" ]] && ln -sf "$src" "$dir/$tool"
  done
}

SANDBOX_NO_SQLITE3="$SCRATCH/no-sqlite3"
build_sandbox "$SANDBOX_NO_SQLITE3" sqlite3

SANDBOX_NO_CURL="$SCRATCH/no-curl"
build_sandbox "$SANDBOX_NO_CURL" curl

echo "=== TEST 1: pb_harness_require_tools exits 2 (not 127) when sqlite3 is missing ==="
set +e
PATH="$SANDBOX_NO_SQLITE3" bash -c "source '$LIB'; pb_harness_require_tools" >/dev/null 2>"$SCRATCH/t1.err"
rc=$?
set -e
if [[ $rc -eq 2 ]] && grep -q "sqlite3" "$SCRATCH/t1.err"; then
  echo "PASS: missing sqlite3 -> exit 2, names sqlite3"
else
  echo "FAIL: missing sqlite3 expected exit 2 naming sqlite3, got rc=$rc; stderr:" >&2
  cat "$SCRATCH/t1.err" >&2
  exit 1
fi

echo
echo "=== TEST 2: pb_harness_require_tools exits 2 (not 127) when curl is missing ==="
set +e
PATH="$SANDBOX_NO_CURL" bash -c "source '$LIB'; pb_harness_require_tools" >/dev/null 2>"$SCRATCH/t2.err"
rc=$?
set -e
if [[ $rc -eq 2 ]] && grep -q "curl" "$SCRATCH/t2.err"; then
  echo "PASS: missing curl -> exit 2, names curl"
else
  echo "FAIL: missing curl expected exit 2 naming curl, got rc=$rc; stderr:" >&2
  cat "$SCRATCH/t2.err" >&2
  exit 1
fi

echo
echo "=== TEST 3: verify-lodging-schema.sh propagates the lib's tool-absence contract (exit 2, not 127) ==="
set +e
PATH="$SANDBOX_NO_SQLITE3" "$SCHEMA_SCRIPT" >/dev/null 2>"$SCRATCH/t3.err"
rc=$?
set -e
if [[ $rc -eq 2 ]]; then
  echo "PASS: verify-lodging-schema.sh with sqlite3 missing -> exit 2"
else
  echo "FAIL: expected exit 2, got $rc; stderr:" >&2
  cat "$SCRATCH/t3.err" >&2
  exit 1
fi

echo
echo "=== TEST 4: verify-lodging-seed.sh propagates the lib's tool-absence contract (exit 2, not 127) ==="
set +e
PATH="$SANDBOX_NO_SQLITE3" "$SEED_SCRIPT" >/dev/null 2>"$SCRATCH/t4.err"
rc=$?
set -e
if [[ $rc -eq 2 ]]; then
  echo "PASS: verify-lodging-seed.sh with sqlite3 missing -> exit 2"
else
  echo "FAIL: expected exit 2, got $rc; stderr:" >&2
  cat "$SCRATCH/t4.err" >&2
  exit 1
fi

# --- pb_harness_build_binary (kindred#1922) ---------------------------------
#
# The harness used to assert only that the binary EXISTED. `go build ./...`
# (what pre-push runs) populates the build cache without rewriting
# pocketbase/pocketbase, so a verify run could boot an arbitrarily old binary
# and report PASS about a tree it never compiled. These three tests pin the
# rebuild, and pin that a build problem is a harness error (2), not an
# assertion failure (1).
#
# A throwaway one-file Go module stands in for pocketbase itself: it makes the
# staleness assertion OBSERVABLE (the binary's own output changes when the
# source does) and keeps the test at build-a-hello-world cost rather than
# build-all-of-PocketBase cost.
FIXTURE_SRC="$SCRATCH/gomod"
FIXTURE_BIN="$SCRATCH/fixture-bin"
mkdir -p "$FIXTURE_SRC"
cat > "$FIXTURE_SRC/go.mod" <<'EOF'
module pbharnessfixture

go 1.21
EOF

# write_fixture <printed string> -- rewrite the fixture's only source file.
write_fixture() {
  cat > "$FIXTURE_SRC/main.go" <<EOF
package main

import "fmt"

func main() { fmt.Println("$1") }
EOF
}

echo
echo "=== TEST 5: pb_harness_build_binary rebuilds a stale binary ==="
write_fixture v1
( cd "$FIXTURE_SRC" && go build -o "$FIXTURE_BIN" . )
[[ "$("$FIXTURE_BIN")" == "v1" ]] || { echo "FAIL: fixture setup did not produce v1" >&2; exit 1; }

# The binary on disk is now older than its source -- exactly the state a
# rebased-onto-new-Go-source tree is in.
write_fixture v2
set +e
bash -c "source '$LIB'; pb_harness_build_binary '$FIXTURE_SRC' '$FIXTURE_BIN'" \
  >"$SCRATCH/t5.out" 2>"$SCRATCH/t5.err"
rc=$?
set -e
actual=$("$FIXTURE_BIN" 2>/dev/null || true)
if [[ $rc -eq 0 && "$actual" == "v2" ]]; then
  echo "PASS: stale binary rebuilt from current source"
else
  echo "FAIL: expected rc=0 and rebuilt binary printing v2, got rc=$rc printing '$actual'; stderr:" >&2
  cat "$SCRATCH/t5.err" >&2
  exit 1
fi

echo
echo "=== TEST 6: pb_harness_build_binary exits 2 (not 127) when go is missing ==="
SANDBOX_NO_GO="$SCRATCH/no-go"
build_sandbox "$SANDBOX_NO_GO" go
set +e
PATH="$SANDBOX_NO_GO" bash -c "source '$LIB'; pb_harness_build_binary '$FIXTURE_SRC' '$FIXTURE_BIN'" \
  >/dev/null 2>"$SCRATCH/t6.err"
rc=$?
set -e
if [[ $rc -eq 2 ]] && grep -q "required command 'go' not found" "$SCRATCH/t6.err"; then
  echo "PASS: missing go -> exit 2, names go"
else
  echo "FAIL: missing go expected exit 2 naming go, got rc=$rc; stderr:" >&2
  cat "$SCRATCH/t6.err" >&2
  exit 1
fi

echo
echo "=== TEST 7: pb_harness_build_binary exits 2 and surfaces the compiler error on a broken tree ==="
# A build failure means "cannot run the check", not "the check failed" -- so it
# must not be mistakable for an assertion failure, and the compiler's own
# message has to reach the operator or the exit code says nothing actionable.
cat > "$FIXTURE_SRC/main.go" <<'EOF'
package main

func main() { this is not go }
EOF
set +e
bash -c "source '$LIB'; pb_harness_build_binary '$FIXTURE_SRC' '$FIXTURE_BIN'" \
  >/dev/null 2>"$SCRATCH/t7.err"
rc=$?
set -e
if [[ $rc -eq 2 ]] && grep -q "main.go" "$SCRATCH/t7.err"; then
  echo "PASS: build failure -> exit 2, compiler output surfaced"
else
  echo "FAIL: broken source expected exit 2 quoting main.go, got rc=$rc; stderr:" >&2
  cat "$SCRATCH/t7.err" >&2
  exit 1
fi

echo
echo "=== TEST 8: pb_harness_build_binary refuses a relative output path ==="
# The build runs from inside <go_pkg_dir>, so a relative -o lands next to the
# source instead of where the caller meant -- and the caller then boots
# whatever WAS at its intended path. That is this issue's own failure mode
# (a green run about the wrong artifact) reintroduced by a different route,
# so it fails loudly rather than building somewhere surprising.
write_fixture v3
set +e
bash -c "source '$LIB'; pb_harness_build_binary '$FIXTURE_SRC' 'relative-bin'" \
  >/dev/null 2>"$SCRATCH/t8.err"
rc=$?
set -e
if [[ $rc -eq 2 ]] && [[ ! -e "$FIXTURE_SRC/relative-bin" ]]; then
  echo "PASS: relative output path -> exit 2, nothing built"
else
  echo "FAIL: expected exit 2 and no binary, got rc=$rc; stderr:" >&2
  cat "$SCRATCH/t8.err" >&2
  exit 1
fi

echo
echo "=== TEST 9: verify-lodging-schema.sh propagates the build contract (exit 2) when go is missing ==="
# The mirror of TESTS 3/4 for the build dependency. Those pin that a missing
# TOOL reaches the caller as exit 2; kindred#1922 gave the two lodging scripts
# a second way to be unrunnable -- no Go toolchain -- and a contract nothing
# asserts is a contract that drifts. Exits before any build or boot, so this
# costs the same as tests 3/4.
set +e
PATH="$SANDBOX_NO_GO" "$SCHEMA_SCRIPT" >/dev/null 2>"$SCRATCH/t9.err"
rc=$?
set -e
if [[ $rc -eq 2 ]] && grep -q "required command 'go' not found" "$SCRATCH/t9.err"; then
  echo "PASS: verify-lodging-schema.sh with go missing -> exit 2"
else
  echo "FAIL: expected exit 2 naming go, got $rc; stderr:" >&2
  cat "$SCRATCH/t9.err" >&2
  exit 1
fi

echo
echo "=== TEST 10: verify-lodging-seed.sh propagates the build contract (exit 2) when go is missing ==="
set +e
PATH="$SANDBOX_NO_GO" "$SEED_SCRIPT" >/dev/null 2>"$SCRATCH/t10.err"
rc=$?
set -e
if [[ $rc -eq 2 ]] && grep -q "required command 'go' not found" "$SCRATCH/t10.err"; then
  echo "PASS: verify-lodging-seed.sh with go missing -> exit 2"
else
  echo "FAIL: expected exit 2 naming go, got $rc; stderr:" >&2
  cat "$SCRATCH/t10.err" >&2
  exit 1
fi

echo
echo "=== TEST 11: pb_harness_index_columns reports a column SET, order-independently (kindred#2032) ==="
# (code, year) and (year, code) enforce identical uniqueness, so the verifier
# must not distinguish them -- the pre-#2032 query returned 'year,code' for the
# reversed index and the caller false-FAILed. The single-column index is the
# mutation guard: a "fix" that returned a constant, or that ignored the index's
# actual columns, would pass the first two assertions and fail this one.
IDXDB="$SCRATCH/index-order.db"
sqlite3 "$IDXDB" "
  CREATE TABLE fwd(code TEXT, year INT);
  CREATE UNIQUE INDEX idx_fwd_code ON fwd(\`code\`, \`year\`);
  CREATE TABLE rev(code TEXT, year INT);
  CREATE UNIQUE INDEX idx_rev_code ON rev(\`year\`, \`code\`);
  CREATE TABLE solo(code TEXT, year INT);
  CREATE UNIQUE INDEX idx_solo_code ON solo(\`year\`);
"
set +e
fwd=$(bash -c "source '$LIB'; pb_harness_index_columns '$IDXDB' idx_fwd_code" 2>/dev/null)
rev=$(bash -c "source '$LIB'; pb_harness_index_columns '$IDXDB' idx_rev_code" 2>/dev/null)
solo=$(bash -c "source '$LIB'; pb_harness_index_columns '$IDXDB' idx_solo_code" 2>/dev/null)
set -e
if [[ "$fwd" == "code,year" && "$rev" == "code,year" && "$solo" == "year" ]]; then
  echo "PASS: both column orders report 'code,year'; a single-column index stays distinguishable"
else
  echo "FAIL: expected fwd='code,year' rev='code,year' solo='year'; got fwd='$fwd' rev='$rev' solo='$solo'" >&2
  exit 1
fi

echo
echo "=== TEST 12: pb_harness_index_columns avoids the version-gated ordered-aggregate form (kindred#2048) ==="
# group_concat(name ORDER BY name) is an ORDERED AGGREGATE -- a SQLite 3.44+
# feature. It is a parse error ("near ORDER: syntax error") on Debian
# bookworm's stock sqlite3 (3.40.1) and Ubuntu 22.04's (3.37), confirmed
# against a real bookworm sqlite3 binary. Under this repo's own
# set -euo pipefail, `cols=$(pb_harness_index_columns ...)` failing aborts
# verify-lodging-schema.sh mid-run -- every RBAC/rule/migration assertion
# after it silently never runs, and the operator sees a bare SQLite error
# instead of a `note`.
#
# This repo's dev sqlite3 is itself 3.44+, so the parse error can't be
# reproduced by calling the function here -- this pins the SQL text instead,
# against reintroducing the ordered-aggregate form.
if grep -vE '^\s*#' "$LIB" | grep -qE 'group_concat\([^)]*ORDER BY'; then
  echo "FAIL: pb_harness_index_columns uses an ordered aggregate; parse error on sqlite3 < 3.44 (Debian bookworm ships 3.40)" >&2
  exit 1
else
  echo "PASS: pb_harness_index_columns avoids the version-gated ordered-aggregate form"
fi

echo
echo "All tests passed."
