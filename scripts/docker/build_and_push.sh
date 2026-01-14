#!/bin/bash
# Build and push Docker images to GitHub Container Registry
# Architecture: Single combined image (Caddy + PocketBase + FastAPI)

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
REGISTRY="ghcr.io"
USERNAME="adamflagg"
BUILD_ONLY=false
IMAGE_TAG=""

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --build-only) BUILD_ONLY=true; shift ;;
        -h|--help)
            echo "Usage: $0 [options] [tag]"
            echo "Options:"
            echo "  --build-only  Build images without pushing"
            echo "  tag           Image tag - supports:"
            echo "                  - semver: v0.7.0 (creates 0.7.0, 0.7, latest)"
            echo "                  - date: YYYY.MM.DD (default if no tag provided)"
            echo "                  - any: custom tag string"
            exit 0
            ;;
        *) IMAGE_TAG="$1"; shift ;;
    esac
done

# Default tag if not provided
IMAGE_TAG="${IMAGE_TAG:-$(date +%Y.%m.%d)}"

# Handle semver tags (v0.7.0 -> 0.7.0)
DOCKER_TAG="$IMAGE_TAG"
MINOR_TAG=""
MAJOR_TAG=""
if [[ "$IMAGE_TAG" =~ ^v?[0-9]+\.[0-9]+\.[0-9]+ ]]; then
    # Strip v prefix for Docker tag
    DOCKER_TAG="${IMAGE_TAG#v}"
    # Extract minor version (1.1 from 1.1.1)
    MINOR_TAG=$(echo "$DOCKER_TAG" | cut -d. -f1-2)
    # Extract major version (1 from 1.1.1)
    MAJOR_TAG=$(echo "$DOCKER_TAG" | cut -d. -f1)
fi

if [[ "$BUILD_ONLY" == "true" ]]; then
    echo -e "${BLUE}Building Docker image (build-only mode)${NC}"
else
    echo -e "${BLUE}Building and pushing Docker image${NC}"
fi
echo "Registry: $REGISTRY/$USERNAME"
echo "Tag: $DOCKER_TAG"
if [[ -n "$MINOR_TAG" && "$MINOR_TAG" != "$DOCKER_TAG" ]]; then
    echo "Minor tag: $MINOR_TAG"
fi
if [[ -n "$MAJOR_TAG" && "$MAJOR_TAG" != "$MINOR_TAG" ]]; then
    echo "Major tag: $MAJOR_TAG"
fi
echo ""

# Check if logged in to GitHub Container Registry (only if pushing)
if [[ "$BUILD_ONLY" != "true" ]]; then
    echo -n "Checking Docker registry login... "
    if ! docker pull $REGISTRY/$USERNAME/kindred:latest >/dev/null 2>&1; then
        echo -e "${YELLOW}Not logged in, authenticating via gh...${NC}"
        if ! gh auth token | docker login $REGISTRY -u $USERNAME --password-stdin; then
            echo -e "${RED}Failed to authenticate with GitHub Container Registry${NC}"
            exit 1
        fi
        echo -e "${GREEN}Authenticated${NC}"
    else
        echo -e "${GREEN}OK${NC}"
    fi
fi

# Build combined image (Caddy + PocketBase + FastAPI + frontend)
echo ""
echo -e "${BLUE}Building kindred image (Caddy + PocketBase + FastAPI + frontend)...${NC}"
docker build -f Dockerfile -t "$REGISTRY/$USERNAME/kindred:$DOCKER_TAG" .
docker tag "$REGISTRY/$USERNAME/kindred:$DOCKER_TAG" "$REGISTRY/$USERNAME/kindred:latest"

# Add minor version tag if semver
if [[ -n "$MINOR_TAG" && "$MINOR_TAG" != "$DOCKER_TAG" ]]; then
    docker tag "$REGISTRY/$USERNAME/kindred:$DOCKER_TAG" "$REGISTRY/$USERNAME/kindred:$MINOR_TAG"
fi

# Add major version tag if semver
if [[ -n "$MAJOR_TAG" && "$MAJOR_TAG" != "$MINOR_TAG" ]]; then
    docker tag "$REGISTRY/$USERNAME/kindred:$DOCKER_TAG" "$REGISTRY/$USERNAME/kindred:$MAJOR_TAG"
fi

# Push images (unless --build-only)
if [[ "$BUILD_ONLY" == "true" ]]; then
    echo ""
    echo -e "${GREEN}Successfully built image (skipping push)${NC}"
    echo ""
    echo "Built images:"
    echo "  - $REGISTRY/$USERNAME/kindred:$DOCKER_TAG"
    if [[ -n "$MINOR_TAG" && "$MINOR_TAG" != "$DOCKER_TAG" ]]; then
        echo "  - $REGISTRY/$USERNAME/kindred:$MINOR_TAG"
    fi
    if [[ -n "$MAJOR_TAG" && "$MAJOR_TAG" != "$MINOR_TAG" ]]; then
        echo "  - $REGISTRY/$USERNAME/kindred:$MAJOR_TAG"
    fi
    echo "  - $REGISTRY/$USERNAME/kindred:latest"
else
    echo ""
    echo -e "${BLUE}Pushing images to registry...${NC}"

    echo "Pushing kindred:$DOCKER_TAG..."
    docker push "$REGISTRY/$USERNAME/kindred:$DOCKER_TAG"

    if [[ -n "$MINOR_TAG" && "$MINOR_TAG" != "$DOCKER_TAG" ]]; then
        echo "Pushing kindred:$MINOR_TAG..."
        docker push "$REGISTRY/$USERNAME/kindred:$MINOR_TAG"
    fi

    if [[ -n "$MAJOR_TAG" && "$MAJOR_TAG" != "$MINOR_TAG" ]]; then
        echo "Pushing kindred:$MAJOR_TAG..."
        docker push "$REGISTRY/$USERNAME/kindred:$MAJOR_TAG"
    fi

    echo "Pushing kindred:latest..."
    docker push "$REGISTRY/$USERNAME/kindred:latest"

    echo ""
    echo -e "${GREEN}Successfully built and pushed image!${NC}"
    echo ""
    echo "Tagged images:"
    echo "  - $REGISTRY/$USERNAME/kindred:$DOCKER_TAG"
    if [[ -n "$MINOR_TAG" && "$MINOR_TAG" != "$DOCKER_TAG" ]]; then
        echo "  - $REGISTRY/$USERNAME/kindred:$MINOR_TAG"
    fi
    if [[ -n "$MAJOR_TAG" && "$MAJOR_TAG" != "$MINOR_TAG" ]]; then
        echo "  - $REGISTRY/$USERNAME/kindred:$MAJOR_TAG"
    fi
    echo "  - $REGISTRY/$USERNAME/kindred:latest"
fi
