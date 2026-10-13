#!/usr/bin/env bash
# scripts/ci/test-check-private-names.sh -- self-test in a scratch repo.
#
# Fictional terms only. The strict group stands in for the full camp name and
# the guide repo's name (any hit fails); the ratchet group stands in for the
# short camp name (hits allowed per file up to a shrink-only baseline).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
GUARD="$HERE/check-private-names.sh"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
mkdir "$TMP/repo" && cd "$TMP/repo" && git init -q && git config user.email t@example.test && git config user.name t
commit() { git add -A . && git -c commit.gpgsign=false commit -qm "$1"; }

printf 'Zebracamp Mountain Retreat\nsecret-repo-name\n' > "$TMP/strict"
printf 'zebracamp\n' > "$TMP/ratchet"
printf '# comment lines and blank lines are ignored\n\n' > "$TMP/base-empty"

fail=0
all_out=""
# run <expected rc> <label> [VAR=value ...] -- runs the guard, records output.
run() {
  local want="$1" label="$2"; shift 2
  out="$(env "$@" bash "$GUARD" 2>&1)" && rc=0 || rc=$?
  all_out+="$out"$'\n'
  [ "$rc" = "$want" ] || { echo "FAIL $label: expected exit $want, got $rc"; printf '%s\n' "$out" | sed 's/^/    /'; fail=1; }
}
expect() { grep -q -- "$1" <<<"$out" || { echo "FAIL $2: output lacks '$1'"; fail=1; }; }
expect_line() { grep -qx -- "$1" <<<"$out" || { echo "FAIL $2: output lacks line '$1'"; fail=1; }; }

S="PRIVATE_NAMES_STRICT_FILE=$TMP/strict"
R="PRIVATE_NAMES_RATCHET_FILE=$TMP/ratchet"

printf 'hello world\n' > clean.txt
commit seed
run 0 "clean tree" "$S" "$R" "PRIVATE_NAMES_BASELINE=$TMP/base-empty"

# --- ratchet: a hit in a file the baseline does not list fails --------------
printf 'line one\nwe visit Zebracamp today\n' > leak.md
commit leak
run 1 "new file with a ratchet hit" "$S" "$R" "PRIVATE_NAMES_BASELINE=$TMP/base-empty"
expect_line 'leak.md:2' "new file with a ratchet hit"
expect 'leak.md: 1 line(s) contain a private name and the file is not in the baseline' "new file with a ratchet hit"

# --- ratchet: a missing or zero-byte baseline is an empty baseline -----------
# Not "malformed": with no baseline records the hits must not be read as one.
: > "$TMP/base-zero"
for b in "$TMP/no-such-baseline" "$TMP/base-zero"; do
  run 1 "baseline $(basename "$b")" "$S" "$R" "PRIVATE_NAMES_BASELINE=$b"
  expect_line 'leak.md:2' "baseline $(basename "$b")"
  expect 'leak.md: 1 line(s) contain a private name and the file is not in the baseline' "baseline $(basename "$b")"
  if grep -q malformed <<<"$out"; then echo "FAIL baseline $(basename "$b"): misreported as malformed"; fail=1; fi
done

# --- a failed scan fails the guard; it never reads as clean -------------------
# git grep exits 1 for "no match" and >1 for an error. A stub git that fails
# only `grep` stands in for a real error (a corrupt index, say).
mkdir "$TMP/badgit"
# shellcheck disable=SC2016  # $1 and $@ belong to the stub, not to this shell
printf '#!/usr/bin/env bash\n[ "$1" = grep ] && exit 128\nexec %q "$@"\n' "$(command -v git)" > "$TMP/badgit/git"
chmod +x "$TMP/badgit/git"
run 3 "git grep error, strict" "$S" "PATH=$TMP/badgit:$PATH"
expect 'git grep failed' "git grep error, strict"
run 3 "git grep error, ratchet" "$R" "PRIVATE_NAMES_BASELINE=$TMP/base-empty" "PATH=$TMP/badgit:$PATH"
expect 'git grep failed' "git grep error, ratchet"

# --- ratchet: a file at exactly its baseline count passes --------------------
printf '# header\nleak.md\t1\n' > "$TMP/base1"
run 0 "file at its baseline count" "$S" "$R" "PRIVATE_NAMES_BASELINE=$TMP/base1"

