# Shared "boot PocketBase against a throwaway DB so JS migrations actually
# apply" harness. Sourced by verify-consolidation.sh, verify-lodging-schema.sh,
# and verify-lodging-seed.sh, which previously reimplemented this three times.
#
# Not a standalone script (no shebang, not executable) -- it is meant to be
# `source`d, so a caller's own `set -euo pipefail` and traps apply to it.
#
# Why serve-and-kill at all: `pocketbase migrate up` silently skips JS
# migrations. jsvm captures MigrationsDir at plugin-registration time, before
# cobra parses CLI flags, so `--migrationsDir` is a no-op -- jsvm always
# resolves filepath.Join(app.DataDir(), "../pb_migrations"). We exploit this
# by symlinking <dataDir>/../pb_migrations -> the target migrations dir so
# jsvm's default resolution lands where we want it.
#
# Signal-handling contract: this file traps nothing on its own. A background
# `pocketbase serve` PID is tracked in _PB_HARNESS_PID while pb_harness_boot
# runs; callers combine harness cleanup with their own via
# pb_harness_install_trap, which installs a single `trap ... EXIT INT TERM`
# that kills the tracked PID from inside the handler. This matters: an
# earlier version of this harness trapped only EXIT and killed the PID
# outside the handler, so a SIGINT arriving during the health poll orphaned a
# `pocketbase serve` bound to an ephemeral port. Fixed once, then had to be
# fixed again in a second copy before kindred#1868 merged this file.
#
# Public API:
#   pb_harness_require_tools [extra tools...]
#   pb_harness_build_binary <go_pkg_dir> <out_path>
#   pb_harness_pick_port
#   pb_harness_install_trap [extra cleanup command]
#   pb_harness_boot <pb_bin> <db_dir> <migrations_dir> <log_path>
#   pb_harness_index_columns <db_path> <index_name>
# See each function's header comment below for details.

# PID of the currently-running background `pocketbase serve`, if any. Internal
# state -- callers should not read or set this directly.
_PB_HARNESS_PID=""

# pb_harness_require_tools [extra tools...]
#
# Exits 2 if git, sqlite3, curl, or python3 (the harness's own dependencies --
# git for repo-root resolution, sqlite3 to query the resulting DB, curl for
# the health poll, python3 for ephemeral port selection) or any
# caller-supplied extra tool isn't on PATH. Normalizes tool absence to exit 2
# (harness error) rather than a `set -e`-triggered 127 or a caller misreading
# it as an assertion failure (exit 1).
#
# Call this first thing, before the first `git` invocation -- checking after
# invoking git is pointless, since a missing git would already have exited 127.
pb_harness_require_tools() {
  local cmd
  for cmd in git sqlite3 curl python3 "$@"; do
    command -v "$cmd" >/dev/null 2>&1 \
      || { echo "error: required command '$cmd' not found" >&2; exit 2; }
  done
}

