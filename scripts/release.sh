#!/bin/bash
# Release orchestration script for kindred project
# Uses git-cliff for changelog generation and semver recommendations

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_ROOT"

# Parse args
DRY_RUN=false
SKIP_TESTS=false
GITHUB_BUILD=true  # Default to GitHub Actions for public repo
CUSTOM_VERSION=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --dry-run) DRY_RUN=true; shift ;;
        --skip-tests) SKIP_TESTS=true; shift ;;
        --github-build) GITHUB_BUILD=true; shift ;;
        --local-build) GITHUB_BUILD=false; shift ;;
        --version) CUSTOM_VERSION="$2"; shift 2 ;;
        -h|--help)
            echo "Usage: $0 [options]"
            echo "Options:"
            echo "  --dry-run       Preview release without creating tag"
            echo "  --skip-tests    Skip test suite (not recommended)"
            echo "  --github-build  Build via GitHub Actions CD (default for public repo)"
            echo "  --local-build   Build locally instead of via GitHub Actions"
            echo "  --version X     Override git-cliff version suggestion"
            exit 0
            ;;
        *) echo "Unknown option: $1"; exit 1 ;;
    esac
done

echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}                    KINDRED RELEASE                        ${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"

# ===== SETUP GIT-CLIFF =====
# Get GitHub token from gh CLI for git-cliff GitHub integration
# Required for fetching PR metadata and author attribution
setup_github_token() {
    if ! command -v gh &> /dev/null; then
        echo -e "${YELLOW}⚠ gh CLI not found - GitHub metadata disabled${NC}"
        return 1
    fi

    if ! gh auth status &> /dev/null; then
        echo -e "${YELLOW}⚠ gh not authenticated - GitHub metadata disabled${NC}"
        return 1
    fi

    local token
    token="$(gh auth token 2>/dev/null)"
    if [[ -z "$token" ]]; then
        echo -e "${YELLOW}⚠ gh auth token returned empty - GitHub metadata disabled${NC}"
        return 1
    fi

    # Validate token actually works with GitHub API
    local rate_check
    rate_check=$(curl -sf -H "Authorization: Bearer $token" \
        "https://api.github.com/rate_limit" 2>/dev/null)
    if [[ -z "$rate_check" ]]; then
        echo -e "${YELLOW}⚠ GitHub token validation failed - GitHub metadata disabled${NC}"
        return 1
    fi

    # Check we have remaining API calls
    local remaining
    remaining=$(echo "$rate_check" | grep -o '"remaining": *[0-9]*' | head -1 | sed 's/[^0-9]//g')
    if [[ -n "$remaining" && "$remaining" -lt 10 ]]; then
        echo -e "${YELLOW}⚠ GitHub API rate limit low ($remaining remaining) - GitHub metadata disabled${NC}"
        return 1
    fi

    export GITHUB_TOKEN="$token"
    echo -e "${GREEN}✓ GitHub token configured (API calls remaining: $remaining)${NC}"
    return 0
}

setup_github_token

# Helper function to run git-cliff via npx
git_cliff() {
    if [[ -z "$GITHUB_TOKEN" ]]; then
        echo -e "${YELLOW}⚠ Running git-cliff without GitHub token${NC}" >&2
    fi
    # Pass token explicitly to ensure npx subprocess receives it
    # RUST_LOG=error suppresses WARN about non-conventional commits (merge commits, etc.)
    # These warnings get interleaved without newlines when piped, breaking grep filtering
    RUST_LOG=error GITHUB_TOKEN="$GITHUB_TOKEN" npx git-cliff@latest "$@" 2>&1
}

# ===== PRE-RELEASE CHECKS =====
echo -e "\n${YELLOW}▶ Pre-release checks...${NC}"

# Check gh CLI installed and authenticated
if ! command -v gh &> /dev/null; then
    echo -e "${RED}✗ gh CLI not installed${NC}"
    exit 1
fi
if ! gh auth status &> /dev/null; then
    echo -e "${RED}✗ Not authenticated with GitHub (run: gh auth login)${NC}"
    exit 1
fi
echo -e "${GREEN}✓ GitHub CLI authenticated${NC}"

# Check clean working tree
if [[ -n $(git status --porcelain) ]]; then
    echo -e "${RED}✗ Working tree not clean${NC}"
    git status --short
    exit 1
fi
echo -e "${GREEN}✓ Working tree clean${NC}"

# Check on main branch (handle both "main" and "heads/main" formats)
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [[ "$CURRENT_BRANCH" != "main" && "$CURRENT_BRANCH" != "heads/main" ]]; then
    echo -e "${RED}✗ Not on main branch (on: $CURRENT_BRANCH)${NC}"
    exit 1
fi
echo -e "${GREEN}✓ On main branch${NC}"

# Check up to date with remote
git fetch origin main --quiet
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)
if [[ "$LOCAL" != "$REMOTE" ]]; then
    echo -e "${RED}✗ Local main differs from origin/main${NC}"
    echo "  Run: git pull origin main"
    exit 1
