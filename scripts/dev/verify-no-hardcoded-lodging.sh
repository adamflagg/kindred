#!/usr/bin/env bash
# Spec 3.8: the lodging registry is DATA, not code. Unit and alias lists may
# exist only in seed migrations. This guard fails if a unit name leaks into
# application source.
set -euo pipefail
REPO_ROOT=$(git rev-parse --show-toplevel)
cd "$REPO_ROOT"

# Distinctive unit strings that must never appear outside seed migrations.
NEEDLES='Ridge Yurt|Tawonga Village|Manzanita|Tuolumne|Clouds Rest|Wawona|Half Dome|El Cap'

HITS=$(grep -rInE "$NEEDLES" \
  --include='*.go' --include='*.py' --include='*.ts' --include='*.tsx' \
  pocketbase/ api/ bunking/ frontend/src/ 2>/dev/null \
  | grep -v '_test\.\|\.test\.\|/tests\?/' \
  | grep -v 'frontend/src/data/cityGeo\.ts\|frontend/src/data/schoolGeo\.ts' || true)
# cityGeo.ts / schoolGeo.ts are unrelated city/school geocoding lookup tables
# (a different feature) that coincidentally contain place-name substrings
# ("Manzanita, OR", "El Capitan, AZ", "Wawona, CA", "Tuolumne City, CA") — not
# the lodging registry. Excluded to keep this guard meaningful.

if [[ -n "$HITS" ]]; then
  echo "FAIL: lodging unit names found in application source (spec 3.8 — registry is data, not code):" >&2
  echo "$HITS" >&2
  exit 1
fi
echo "verify-no-hardcoded-lodging: OK"
