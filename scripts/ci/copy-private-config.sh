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

# The string validation above covers what the allowlist SAYS; this covers where
# the filesystem sends it. `rm -rf` does not follow a symlinked FILE, but it
# does follow a symlinked DIRECTORY component, so a linked "$DEST_ROOT/config"
# would put the writes below outside DEST_ROOT with the allowlist looking
# perfectly ordinary. Not reachable from CI -- GITHUB_WORKSPACE is a fresh
# checkout -- but it is reachable in a dev worktree, where local/assets really
# is a symlink into kindred-local. Pinned by TESTs 16-19.
DEST_ROOT_REAL=$(realpath "$DEST_ROOT")
SRC_ROOT_REAL=$(realpath "$SRC_ROOT")

# `realpath -m` resolves the symlinks it finds and treats the rest lexically,
# so containment is decided WITHOUT creating anything first, and on the WHOLE
# destination rather than its parent. Both halves matter. An earlier cut
# validated `dirname "$DEST_ROOT/$p"`, and `dirname` discards a trailing
# slash -- so "docs/camp/" left the final component unresolved while
# `rm -rf` still followed it, one character past the guard. Pinned by TEST 18. An earlier cut
# ran `mkdir -p` to make the parent resolvable, which created directories
# through a symlinked component before rejecting the path -- a write outside
# DEST_ROOT performed by the check that exists to prevent writes outside
# DEST_ROOT. Pinned by TEST 19.
#
# Whole pass runs before the copy loop: that loop deletes each destination
# first, so a bad path found halfway through would already have mutated the
# workspace on behalf of every path ahead of it. Pinned by TEST 17.
inside() {
  # $1 candidate, $2 root -- both already resolved
  [[ $1 == "$2" || $1 == "$2"/* ]]
}

for p in "${paths[@]}"; do
  dest_real=$(realpath -m "$DEST_ROOT/$p")
  inside "$dest_real" "$DEST_ROOT_REAL" \
    || die "destination for '$p' resolves to $dest_real, outside $DEST_ROOT_REAL"

  # The source is a fresh kindred-local clone and therefore trusted, so this
  # is defence in depth -- but the depth is worth having: in cd.yml the GHCR
  # login runs BEFORE this action, and Dockerfile.caddy bakes
  # config/branding*.json into a pushed image. An allowlisted path that is
  # itself a symlink out of the clone would otherwise land in the workspace
  # under a name the workflow believes it chose. Pinned by TEST 20.
  #
  # This checks the REQUESTED path only. A symlink nested inside a requested
  # directory is still dereferenced by `cp -RL` below and is not covered;
  # guarding that would mean walking every copied tree, which is not worth it
  # against a source we control.
  src_real=$(realpath "$SRC_ROOT/$p")
  inside "$src_real" "$SRC_ROOT_REAL" \
    || die "source for '$p' resolves to $src_real, outside $SRC_ROOT_REAL"
done

for p in "${paths[@]}"; do
  dest="$DEST_ROOT/$p"
  mkdir -p "$(dirname "$dest")"
  # Clear first so a re-run cannot leave a stale copy, and -- the case a file
  # destination does not exercise, because `cp` overwrites a file anyway --
  # so that re-copying a DIRECTORY replaces it instead of nesting a second
  # copy inside the first. Pinned by TEST 9.
  rm -rf "$dest"
  # -L dereferences, so a symlink nested inside a copied directory arrives as
  # content rather than as a link that dangles once the clone is deleted.
  cp -RL "$SRC_ROOT/$p" "$dest"
  echo "  copied $p"
done

echo "private config: ${#paths[@]} path(s) copied into $DEST_ROOT"
