#!/usr/bin/env bash
# Guard: every Go build in this repo uses the SAME minor, at its latest patch.
#
# The rule (owner-approved): "pocketbase/go.mod picks the minor; every build
# uses the latest patch of it."
#
# pocketbase/go.mod's `go X.Y` line is the single source of truth. This fails if:
#   - that line carries a patch (`go 1.27.0`) or the file has a `toolchain`
#     directive -- setup-go's go-version-file would then install exactly that
#     patch instead of the latest one;
#   - docker/healthcheck/go.mod or go.work says anything but `go X.Y`;
#   - a Dockerfile stage is FROM a golang image that is not the official
#     `golang:X.Y[-variant]` -- a different minor, a patch pin
#     (`golang:1.26.4-alpine`), no tag / `latest`, a digest, an ARG template,
#     or another registry's golang (dhi.io tags lag upstream patches);
#   - a stage that runs a `go` command is not based on a golang image at all;
#   - a Dockerfile sets GOTOOLCHAIN to anything but `local`. `auto` downloads
#     the MINIMUM toolchain go.mod allows (go1.27.0), not the latest patch; the
#     image tag is the toolchain, so nothing may download another one;
#   - a workflow pins `go-version:` literally, or points `go-version-file:` at
#     anything but pocketbase/go.mod.
#
# Usage: check-go-version-alignment.sh [REPO_ROOT]   (default: git toplevel)
# Exit:  0 aligned, 1 misaligned, 2 could not run (missing inputs).

set -euo pipefail

ROOT=${1:-$(git rev-parse --show-toplevel)}
failures=0

fail() {
  echo "FAIL: $*" >&2
  failures=$((failures + 1))
}

# go_line <file> -- prints the value of the file's `go` directive, or nothing.
go_line() {
  sed -nE 's/^go[[:space:]]+([^[:space:]]+)[[:space:]]*$/\1/p' "$1" | head -n 1
}

PB_MOD="$ROOT/pocketbase/go.mod"
if [[ ! -r "$PB_MOD" ]]; then
  echo "ERROR: $PB_MOD not readable -- nothing to align against" >&2
  exit 2
fi
PB_GO=$(go_line "$PB_MOD")
if [[ ! "$PB_GO" =~ ^([0-9]+)\.([0-9]+)(\.[0-9]+)?$ ]]; then
  echo "ERROR: pocketbase/go.mod has no parseable 'go X.Y' line (got '$PB_GO')" >&2
  exit 2
fi
MINOR="${BASH_REMATCH[1]}.${BASH_REMATCH[2]}"
echo "Go minor from pocketbase/go.mod: $MINOR"

# --- go directives ------------------------------------------------------------
for rel in pocketbase/go.mod docker/healthcheck/go.mod go.work; do
  f="$ROOT/$rel"
  if [[ ! -r "$f" ]]; then
    fail "$rel is missing"
    continue
  fi
  got=$(go_line "$f")
  if [[ "$got" != "$MINOR" ]]; then
    fail "$rel says 'go ${got:-<none>}', want exactly 'go $MINOR' (minor only, no patch)"
  fi
  if grep -qE '^toolchain[[:space:]]' "$f"; then
    fail "$rel has a toolchain directive -- setup-go would install that exact patch; remove it"
  fi
done