# pb_harness_build_binary <go_pkg_dir> <out_path>
#
# Builds <go_pkg_dir> to <out_path>, so a verify run always exercises the tree
# it is checking rather than whatever was compiled last.
#
# Existence is not freshness, and that gap is not obvious: `go build ./...` --
# the documented Go gate, and what the pre-push hook runs -- compiles into the
# build cache and rewrites no `-o` target, so nothing in the normal loop
# refreshes a checked-in `pocketbase/pocketbase`. The callers used to assert
# only that the file was present, which makes a forgotten rebuild produce a
# PASS about a binary that predates the change under test. A false FAIL is
# self-limiting because someone investigates; the false PASS is why this
# exists (kindred#1922).
#
# go build is incremental, so on an unchanged tree this costs approximately
# nothing.
#
# Exits 2 -- harness error, not assertion failure -- if go is missing or the
# build fails, echoing the compiler's own output so the exit code is
# actionable. Same contract as pb_harness_require_tools.
pb_harness_build_binary() {
  local pkg_dir="$1" out="$2"

  # Checked here rather than in pb_harness_require_tools' default list so the
  # dependency travels with the function that actually needs it.
  command -v go >/dev/null 2>&1 \
    || { echo "error: required command 'go' not found" >&2; exit 2; }

  # The build runs from inside $pkg_dir, so a relative -o would land there
  # instead of where the caller meant -- and the caller would then boot
  # whatever was already at its intended path, which is the stale-artifact bug
  # this function exists to close, arriving by a different route.
  [[ "$out" == /* ]] \
    || { echo "error: pb_harness_build_binary: output path '$out' must be absolute" >&2; exit 2; }

  local build_log
  build_log=$(mktemp -t pb-harness-build-XXXX)
  if ! ( cd "$pkg_dir" && go build -o "$out" . ) > "$build_log" 2>&1; then
    echo "error: could not build $pkg_dir -> $out" >&2
    cat "$build_log" >&2
    rm -f "$build_log"
    exit 2
  fi
  rm -f "$build_log"
}

# pb_harness_pick_port
# Prints an available ephemeral port on 127.0.0.1 to stdout.
pb_harness_pick_port() {
  python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()'
}

# pb_harness_cleanup
# Kills the tracked background `pocketbase serve`, if any. Safe to call more
# than once (idempotent once _PB_HARNESS_PID is cleared). Exposed for callers
# that want to compose their own trap rather than use pb_harness_install_trap.
pb_harness_cleanup() {
  if [[ -n "$_PB_HARNESS_PID" ]]; then
    kill "$_PB_HARNESS_PID" 2>/dev/null || true
    wait "$_PB_HARNESS_PID" 2>/dev/null || true
    _PB_HARNESS_PID=""
  fi
}

# pb_harness_install_trap [extra cleanup command]
#
# Installs a single `trap ... EXIT INT TERM` that runs pb_harness_cleanup
# (killing any tracked background PocketBase) followed by an optional
# caller-supplied cleanup command, e.g. removing a scratch dir:
#
#   SCRATCH=$(mktemp -d)
#   pb_harness_install_trap 'rm -rf "$SCRATCH"'
#
# The extra command is stored, not evaluated, at install time -- it is
# expanded when the trap actually fires, so referencing a variable (like
# $SCRATCH above) assigned AFTER this call still works, same as a plain
# `trap '...' EXIT INT TERM`.
#
# Calling this more than once replaces the previous trap; it does not chain.
pb_harness_install_trap() {
  local extra="${1:-}"
  # shellcheck disable=SC2064  # deliberate: $extra must expand now (into the
  # trap command string), while any variables *inside* $extra expand later,
  # when the trap fires.
  trap "pb_harness_cleanup; ${extra}" EXIT INT TERM
}

# pb_harness_boot <pb_bin> <db_dir> <migrations_dir> <log_path>
#
# Boots `<pb_bin> serve --automigrate=true` against a throwaway <db_dir>,
# symlinking <migrations_dir> in via the jsvm default-path trick described
# above, polls /api/health with a bounded timeout, stops the server, then
# asserts at least one .js migration landed in _migrations -- the smoke check
# that catches jsvm loading breakage (if this ever passed with 0, the
# `migrate up` silent-skip bug documented above would go unnoticed too).
#
# On success, sets PB_HARNESS_JS_MIGRATION_COUNT (for callers that want to
# report it) and leaves <db_dir>/data.db ready to query. Exits 2 -- not a
# non-zero return -- on boot failure or a failed smoke check, same "harness
# error, not an assertion failure" contract as pb_harness_require_tools.
#
# Health-poll tuning: override via PB_HARNESS_HEALTH_ATTEMPTS (default 200)
# and PB_HARNESS_HEALTH_INTERVAL (default 0.2), e.g. as a temporary
# assignment scoped to one call: `PB_HARNESS_HEALTH_ATTEMPTS=100 pb_harness_boot ...`.
#
# Caller contract: give each call its own <db_dir> PARENT directory, not one
# shared across calls -- the migrations symlink lands at
# dirname(<db_dir>)/pb_migrations, and two calls sharing a parent would
# clobber each other's symlink target. Call pb_harness_install_trap before
# calling this, so a signal during the health poll still kills the
# backgrounded server.
pb_harness_boot() {
  local pb_bin="$1" db_dir="$2" mig_dir="$3" log="$4"

  [[ -x "$pb_bin" ]] \
    || { echo "error: pb_harness_boot: '$pb_bin' not found or not executable" >&2; exit 2; }

  mkdir -p "$db_dir"
  local hooks_dir
  hooks_dir=$(mktemp -d "$(dirname "$db_dir")/pb-harness-hooks-XXXX")

  # jsvm's default resolution is <dataDir>/../pb_migrations -- symlink it to
  # $mig_dir. See the caller contract above re: one db_dir parent per call.
  ln -sfn "$mig_dir" "$(dirname "$db_dir")/pb_migrations"

  local port
  port=$(pb_harness_pick_port)

  "$pb_bin" serve --http="127.0.0.1:$port" \
            --dir "$db_dir" \
            --hooksDir "$hooks_dir" \
            --automigrate=true \
            > "$log" 2>&1 &
  _PB_HARNESS_PID=$!

  local ok=0
  for _ in $(seq 1 "${PB_HARNESS_HEALTH_ATTEMPTS:-200}"); do
    if curl -sf "http://127.0.0.1:$port/api/health" >/dev/null 2>&1; then
      ok=1; break
    fi
    sleep "${PB_HARNESS_HEALTH_INTERVAL:-0.2}"
  done

  # Stop before querying, so the caller's sqlite3 reads a settled database.
  # pb_harness_install_trap's EXIT/INT/TERM trap is the safety net for signal
  # paths; this kill makes it a no-op on the normal path.
  kill "$_PB_HARNESS_PID" 2>/dev/null || true
  wait "$_PB_HARNESS_PID" 2>/dev/null || true
  _PB_HARNESS_PID=""

  if [[ "$ok" -ne 1 ]]; then
    echo "error: pocketbase serve never came up against $mig_dir; log:" >&2
    cat "$log" >&2
    exit 2
  fi

  PB_HARNESS_JS_MIGRATION_COUNT=$(sqlite3 "$db_dir/data.db" "SELECT COUNT(*) FROM _migrations WHERE file LIKE '%.js'")
  if [[ "$PB_HARNESS_JS_MIGRATION_COUNT" -lt 1 ]]; then
    echo "error: smoke check failed — 0 .js entries in _migrations ($db_dir); jsvm migration loading broke" >&2
    cat "$log" >&2
    exit 2
  fi
}

# pb_harness_index_columns <db_path> <index_name>
#
# Prints the columns an index covers as a comma-joined list sorted by name --
# a SET, not a sequence. Callers assert what an index KEYS ON; column order is
# a query-planner concern no caller here is entitled to pin. kindred#2032: a
# `(year, code)` index enforces exactly the uniqueness a `(code, year)` one
# does, and the only single-column filter the lodging code issues is
# `year = {:y}` (lodging/rollforward.go x3), which the reversed order would
# serve BETTER -- so failing on order would block a change that is at worst
# neutral, and a comment justifying the current order would be asserting a
# rationale the query sites contradict.
#
# Reads pragma_index_info rather than substring-matching the stored CREATE
# INDEX text; the two traps that rules out are documented at the call site.
#
# Deliberately NOT `group_concat(name ORDER BY name)`: that ordered-aggregate
# form needs SQLite 3.44+ and is a parse error ("near ORDER: syntax error")
# on Debian bookworm's stock sqlite3 (3.40) and Ubuntu 22.04's (3.37). There
# is no fallback for that error -- under a caller's `set -euo pipefail`, the
# failing command substitution aborts the whole script, skipping every
# assertion after it, not just this one. Sorting the subquery instead of the
# aggregate call gets the same column-SET result on every sqlite3 version.
pb_harness_index_columns() {
  sqlite3 "$1" "SELECT group_concat(name) FROM (SELECT name FROM pragma_index_info('$2') ORDER BY name);"
}
