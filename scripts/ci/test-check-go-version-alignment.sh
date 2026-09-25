#!/usr/bin/env bash
# Self-test for scripts/ci/check-go-version-alignment.sh
#
# The rule under test: "pocketbase/go.mod picks the minor; every build uses the
# latest patch of it." Before the guard existed the tree had drifted three ways
# at once -- pocketbase/go.mod said 1.27, docker/healthcheck/go.mod said 1.24,
# the PocketBase and init images built on dhi.io/golang:1.26 with
# GOTOOLCHAIN=auto (which downloads the MINIMUM toolchain go.mod allows, 1.27.0,
# not the latest patch), and the healthcheck stages were patch-pinned to
# golang:1.26.4-alpine. Nothing failed, so nobody noticed.
#
# Each TEST below builds a small fixture tree that is aligned except for ONE
# defect, and asserts the guard names it. TEST 1 is the baseline: the aligned
# fixture must pass, or every "it failed" below proves nothing. The last TEST
# runs the guard against the real tree.

set -euo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
GUARD="$HERE/check-go-version-alignment.sh"

if [[ ! -x "$GUARD" ]]; then
  echo "FAIL: $GUARD not executable or missing" >&2
  exit 1
fi

REPO_ROOT=$(git rev-parse --show-toplevel)

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

failures=0

# Build an ALIGNED fixture tree at $ROOT (fresh per test).
new_fixture() {
  ROOT="$WORK/root.$RANDOM$RANDOM"
  mkdir -p "$ROOT/pocketbase" "$ROOT/docker/healthcheck" "$ROOT/.github/workflows"
  printf 'module example.invalid/pb\n\ngo 1.27\n\nrequire (\n)\n' > "$ROOT/pocketbase/go.mod"
  printf 'module example.invalid/hc\n\ngo 1.27\n' > "$ROOT/docker/healthcheck/go.mod"
  printf 'go 1.27\n\nuse (\n\t./docker/healthcheck\n\t./pocketbase\n)\n' > "$ROOT/go.work"
  cat > "$ROOT/docker/Dockerfile.pocketbase" <<'EOF'
# go build in a comment must not count as a Go build stage
FROM --platform=linux/amd64 golang:1.27-alpine AS go-builder
ENV GOTOOLCHAIN=local
WORKDIR /build
RUN go mod download
RUN CGO_ENABLED=0 GOOS=linux \
    go build -o pocketbase .

FROM go-builder AS tests
RUN go test ./...

from golang:1.27-alpine as healthcheck-builder
RUN go build -o healthcheck .

FROM chainguard/static:latest
COPY --from=go-builder /build/pocketbase /usr/local/bin/pocketbase
EOF
  cat > "$ROOT/docker/Dockerfile.api" <<'EOF'
FROM chainguard/wolfi-base:latest
RUN apk add --no-cache python-3.14
EOF
  # Both accepted go-version forms: a job output (the normal case) and a step
  # output in the same job (for a job that cannot depend on detect-changes).
  # shellcheck disable=SC2016  # the literal ${{ ... }} IS the fixture
  cat > "$ROOT/.github/workflows/ci.yml" <<'EOF'
jobs:
  detect-changes:
    outputs:
      go_minor: ${{ steps.go.outputs.go_minor }}
    steps:
    - id: go
      run: echo "go_minor=$(sed -nE 's/^go ([0-9]+\.[0-9]+).*/\1/p' pocketbase/go.mod)" >> "$GITHUB_OUTPUT"
  go:
    needs: detect-changes
    steps:
    - uses: actions/setup-go@v7
      with:
        go-version: ${{ needs.detect-changes.outputs.go_minor }}
        check-latest: true
    - name: Setup Go
      uses: actions/setup-go@b7ad1dad31e06c5925ef5d2fc7ad053ef454303e # v7.0.0
      with:
        # a comment inside the step
        go-version: '${{ needs.detect-changes.outputs.go_minor }}'
        check-latest: 'true'
        cache: true
  standalone:
    steps:
    - id: go
      run: echo "go_minor=1.27" >> "$GITHUB_OUTPUT"
    - uses: actions/setup-go@v7
      with:
        go-version: ${{ steps.go.outputs.go_minor }}
        check-latest: true
EOF
}

