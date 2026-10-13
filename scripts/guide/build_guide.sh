#!/usr/bin/env bash
# scripts/guide/build_guide.sh <guide_dir> <facts_json>
# Builds the private guide against this tree's facts. CI logs here are PUBLIC:
# every byte of build output goes to a private log; stdout gets one line.
set -uo pipefail
guide="${1:?guide dir}"; facts="${2:?facts.json}"
log="${RUNNER_TEMP:-/tmp}/guide-build.log"
cp "$facts" "$guide/src/data/facts.json"
cmd="${GUIDE_BUILD_CMD:-npm ci --no-audit --no-fund && npm run build}"
if (cd "$guide" && bash -c "$cmd") >"$log" 2>&1; then
  echo "guide: pass"; exit 0
fi
n="$(grep -ci 'error' "$log" || true)"; [ "${n:-0}" -ge 1 ] || n=1
echo "guide: ${n} errors"; exit 1