# --- ratchet: a count above the baseline fails --------------------------------
printf 'zebracamp again\n' >> leak.md
commit more
run 1 "count above baseline" "$S" "$R" "PRIVATE_NAMES_BASELINE=$TMP/base1"
expect_line 'leak.md:3' "count above baseline"

# --- ratchet: a count below the baseline fails, telling you to lower it ------
printf 'leak.md\t3\n' > "$TMP/base3"
run 1 "count below baseline" "$S" "$R" "PRIVATE_NAMES_BASELINE=$TMP/base3"
expect 'baseline is stale: lower leak.md to 2' "count below baseline"

# --- ratchet: a baselined file with no hits, or gone, must be removed --------
printf 'leak.md\t2\ngone.md\t1\nclean.txt\t1\n' > "$TMP/base-gone"
run 1 "baselined file gone or clean" "$S" "$R" "PRIVATE_NAMES_BASELINE=$TMP/base-gone"
expect 'baseline is stale: remove gone.md' "baselined file no longer exists"
expect 'baseline is stale: remove clean.txt' "baselined file now has 0 hits"

# --- ratchet: a malformed baseline line is an error, not ignored -------------
# The valid line alone would pass, so only the malformed one can fail this.
printf 'leak.md\t2\nnot-a-valid-line\n' > "$TMP/base-bad"
run 1 "malformed baseline" "$S" "$R" "PRIVATE_NAMES_BASELINE=$TMP/base-bad"
expect 'malformed' "malformed baseline"
printf 'leak.md\t2\nleak.md\t2\n' > "$TMP/base-dup"
run 1 "a path listed twice" "$S" "$R" "PRIVATE_NAMES_BASELINE=$TMP/base-dup"
expect 'malformed' "a path listed twice"

printf 'leak.md\t2\n' > "$TMP/base2"
run 0 "baseline matches exactly" "$S" "$R" "PRIVATE_NAMES_BASELINE=$TMP/base2"

# --- strict: a strict hit fails even inside a baselined file ------------------
# The strict term contains the ratchet term, so the baseline moves to 3 to keep
# the ratchet half satisfied -- the failure must come from the strict group.
printf 'at the Zebracamp Mountain Retreat\n' >> leak.md
commit strict-in-baselined
printf 'leak.md\t3\n' > "$TMP/base3"
run 1 "strict hit in a baselined file" "$S" "$R" "PRIVATE_NAMES_BASELINE=$TMP/base3"
expect_line 'leak.md:4' "strict hit in a baselined file"
git rm -q leak.md && commit unleak

# --- strict: a strict hit anywhere fails, with no ratchet terms at all --------
printf 'see secret-repo-name for details\n' > repo.txt
commit repo
run 1 "strict hit, strict terms only" "$S"
expect_line 'repo.txt:1' "strict hit, strict terms only"
git rm -q repo.txt && commit unrepo
run 0 "clean again" "$S" "$R" "PRIVATE_NAMES_BASELINE=$TMP/base-empty"

# --- a binary tracked file is scanned too; only file:line is printed ----------
printf 'x\0see secret-repo-name\n' > blob.bin
commit blob
run 1 "strict hit in a binary file" "$S" "$R" "PRIVATE_NAMES_BASELINE=$TMP/base-empty"
expect_line 'blob.bin:1' "strict hit in a binary file"
git rm -q blob.bin && commit unblob

# --- a term in a tracked PATH fails, and the path is never printed -----------
# Its content matches too: the content scan's file:line would print the path.
mkdir notes && printf 'zebracamp\n' > notes/zebracamp-trip.txt
commit path
run 1 "term in a tracked path" "$S" "$R" "PRIVATE_NAMES_BASELINE=$TMP/base-empty"
expect '1 tracked path(s) contain a private name' "term in a tracked path"
git rm -q -r notes && commit unpath
run 0 "clean after path" "$S" "$R" "PRIVATE_NAMES_BASELINE=$TMP/base-empty"