# run_guard -- runs the guard on $ROOT without tripping `set -e`. Sets OUT/STATUS.
run_guard() {
  STATUS=0
  OUT=$("$GUARD" "$ROOT" 2>&1) || STATUS=$?
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

# expect_fail <label> <needle> -- the guard must exit 1 and print <needle>.
expect_fail() {
  local label="$1" needle="$2"
  run_guard
  if [[ $STATUS -eq 1 ]] && grep -qF -- "$needle" <<< "$OUT"; then
    check "$label" ok
  else
    check "$label (status=$STATUS, wanted 1 and '$needle') -- $OUT" no
  fi
}

# --- TEST 1: the aligned fixture passes (baseline) ---------------------------
new_fixture
run_guard
if [[ $STATUS -eq 0 ]]; then
  check "TEST 1: aligned fixture passes" ok
else
  check "TEST 1: aligned fixture passes (status=$STATUS) -- $OUT" no
fi

# --- TEST 2: a golang stage on a different minor -----------------------------
new_fixture
sed -i 's/^from golang:1.27-alpine/from golang:1.26-alpine/' "$ROOT/docker/Dockerfile.pocketbase"
expect_fail "TEST 2: golang:1.26-alpine against go.mod 1.27 fails" "golang:1.26-alpine"

# --- TEST 3: a patch-pinned tag (the golang:1.26.4-alpine shape) ------------
new_fixture
sed -i 's/^from golang:1.27-alpine/from golang:1.27.1-alpine/' "$ROOT/docker/Dockerfile.pocketbase"
expect_fail "TEST 3: patch-pinned golang:1.27.1-alpine fails" "golang:1.27.1-alpine"

# --- TEST 4: a non-official golang image (the dhi.io shape) -----------------
new_fixture
sed -i 's|golang:1.27-alpine AS go-builder|dhi.io/golang:1.27-dev AS go-builder|' "$ROOT/docker/Dockerfile.pocketbase"
expect_fail "TEST 4: dhi.io/golang:1.27-dev fails" "dhi.io/golang:1.27-dev"

# --- TEST 5: a Go build on a non-golang image, command on a continuation line
new_fixture
cat >> "$ROOT/docker/Dockerfile.api" <<'EOF'
FROM alpine:3.22 AS sneaky
RUN apk add --no-cache go && \
    go build -o x .
EOF
expect_fail "TEST 5: go build on alpine:3.22 fails" "alpine:3.22"

# --- TEST 6: ENV GOTOOLCHAIN=auto --------------------------------------------
new_fixture
sed -i 's/^ENV GOTOOLCHAIN=local/ENV GOTOOLCHAIN=auto/' "$ROOT/docker/Dockerfile.pocketbase"
expect_fail "TEST 6: ENV GOTOOLCHAIN=auto fails" "GOTOOLCHAIN"

# --- TEST 7: inline GOTOOLCHAIN=auto on a RUN --------------------------------
new_fixture
sed -i 's/^RUN go mod download/RUN GOTOOLCHAIN=auto go mod download/' "$ROOT/docker/Dockerfile.pocketbase"
expect_fail "TEST 7: inline GOTOOLCHAIN=auto fails" "GOTOOLCHAIN"

# --- TEST 8: space-form ENV with a pinned-download value ---------------------
new_fixture
sed -i 's/^ENV GOTOOLCHAIN=local/ENV GOTOOLCHAIN go1.27.0+auto/' "$ROOT/docker/Dockerfile.pocketbase"
expect_fail "TEST 8: ENV GOTOOLCHAIN go1.27.0+auto fails" "GOTOOLCHAIN"

# --- TEST 9: the healthcheck module on another minor (the go 1.24 shape) -----
new_fixture
sed -i 's/^go 1.27$/go 1.24/' "$ROOT/docker/healthcheck/go.mod"
expect_fail "TEST 9: docker/healthcheck/go.mod go 1.24 fails" "docker/healthcheck/go.mod"

# --- TEST 10: go.work on another minor ---------------------------------------
new_fixture
sed -i 's/^go 1.27$/go 1.28/' "$ROOT/go.work"
expect_fail "TEST 10: go.work go 1.28 fails" "go.work"

# --- TEST 11: a patch in a go line is fine; only the MINOR is compared --------
# The Go tool writes the patch itself: `go get` of a dependency declaring
# `go 1.27.0` rewrites `go 1.27` to `go 1.27.0`. Rejecting it would fail every
# Dependabot gomod PR once golang.org/x/* declare a patch. CI never installs the
# go line's patch -- setup-go gets the minor alone, with check-latest.
new_fixture
sed -i 's/^go 1.27$/go 1.27.0/' "$ROOT/pocketbase/go.mod" "$ROOT/go.work"
sed -i 's/^go 1.27$/go 1.27.3/' "$ROOT/docker/healthcheck/go.mod"
run_guard
if [[ $STATUS -eq 0 ]]; then
  check "TEST 11: go 1.27.0 / go 1.27.3 directives pass" ok
else
  check "TEST 11: go 1.27.0 / go 1.27.3 directives pass (status=$STATUS) -- $OUT" no
fi

# --- TEST 11b: a patch does not hide a different minor ------------------------
new_fixture
sed -i 's/^go 1.27$/go 1.26.9/' "$ROOT/docker/healthcheck/go.mod"
expect_fail "TEST 11b: docker/healthcheck/go.mod go 1.26.9 fails" "docker/healthcheck/go.mod"

# --- TEST 11c: a pre-release go line is not a minor --------------------------
new_fixture
sed -i 's/^go 1.27$/go 1.27rc1/' "$ROOT/go.work"
expect_fail "TEST 11c: go.work go 1.27rc1 fails" "go.work"

# --- TEST 12: a toolchain directive ------------------------------------------
new_fixture
printf '\ntoolchain go1.27.1\n' >> "$ROOT/pocketbase/go.mod"
expect_fail "TEST 12: toolchain directive fails" "toolchain"

# --- TEST 13: a literal go-version in a workflow -----------------------------
new_fixture
cat >> "$ROOT/.github/workflows/ci.yml" <<'EOF'
    - uses: actions/setup-go@v7
      with:
        go-version: '1.27.x'
        check-latest: true
EOF
expect_fail "TEST 13: literal go-version in a workflow fails" "1.27.x"

# --- TEST 13b: go-version reading some OTHER output ---------------------------
new_fixture
# shellcheck disable=SC2016  # the literal ${{ ... }} IS the fixture
sed -i 's/needs.detect-changes.outputs.go_minor }}$/needs.detect-changes.outputs.go }}/' "$ROOT/.github/workflows/ci.yml"
expect_fail "TEST 13b: go-version from outputs.go (not go_minor) fails" "outputs.go }}"

# --- TEST 14: go-version-file, even pointing at pocketbase/go.mod -------------
# It installs exactly the patch the go line carries (see TEST 11), not the
# latest one.
new_fixture
cat >> "$ROOT/.github/workflows/ci.yml" <<'EOF'
    - uses: actions/setup-go@v7
      with:
        go-version-file: pocketbase/go.mod
        check-latest: true
EOF
expect_fail "TEST 14: go-version-file: pocketbase/go.mod fails" "go-version-file"

# --- TEST 15: untagged, :latest, digest-pinned and ARG-templated images ------
# shellcheck disable=SC2016  # the literal ${GO_VERSION} IS the fixture
for image in 'golang' 'golang:latest' 'golang:1.27-alpine@sha256:0000000000000000000000000000000000000000000000000000000000000000' 'golang:${GO_VERSION}-alpine'; do
  new_fixture
  sed -i "s|^from golang:1.27-alpine|from $image|" "$ROOT/docker/Dockerfile.pocketbase"
  expect_fail "TEST 15: FROM $image fails" "$image"
done

# --- TEST 16: missing pocketbase/go.mod is a did-not-run (exit 2), not a pass
new_fixture
rm "$ROOT/pocketbase/go.mod"
run_guard
if [[ $STATUS -eq 2 ]]; then
  check "TEST 16: missing pocketbase/go.mod exits 2" ok
else
  check "TEST 16: missing pocketbase/go.mod exits 2 (status=$STATUS) -- $OUT" no
fi

# --- TEST 17: no Dockerfiles at all is a did-not-run (exit 2) ----------------
new_fixture
rm "$ROOT"/docker/Dockerfile.*
run_guard
if [[ $STATUS -eq 2 ]]; then
  check "TEST 17: no Dockerfiles exits 2" ok
else
  check "TEST 17: no Dockerfiles exits 2 (status=$STATUS) -- $OUT" no
fi

# --- TEST 18: a setup-go step without check-latest ---------------------------
# Without it setup-go takes whatever 1.27.x the runner image caches, which lags
# the latest patch.
new_fixture
cat >> "$ROOT/.github/workflows/ci.yml" <<'EOF'
    - uses: actions/setup-go@v7
      with:
        go-version: ${{ needs.detect-changes.outputs.go_minor }}
        cache: true
EOF
expect_fail "TEST 18: setup-go without check-latest fails" "check-latest"

# --- TEST 19: check-latest: false ---------------------------------------------
new_fixture
sed -i '0,/check-latest: true/s//check-latest: false/' "$ROOT/.github/workflows/ci.yml"
expect_fail "TEST 19: setup-go with check-latest: false fails" "check-latest"

# --- TEST 20: check-latest on the NEXT step does not count --------------------
# The last setup-go step in a job, followed by a step of another action that
# happens to take a check-latest input.
new_fixture
cat >> "$ROOT/.github/workflows/ci.yml" <<'EOF'
    - uses: actions/setup-go@v7
      with:
        go-version: ${{ needs.detect-changes.outputs.go_minor }}
    - uses: actions/setup-node@v7
      with:
        check-latest: true
EOF
expect_fail "TEST 20: check-latest on a following step does not satisfy setup-go" "check-latest"

# --- TEST 21: a setup-go step with no go-version at all -----------------------
# setup-go then uses the runner's preinstalled Go -- whatever minor that is.
new_fixture
cat >> "$ROOT/.github/workflows/ci.yml" <<'EOF'
  another-job:
    steps:
    - uses: actions/setup-go@v7
      with:
        check-latest: true
EOF
expect_fail "TEST 21: setup-go without go-version fails" "no go-version"

# --- TEST 22: the real tree is aligned ---------------------------------------
STATUS=0
OUT=$("$GUARD" "$REPO_ROOT" 2>&1) || STATUS=$?
if [[ $STATUS -eq 0 ]]; then
  check "TEST 22: the real tree passes" ok
else
  check "TEST 22: the real tree passes (status=$STATUS) -- $OUT" no
fi

echo
if [[ $failures -gt 0 ]]; then
  echo "$failures test(s) failed" >&2
  exit 1
fi
echo "All tests passed"
