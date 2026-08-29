#!/usr/bin/env bash
# Copy an explicit allowlist of files out of a kindred-local clone.
#
# Usage:
#   PRIVATE_CONFIG_PATHS=$'config/staff_list.json\nlocal/assets' \
#     scripts/ci/copy-private-config.sh <src-root> <dest-root>
#
# kindred#2575. This replaces the blanket copy that used to live inline in
# .github/actions/clone-kindred-local/action.yml:
#
#     cp /tmp/kindred-local/config/* config/ 2>/dev/null || true
#     cp -r /tmp/kindred-local/local . 2>/dev/null || true
#
# adamflagg/kindred is PUBLIC. That pair put the whole private config/ and
# local/ trees into every consuming job's workspace -- staff names, branding
# and camp logos included -- so that CI's lodging-guard job could read one
# JSON file. Nothing read or published the rest, so there was no leak; the
# hazard was that the NEXT step someone adds to such a job (an artifact
# upload, a workspace tarball, a `find` diagnostic) starts from a workspace
# that is already carrying private data it never asked for. A caller now names
# what it needs and receives exactly that.
#
# The `2>/dev/null || true` was the second defect and is the one that had
# already cost something: a rename on the kindred-local side made a file
# simply not appear, which for the lodging guard meant a silent downgrade to
# its 15-term fallback sample with CI green forever (the kindred#1867
# silent-clean class). ci.yml grew a bespoke gate for that one file in
# kindred#2573; here a missing requested path is a hard failure for every
# consumer, and that gate stays as a second line of defence because it checks
# something this script cannot see -- that the guard CONSUMED the registry.
#
# Behaviour pinned by scripts/ci/test-copy-private-config.sh.

set -euo pipefail

die() {
  echo "error: $*" >&2
  exit 1
}

SRC_ROOT=${1:-}
DEST_ROOT=${2:-}

[[ -n $SRC_ROOT && -n $DEST_ROOT ]] \
  || die "usage: PRIVATE_CONFIG_PATHS=<newline-separated> $0 <src-root> <dest-root>"
[[ -d $SRC_ROOT ]]  || die "source root is not a directory: $SRC_ROOT"
[[ -d $DEST_ROOT ]] || die "destination root is not a directory: $DEST_ROOT"

# The allowlist arrives as a YAML block scalar, so indentation, blank lines and
# a trailing newline are all normal input rather than caller error.
paths=()
while IFS= read -r line; do
  line=${line#"${line%%[![:space:]]*}"}
  line=${line%"${line##*[![:space:]]}"}
  [[ -z $line ]] && continue
  paths+=("$line")
done <<< "${PRIVATE_CONFIG_PATHS-}"

if [[ ${#paths[@]} -eq 0 ]]; then
  die "PRIVATE_CONFIG_PATHS is empty. This action copies an explicit allowlist; \
name the paths the job needs (see .github/actions/clone-kindred-local/action.yml)."
fi

# The allowlist is data supplied by a workflow file, so it is validated rather
# than trusted: without this, "copy exactly these paths" could still be pointed
# at /etc or walked out of DEST_ROOT with `..`, and the rm -rf below would
# follow it there.
for p in "${paths[@]}"; do
  case $p in
    /*) die "allowlist entries must be relative to the repo root, got: $p" ;;
  esac
  case "/$p/" in
    */../*) die "allowlist entries must not contain a '..' segment, got: $p" ;;
  esac
done

# Report EVERY missing path, not just the first: when kindred-local is
# reorganised, one run should name the whole set to fix.
missing=()
for p in "${paths[@]}"; do
  [[ -e "$SRC_ROOT/$p" ]] || missing+=("$p")
done
if [[ ${#missing[@]} -gt 0 ]]; then
  echo "error: requested path(s) not found in $SRC_ROOT:" >&2
  printf '  %s\n' "${missing[@]}" >&2
  die "a rename or move in kindred-local must fail this build, not degrade it silently"
fi

for p in "${paths[@]}"; do
  dest="$DEST_ROOT/$p"
  mkdir -p "$(dirname "$dest")"
  # Clear first so a re-run cannot leave a stale copy, and so copying a
  # directory replaces it rather than nesting inside it.
  rm -rf "$dest"
  # -L dereferences: a dev checkout's config/ is symlinks into kindred-local,
  # and a dangling one must fail here rather than ship a broken link onward.
  cp -RL "$SRC_ROOT/$p" "$dest"
  echo "  copied $p"
done

echo "private config: ${#paths[@]} path(s) copied into $DEST_ROOT"