# --- Dockerfiles ----------------------------------------------------------------
shopt -s nullglob
dockerfiles=("$ROOT"/docker/Dockerfile*)
shopt -u nullglob
if [[ ${#dockerfiles[@]} -eq 0 ]]; then
  echo "ERROR: no docker/Dockerfile* under $ROOT -- nothing checked" >&2
  exit 2
fi

GO_CMD_RE='(^|[[:space:];&|(`"])go[[:space:]]+(build|mod|install|test|run|generate|vet|work|get|env)([[:space:]]|$)|"go",'
# `GOTOOLCHAIN=value` or `GOTOOLCHAIN value` (ENV's legacy space form).
TOOLCHAIN_RE='GOTOOLCHAIN[[:space:]]*[=[:space:]][[:space:]]*["'\'']?([^"'\''[:space:]\\]+)'

for df in "${dockerfiles[@]}"; do
  rel=${df#"$ROOT"/}
  declare -A stage_is_go=()
  stage_n=0
  stage_label=""
  stage_image=""
  cur_is_go=false
  cur_flagged=false
  lineno=0

  while IFS= read -r line || [[ -n "$line" ]]; do
    lineno=$((lineno + 1))
    trimmed="${line#"${line%%[![:space:]]*}"}"
    [[ -z "$trimmed" || "$trimmed" == \#* ]] && continue

    if [[ "$trimmed" =~ ^[Ff][Rr][Oo][Mm][[:space:]] ]]; then
      read -r -a tok <<< "$trimmed"
      i=1
      while [[ $i -lt ${#tok[@]} && "${tok[$i]}" == --* ]]; do i=$((i + 1)); done
      image="${tok[$i]:-}"
      alias=""
      as_kw="${tok[$((i + 1))]:-}"
      if [[ "${as_kw,,}" == "as" && -n "${tok[$((i + 2))]:-}" ]]; then
        alias="${tok[$((i + 2))],,}"
      fi
      stage_n=$((stage_n + 1))
      stage_label="${alias:-stage $stage_n}"
      cur_flagged=false

      if [[ -n "${stage_is_go[${image,,}]+x}" ]]; then
        # FROM an earlier stage: inherits that stage's base.
        cur_is_go="${stage_is_go[${image,,}]}"
      else
        ref="${image%%@*}"
        repo="$ref"
        tag=""
        last="${ref##*/}"
        if [[ "$last" == *:* ]]; then
          tag="${last#*:}"
          repo="${ref%:*}"
        fi
        if [[ "${repo##*/}" == "golang" ]]; then
          cur_is_go=true
          if [[ "$repo" != "golang" ]]; then
            fail "$rel:$lineno ($stage_label) FROM $image -- use the official 'golang:$MINOR-<variant>' image, not another registry's golang"
          elif [[ "$image" == *@* ]]; then
            fail "$rel:$lineno ($stage_label) FROM $image -- a digest freezes the patch; use the floating 'golang:$MINOR-<variant>' tag"
          elif [[ ! "$tag" =~ ^([0-9]+\.[0-9]+)(-[a-z][a-z0-9.]*)?$ ]]; then
            fail "$rel:$lineno ($stage_label) FROM $image -- tag must be 'golang:$MINOR' or 'golang:$MINOR-<variant>' (no patch, no 'latest', no ARG)"
          elif [[ "${BASH_REMATCH[1]}" != "$MINOR" ]]; then
            fail "$rel:$lineno ($stage_label) FROM $image -- minor ${BASH_REMATCH[1]} differs from pocketbase/go.mod's $MINOR"
          fi
        else
          cur_is_go=false
        fi
      fi
      [[ -n "$alias" ]] && stage_is_go[$alias]=$cur_is_go
      stage_image="$image"
      continue
    fi

    if [[ "$trimmed" =~ $TOOLCHAIN_RE ]] && [[ "${BASH_REMATCH[1]}" != "local" ]]; then
      fail "$rel:$lineno sets GOTOOLCHAIN=${BASH_REMATCH[1]} -- must be 'local' (the image tag is the toolchain; never download one)"
    fi

    if [[ $cur_is_go == false && $cur_flagged == false && "$trimmed" =~ $GO_CMD_RE ]]; then
      fail "$rel:$lineno ($stage_label) runs a go command but is FROM ${stage_image:-<none>} -- Go build stages must use 'golang:$MINOR-<variant>'"
      cur_flagged=true
    fi
  done < "$df"
  unset stage_is_go
done

# --- Workflows --------------------------------------------------------------------
shopt -s nullglob
workflows=("$ROOT"/.github/workflows/*.yml "$ROOT"/.github/workflows/*.yaml)
shopt -u nullglob
for wf in "${workflows[@]}"; do
  rel=${wf#"$ROOT"/}
  lineno=0
  while IFS= read -r line || [[ -n "$line" ]]; do
    lineno=$((lineno + 1))
    trimmed="${line#"${line%%[![:space:]]*}"}"
    [[ "$trimmed" == \#* ]] && continue
    if [[ "$trimmed" =~ ^-?[[:space:]]*go-version:[[:space:]] ]]; then
      fail "$rel:$lineno pins a literal go-version -- use 'go-version-file: pocketbase/go.mod'"
    elif [[ "$trimmed" =~ ^-?[[:space:]]*go-version-file:[[:space:]]*[\"\']?([^\"\'[:space:]]+) ]] \
        && [[ "${BASH_REMATCH[1]}" != "pocketbase/go.mod" ]]; then
      fail "$rel:$lineno go-version-file: ${BASH_REMATCH[1]} -- must be pocketbase/go.mod"
    fi
  done < "$wf"
done

if [[ $failures -gt 0 ]]; then
  echo "$failures Go version alignment problem(s). Rule: pocketbase/go.mod picks the minor; every build uses the latest patch of it." >&2
  exit 1
fi
echo "OK: go.mod/go.work directives, ${#dockerfiles[@]} Dockerfile(s) and ${#workflows[@]} workflow(s) all use Go $MINOR at its latest patch"