fi
echo -e "${GREEN}✓ In sync with origin/main${NC}"

# Check if CI and docs checks have passed for the current commit
echo -e "\n${YELLOW}▶ Checking CI status...${NC}"

# Export repo for gh API
export GITHUB_REPOSITORY="${GITHUB_REPOSITORY:-adamflagg/kindred}"

get_check_status() {
    local sha="$1"
    local check_name="$2"
    gh api "repos/$GITHUB_REPOSITORY/commits/$sha/check-runs" \
        --jq ".check_runs[] | select(.name == \"$check_name\") | {status: .status, conclusion: .conclusion}" 2>/dev/null || echo ""
}

# Check CI Summary
CI_RUNS=$(get_check_status "$LOCAL" "CI Summary")
CI_SUCCESS=$(echo "$CI_RUNS" | jq -s '[.[] | select(.status == "completed" and .conclusion == "success")] | length' 2>/dev/null || echo "0")

# Check Documentation Linting (if present)
DOCS_RUNS=$(get_check_status "$LOCAL" "Documentation Linting")
DOCS_COUNT=$(echo "$DOCS_RUNS" | jq -s 'length' 2>/dev/null || echo "0")
DOCS_SUCCESS=$(echo "$DOCS_RUNS" | jq -s '[.[] | select(.status == "completed" and .conclusion == "success")] | length' 2>/dev/null || echo "0")

CHECKS_PASSED=true

if [ "$CI_SUCCESS" -eq 0 ]; then
    echo -e "${YELLOW}⚠ No successful CI runs found for current commit${NC}"
    CHECKS_PASSED=false
else
    echo -e "${GREEN}✓ CI Summary passed${NC}"
fi

if [ "$DOCS_COUNT" -gt 0 ]; then
    if [ "$DOCS_SUCCESS" -eq 0 ]; then
        echo -e "${YELLOW}⚠ Documentation Linting did not pass${NC}"
        CHECKS_PASSED=false
    else
        echo -e "${GREEN}✓ Documentation Linting passed${NC}"
    fi
fi

if [ "$CHECKS_PASSED" = "false" ]; then
    echo "  This may cause CD to fail when the tag is pushed."
    echo "  Consider:"
    echo "    1. Waiting for checks to complete on main"
    echo "    2. Using --skip-tests if you're confident"
    read -p "Continue anyway? [y/N] " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Run tests (unless skipped)
if [[ "$SKIP_TESTS" == "false" ]]; then
    echo -e "\n${YELLOW}▶ Running quick checks...${NC}"
    if ./scripts/ci/quick_check.sh; then
        echo -e "${GREEN}✓ All checks passed${NC}"
    else
        echo -e "${RED}✗ Checks failed${NC}"
        exit 1
    fi
else
    echo -e "${YELLOW}⚠ Skipping tests (--skip-tests)${NC}"
fi

# ===== VERSION CALCULATION =====
echo -e "\n${YELLOW}▶ Calculating version...${NC}"

if git describe --tags --abbrev=0 &>/dev/null; then
    LAST_TAG=$(git describe --tags --abbrev=0)
    FIRST_RELEASE=false
    echo "  Last tag: $LAST_TAG"
else
    # First release - use root commit as starting point for ranges
    LAST_TAG=$(git rev-list --max-parents=0 HEAD | head -1)
    FIRST_RELEASE=true
    echo "  No previous tags (first release)"
fi

# Check for release-worthy commits (feat, fix, perf trigger releases; docs, test, refactor, style don't)
RELEASE_COMMITS=$(git log "$LAST_TAG"..HEAD --oneline | grep -E '^[a-f0-9]+ (feat|fix|perf)(\(.+\))?(!)?:' || true)
if [[ -z "$RELEASE_COMMITS" && -z "$CUSTOM_VERSION" ]]; then
    echo -e "\n${YELLOW}⚠ No release-worthy commits since $LAST_TAG${NC}"
    echo "  Only docs/test/refactor/style/chore/ci commits found."
    echo "  These don't warrant a version bump."
    echo ""
    echo "  Commits since $LAST_TAG:"
    git log "$LAST_TAG"..HEAD --oneline | head -10
    echo ""
    if [[ "$DRY_RUN" == "true" ]]; then
        echo -e "${CYAN}DRY RUN: No release needed${NC}"
        exit 0
    fi
    echo "  Use --version to force a release if needed."
    exit 0
fi

