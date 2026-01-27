#!/bin/bash
# Build Docker image locally, handling symlinks to kindred-local
#
# This script:
# 1. Resolves symlinks or creates placeholders for Docker build context
# 2. Runs the Docker build
# 3. Restores symlinks via setup-local-config.sh
#
# Usage: ./scripts/build/docker-build.sh [docker build args...]
#
# Examples:
#   ./scripts/build/docker-build.sh -t kindred:local .
#   ./scripts/build/docker-build.sh --no-cache -t kindred:test .

set -e
cd "$(dirname "$0")/../.."

# Cleanup function to restore symlinks (runs on exit, success or failure)
cleanup() {
  echo ""
  echo "Restoring symlinks..."
  ./scripts/setup/setup-local-config.sh
}
trap cleanup EXIT

echo "Preparing Docker build context..."

# Handle local/ directory (symlink or missing)
if [ -L "local" ]; then
  target=$(readlink -f "local" 2>/dev/null || echo "")
  if [ -d "$target" ]; then
    echo "  Copying local/ from kindred-local..."
    rm "local"
    cp -r "$target" "local"
  else
    echo "  Creating empty local/assets/ (kindred-local not available)"
    rm "local"
    mkdir -p "local/assets"
  fi
elif [ ! -d "local" ]; then
  echo "  Creating empty local/assets/"
  mkdir -p "local/assets"
fi

# Handle config file symlinks
for f in config/branding.local.json config/staff_list.json; do
  if [ -L "$f" ]; then
    target=$(readlink -f "$f" 2>/dev/null || echo "")
    if [ -f "$target" ]; then
      echo "  Copying $f from kindred-local..."
      rm "$f"
      cp "$target" "$f"
    else
      echo "  Removing dangling symlink: $f"
      rm "$f"
    fi
  fi
done

echo "Docker build context ready!"
echo ""

# Run Docker build with provided arguments (or defaults)
if [ $# -eq 0 ]; then
  echo "Running: docker build -t kindred:local ."
  docker build -t kindred:local .
else
  echo "Running: docker build $*"
  docker build "$@"
fi

echo ""
echo "Build complete!"
# Cleanup runs automatically via trap