# --- REQUIRED means BOTH groups: one empty group must not pass quietly --------
run 2 "REQUIRED, ratchet terms only" "PRIVATE_NAMES_STRICT_FILE=$TMP/none" "$R" "PRIVATE_NAMES_BASELINE=$TMP/base-empty" PRIVATE_NAMES_REQUIRED=1
expect 'no strict private-name terms' "REQUIRED, ratchet terms only"
run 2 "REQUIRED, strict terms only" "$S" "PRIVATE_NAMES_RATCHET_FILE=$TMP/none" PRIVATE_NAMES_REQUIRED=1
expect 'no ratchet private-name terms' "REQUIRED, strict terms only"
run 0 "REQUIRED, both groups" "$S" "$R" "PRIVATE_NAMES_BASELINE=$TMP/base-empty" PRIVATE_NAMES_REQUIRED=1

# --- missing terms: skip without the deploy key, hard-fail with it ----------
run 2 "no terms, REQUIRED" "PRIVATE_NAMES_STRICT_FILE=$TMP/none" "PRIVATE_NAMES_RATCHET_FILE=$TMP/none" PRIVATE_NAMES_REQUIRED=1
run 2 "no term files named, REQUIRED" PRIVATE_NAMES_REQUIRED=1
# A blank line would be an empty pattern, which git grep matches against EVERY
# line; blank-only terms count as no terms at all.
printf '\n  \n' > "$TMP/blank"
run 2 "blank-only terms, REQUIRED" "PRIVATE_NAMES_STRICT_FILE=$TMP/blank" "PRIVATE_NAMES_RATCHET_FILE=$TMP/blank" PRIVATE_NAMES_REQUIRED=1
printf 'zebracamp\n\n' > "$TMP/ratchet-with-blank"
run 0 "a blank line among terms flags nothing" "$S" "PRIVATE_NAMES_RATCHET_FILE=$TMP/ratchet-with-blank" "PRIVATE_NAMES_BASELINE=$TMP/base-empty"
run 0 "no terms, fork or Dependabot" "PRIVATE_NAMES_STRICT_FILE=$TMP/none" "PRIVATE_NAMES_RATCHET_FILE=$TMP/none"
expect '^::notice::' "a skipped guard must say so with ::notice::"

# --- shrink-only against the base branch's baseline ---------------------------
# PRIVATE_NAMES_BASE_BASELINE is the base branch's copy: the current baseline
# may not list a path the base lacks, nor raise a count. Lowering or removing
# passes; a missing base copy skips with a notice. Runs before the term scan,
# so no terms are needed (forks included). Strict terms only below: the
# ratchet half would call these made-up baselines stale.
B="PRIVATE_NAMES_BASELINE=$TMP/cur"
printf '# c\na.md\t2\nb.md\t1\n' > "$TMP/base-copy"
BB="PRIVATE_NAMES_BASE_BASELINE=$TMP/base-copy"
printf 'a.md\t2\nb.md\t1\n' > "$TMP/cur"
run 0 "base compare, identical" "$S" "$B" "$BB"
printf 'a.md\t2\nb.md\t1\nc.md\t1\n' > "$TMP/cur"
run 1 "base compare, path added" "$S" "$B" "$BB"
expect 'baseline adds c.md: new private-name hits may not be baselined' "base compare, path added"
printf 'a.md\t3\nb.md\t1\n' > "$TMP/cur"
run 1 "base compare, count raised" "$S" "$B" "$BB"
expect 'baseline raises a.md from 2 to 3' "base compare, count raised"
printf 'a.md\t1\n' > "$TMP/cur"
run 0 "base compare, lowered/removed passes" "$S" "$B" "$BB"
printf 'a.md\t2\nc.md\t1\n' > "$TMP/cur"
run 1 "base compare, add works without terms" "PRIVATE_NAMES_STRICT_FILE=$TMP/none" "PRIVATE_NAMES_RATCHET_FILE=$TMP/none" "$B" "$BB"
expect 'baseline adds c.md' "base compare, add works without terms"
run 0 "base compare, missing base copy skips" "$S" "PRIVATE_NAMES_BASELINE=$TMP/base-empty" "PRIVATE_NAMES_BASE_BASELINE=$TMP/no-such-base"
expect '^::notice::.*base' "missing base copy skips with a notice"

# --- across EVERY run above: no term and no matched line was ever printed ---
for leaked in zebracamp secret-repo-name 'Mountain Retreat' visit again 'for details'; do
  if grep -qi -- "$leaked" <<<"$all_out"; then echo "FAIL some run echoed '$leaked'"; fail=1; fi
done

[ "$fail" = 0 ] && echo "all private-names guard tests passed"
exit "$fail"