if [[ -n "$CUSTOM_VERSION" ]]; then
    # Ensure 'v' prefix for custom version
    if [[ "$CUSTOM_VERSION" != v* ]]; then
        NEW_VERSION="v$CUSTOM_VERSION"
    else
        NEW_VERSION="$CUSTOM_VERSION"
    fi
    echo "  Custom version: $NEW_VERSION"
else
    # git-cliff --bumped-version returns version without 'v' prefix
    SUGGESTED=$(git_cliff --bumped-version | grep -E '^v?[0-9]+\.[0-9]+\.[0-9]+' | head -1 || echo "0.1.0")
    # Ensure 'v' prefix
    if [[ "$SUGGESTED" != v* ]]; then
        NEW_VERSION="v$SUGGESTED"
    else
        NEW_VERSION="$SUGGESTED"
    fi
    echo "  Suggested by git-cliff: $NEW_VERSION"
fi

# Check if tag exists
if git rev-parse "$NEW_VERSION" &>/dev/null; then
    echo -e "${RED}✗ Tag $NEW_VERSION already exists${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Version $NEW_VERSION available${NC}"

# ===== CHANGELOG PREVIEW =====
echo -e "\n${YELLOW}▶ Release notes preview:${NC}"
echo "─────────────────────────────────────────────────"
git_cliff --unreleased --strip header || echo "(no conventional commits)"
echo "─────────────────────────────────────────────────"

# ===== CHANGES SUMMARY =====
echo -e "\n${YELLOW}▶ Changes since $LAST_TAG:${NC}"
git log "$LAST_TAG"..HEAD --oneline | head -20
COMMIT_COUNT=$(git rev-list "$LAST_TAG"..HEAD --count)
echo "  Total: $COMMIT_COUNT commits"

# ===== LOCAL DOCKER BUILD (default) =====
if [[ "$GITHUB_BUILD" != "true" ]]; then
    echo -e "\n${YELLOW}▶ Building and pushing Docker image locally...${NC}"
    ./scripts/docker/build_and_push.sh "$NEW_VERSION"
    echo -e "${GREEN}✓ Local build and push successful${NC}"
fi

# ===== DRY RUN EXIT =====
if [[ "$DRY_RUN" == "true" ]]; then
    echo -e "\n${CYAN}═══════════════════════════════════════════════════════════${NC}"
    echo -e "${YELLOW}DRY RUN COMPLETE${NC}"
    echo -e "  Would create tag: $NEW_VERSION"
    if [[ "$GITHUB_BUILD" != "true" ]]; then
        echo -e "  Build mode: Local (default)"
    else
        echo -e "  Build mode: GitHub Actions CD"
    fi
    echo -e "  To release: $0"
    echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
    exit 0
fi

# ===== CONFIRMATION =====
echo -e "\n${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo -e "${YELLOW}Ready to release $NEW_VERSION${NC}"
echo -e "This will:"
if [[ "$GITHUB_BUILD" != "true" ]]; then
    echo -e "  1. Build and push Docker image locally"
    echo -e "  2. Create tag $NEW_VERSION"
    echo -e "  3. Push tag to GitHub"
    echo -e "  4. Create GitHub release with notes"
    echo -e "  (CD workflow will run but skip build - image already pushed)"
else
    echo -e "  1. Create tag $NEW_VERSION"
    echo -e "  2. Push tag to GitHub"
    echo -e "  3. Trigger CD workflow (~15 min)"
    echo -e "  4. Build & push Docker images via GitHub Actions"
    echo -e "  5. Create GitHub release with notes"
fi
echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
read -p "Proceed? [y/N] " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 0
fi

# ===== CREATE RELEASE =====
echo -e "\n${YELLOW}▶ Creating release...${NC}"

# Generate changelog for release notes
CHANGELOG=$(git_cliff --unreleased --strip header || true)

