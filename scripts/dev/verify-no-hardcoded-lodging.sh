#!/usr/bin/env bash
# Spec 3.8: the lodging registry is DATA, not code. Unit and alias lists may
# exist only in seed migrations.
#
# SCOPE, honestly stated: this is a tripwire, not a proof. It greps for a
# REPRESENTATIVE SAMPLE of distinctive unit strings (NEEDLES below) — not the
# full ~90-unit registry, which would be both unmaintainable and prone to
# false positives on ordinary words ("Ridge A", "Kitty"). A leak of a unit name
# that is not in NEEDLES will pass. Treat a green run as "the obvious cases are
# clean", not "no unit name exists in source".
set -euo pipefail

# Preflight BEFORE the first git call — checking for git after invoking it is
# pointless, since the missing binary would already have exited 127.
for cmd in git grep python3; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "error: required command '$cmd' not found" >&2; exit 2; }
done

REPO_ROOT=$(git rev-parse --show-toplevel)
cd "$REPO_ROOT"

# Distinctive unit strings that must never appear outside seed migrations.
# Double-quoted so "Doctor's House" can carry its apostrophe.
# "Cloud'?s Rest" matches both spellings on purpose: the canonical unit name is
# "Clouds Rest" (1500000120) but every historical alias string is "Cloud's Rest"
# with the apostrophe (1500000121), and a leak could copy either.
NEEDLES="Ridge Yurt|Tawonga Village|Manzanita|Tuolumne|Cloud'?s Rest|Wawona|Half Dome|El Cap|Bayit|Tenaya|Tioga|Le Shack|Lofty|Kitty|Doctor's House"

# --include='*.js' matters: pocketbase/pb_hooks/ is application JavaScript and
# would otherwise go unscanned entirely. But scanning .js drags in two kinds of
# legitimate non-source noise, both excluded by directory rather than by file:
#   pb_migrations/ — where the registry data is SUPPOSED to live (spec 3.8)
#   pb_public/     — gitignored build output; the minified frontend bundle
#                    embeds the same city/school geo tables and matches
#                    "Kitty"/"Tioga" as ordinary US place names
HITS=$(grep -rInE "$NEEDLES" \
  --include='*.go' --include='*.py' --include='*.ts' --include='*.tsx' --include='*.js' \
  --exclude-dir=pb_migrations --exclude-dir=pb_public --exclude-dir=node_modules \
  pocketbase/ api/ bunking/ frontend/src/ 2>/dev/null \
  | grep -v '_test\.\|\.test\.\|/tests\?/' \
  | grep -v 'frontend/src/data/cityGeo\.ts\|frontend/src/data/schoolGeo\.ts' || true)

# Prose that names a unit to explain a rule is documentation, not the registry
# living in code. Dropping comment and docstring hits is what makes this guard
# green on a clean `main`: it failed on a docstring in lodging_rules.py, which
# opened Phase C on a red that was not Phase C's (kindred#1891). A file that
# cannot be parsed is treated as all code, so its hits survive.
if [[ -n "$HITS" ]]; then
  HITS=$(printf '%s\n' "$HITS" | python3 "$REPO_ROOT/scripts/dev/lib/drop_comment_hits.py")
fi
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