# Check if git-cliff output is valid (contains actual content)
if [[ -z "$CHANGELOG" ]] || echo "$CHANGELOG" | grep -q "panicked\|Error\|error"; then
    echo -e "${YELLOW}  git-cliff failed, generating formatted notes from commits...${NC}"
    # Fallback: generate notes matching git-cliff format (without PR/author attribution)
    # Format: * FULL_HASH: type(scope): message

    # Collect commits by type
    FIXES=""
    FEATURES=""
    PERF=""
    REFACTOR=""
    DOCS=""
    STYLE=""
    TESTS=""
    BUILD=""
    CONFIG=""
    OTHER=""

    while IFS= read -r line; do
        HASH=$(echo "$line" | awk '{print $1}')
        MSG=$(echo "$line" | cut -d' ' -f2-)
        ENTRY="* ${HASH}: ${MSG}"

        # Extract type from conventional commit
        TYPE=$(echo "$MSG" | sed -n 's/^\([a-z]*\).*/\1/p')

        case "$TYPE" in
            fix) FIXES="${FIXES}${ENTRY}"$'\n' ;;
            feat) FEATURES="${FEATURES}${ENTRY}"$'\n' ;;
            perf) PERF="${PERF}${ENTRY}"$'\n' ;;
            refactor) REFACTOR="${REFACTOR}${ENTRY}"$'\n' ;;
            docs) DOCS="${DOCS}${ENTRY}"$'\n' ;;
            style) STYLE="${STYLE}${ENTRY}"$'\n' ;;
            test) TESTS="${TESTS}${ENTRY}"$'\n' ;;
            build) BUILD="${BUILD}${ENTRY}"$'\n' ;;
            config) CONFIG="${CONFIG}${ENTRY}"$'\n' ;;
            chore|ci) ;; # Skip chore and ci commits
            *) OTHER="${OTHER}${ENTRY}"$'\n' ;;
        esac
    done < <(git log "$LAST_TAG"..HEAD --pretty=format:"%H %s")

    # Build changelog matching git-cliff section order
    CHANGELOG=""
    [[ -n "$FEATURES" ]] && CHANGELOG="${CHANGELOG}### Features"$'\n'"${FEATURES}"$'\n'
    [[ -n "$FIXES" ]] && CHANGELOG="${CHANGELOG}### Bug Fixes"$'\n'"${FIXES}"$'\n'
    [[ -n "$PERF" ]] && CHANGELOG="${CHANGELOG}### Performance"$'\n'"${PERF}"$'\n'
    [[ -n "$REFACTOR" ]] && CHANGELOG="${CHANGELOG}### Refactoring"$'\n'"${REFACTOR}"$'\n'
    [[ -n "$DOCS" ]] && CHANGELOG="${CHANGELOG}### Documentation"$'\n'"${DOCS}"$'\n'
    [[ -n "$STYLE" ]] && CHANGELOG="${CHANGELOG}### Styling"$'\n'"${STYLE}"$'\n'
    [[ -n "$TESTS" ]] && CHANGELOG="${CHANGELOG}### Testing"$'\n'"${TESTS}"$'\n'
    [[ -n "$BUILD" ]] && CHANGELOG="${CHANGELOG}### Build"$'\n'"${BUILD}"$'\n'
    [[ -n "$CONFIG" ]] && CHANGELOG="${CHANGELOG}### Configuration"$'\n'"${CONFIG}"$'\n'
    [[ -n "$OTHER" ]] && CHANGELOG="${CHANGELOG}### Other"$'\n'"${OTHER}"$'\n'

    # Trim trailing newlines
    CHANGELOG="${CHANGELOG%$'\n'}"
fi

# Create annotated tag with changelog
git tag -a "$NEW_VERSION" -m "$CHANGELOG"
echo -e "${GREEN}✓ Created tag $NEW_VERSION${NC}"

# Push tag
git push origin "$NEW_VERSION"
echo -e "${GREEN}✓ Pushed tag to origin${NC}"

# Create GitHub release with release notes
echo -e "\n${YELLOW}▶ Creating GitHub release...${NC}"
gh release create "$NEW_VERSION" --title "$NEW_VERSION" --notes "$CHANGELOG"
echo -e "${GREEN}✓ Created GitHub release${NC}"

# ===== POST-RELEASE INFO =====
# Docker tags: patch (0.7.0), minor (0.7), and latest
NEW_DOCKER_TAG=${NEW_VERSION#v}
NEW_DOCKER_MINOR=$(echo "$NEW_DOCKER_TAG" | cut -d. -f1-2)

echo -e "\n${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}RELEASE $NEW_VERSION INITIATED${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo -e "\n${YELLOW}Docker tags created:${NC}"
echo "  - ghcr.io/adamflagg/kindred:$NEW_DOCKER_TAG (patch)"
echo "  - ghcr.io/adamflagg/kindred:$NEW_DOCKER_MINOR (minor)"
echo "  - ghcr.io/adamflagg/kindred:latest"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo "  1. Monitor CD: https://github.com/adamflagg/kindred/actions"
echo "  2. After CD completes (~15 min), deploy:"
echo "     docker compose pull && docker compose up -d"
echo "  3. Verify: https://github.com/adamflagg/kindred/releases/tag/$NEW_VERSION"
if [[ "$FIRST_RELEASE" != "true" ]]; then
    LAST_DOCKER_TAG=${LAST_TAG#v}
    echo ""
    echo -e "${YELLOW}Rollback if needed:${NC}"
    echo "  docker compose pull ghcr.io/adamflagg/kindred:$LAST_DOCKER_TAG"
    echo "  docker compose up -d"
fi
