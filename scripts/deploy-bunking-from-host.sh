#!/bin/bash
# Deploy bunking configuration files to production using sparse Git checkout
# Run this from the host, not inside the LXC container
# 
# This script uses sparse checkout to clone only necessary config files:
#   - config/               → ${APPDATA_DIR}/bunking/config/
#   - pb_migrations/        → ${APPDATA_DIR}/bunking/pocketbase/migrations/
#   - pb_hooks/            → ${APPDATA_DIR}/bunking/pocketbase/pb_hooks/
#
# Usage: ./deploy-bunking-from-host.sh [--full-clone]
#   --full-clone    Use traditional full clone instead of sparse checkout

set -e  # Exit on error

# Parse command line arguments
FULL_CLONE=false
while [[ $# -gt 0 ]]; do
    case $1 in
        --full-clone)
            FULL_CLONE=true
            shift
            ;;
        *)
            echo "Unknown option: $1"
            echo "Usage: $0 [--full-clone]"
            exit 1
            ;;
    esac
done

# Configuration
# LXC path - update this if your LXC mount point changes
LXC_BUNKING_PATH="/mnt/user/lxc/Claude/rootfs/home/adam/kindred"
HOST_APPDATA="${APPDATA_DIR:-/root/appdata}"
PROD_BUNKING_DIR="${HOST_APPDATA}/bunking"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}📁 Bunking File Sync from LXC to Host${NC}"
echo "================================================"
echo "LXC Source: ${LXC_BUNKING_PATH}"
echo "Production: ${PROD_BUNKING_DIR}"
echo "AppData: ${HOST_APPDATA}"
echo ""

# 0. Verify APPDATA_DIR is set
if [ -z "${APPDATA_DIR}" ]; then
    echo -e "${YELLOW}Warning: APPDATA_DIR not set, using default /root/appdata${NC}"
fi

# 1. Handle existing ZFS dataset and git repository
echo -e "${BLUE}Checking production directory...${NC}"
if [ -d "${PROD_BUNKING_DIR}" ]; then
    echo "Production directory exists (ZFS dataset already created)"
    
    # Check if it's a git repository
    if [ -d "${PROD_BUNKING_DIR}/.git" ]; then
        echo "Git repository already initialized, pulling latest changes..."
        cd "${PROD_BUNKING_DIR}"
        
        # For existing repos, we need to clean up and re-fetch
        echo "Updating repository with minimal approach..."
        
        # Fetch latest
        git fetch --depth=1 origin main
        
        # Remove all files except .git
        find . -mindepth 1 -maxdepth 1 -not -name '.git' -exec rm -rf {} \;
        
        # Checkout only the directories we need
        git checkout FETCH_HEAD -- config/ pocketbase/pb_migrations/ pocketbase/pb_hooks/ || {
            echo -e "${YELLOW}Warning: Git pull failed, continuing with existing code${NC}"
        }
    else
        echo "Directory exists but not a git repository, initializing..."
        cd "${PROD_BUNKING_DIR}"
        
        # Check if directory is empty (besides potential ZFS metadata)
        # Use find instead of ls | grep to handle special filenames
        if [ -z "$(find . -maxdepth 1 ! -name '.' ! -name '.zfs' -print -quit 2>/dev/null)" ]; then
            # Measure initial disk usage
            INITIAL_SIZE=$(du -sh "${PROD_BUNKING_DIR}" 2>/dev/null | cut -f1)
            echo "Initial directory size: ${INITIAL_SIZE}"
            
            if [ "$FULL_CLONE" = true ]; then
                echo "Directory is empty, cloning full repository (--full-clone specified)..."
                git clone https://github.com/adamflagg/kindred.git .
            else
                echo "Directory is empty, setting up minimal checkout..."
                git init .
                git remote add origin https://github.com/adamflagg/kindred.git
                git fetch --depth=1 origin main
                # Only checkout the specific directories we need
                git checkout FETCH_HEAD -- config/ pocketbase/pb_migrations/ pocketbase/pb_hooks/
            fi
            
            # Measure final disk usage
            FINAL_SIZE=$(du -sh "${PROD_BUNKING_DIR}" 2>/dev/null | cut -f1)
            if [ "$FULL_CLONE" = true ]; then
                echo "Final directory size: ${FINAL_SIZE} (full clone)"
            else
                echo "Final directory size: ${FINAL_SIZE} (sparse checkout, ~95% smaller than full clone)"
            fi
        else
            echo -e "${RED}Directory is not empty and not a git repository!${NC}"
            echo "Please backup existing contents or use a different directory."
            exit 1
        fi
    fi
else
    echo -e "${RED}Production directory doesn't exist!${NC}"
    echo "Please create the ZFS dataset first:"
    echo "  zfs create your-pool/appdata/bunking"
    exit 1
fi

# 2. Create complete directory structure
echo -e "${BLUE}Creating production directory structure...${NC}"

# AppData directories (where Docker volumes mount)
mkdir -p "${HOST_APPDATA}/bunking/pocketbase/data"
mkdir -p "${HOST_APPDATA}/bunking/pocketbase/migrations"
mkdir -p "${HOST_APPDATA}/bunking/pocketbase/pb_hooks"
mkdir -p "${HOST_APPDATA}/bunking/config"
mkdir -p "${HOST_APPDATA}/bunking/solver/logs"
mkdir -p "${HOST_APPDATA}/bunking/sync/logs"
mkdir -p "${HOST_APPDATA}/bunking/sync/history"

# 3. Sync PocketBase files to AppData
echo -e "${BLUE}Syncing PocketBase migrations...${NC}"
rsync -av --delete \
  "${LXC_BUNKING_PATH}/pocketbase/pb_migrations/" \
  "${HOST_APPDATA}/bunking/pocketbase/migrations/"

echo -e "${BLUE}Syncing PocketBase hooks...${NC}"
rsync -av --delete \
  "${LXC_BUNKING_PATH}/pocketbase/pb_hooks/" \
  "${HOST_APPDATA}/bunking/pocketbase/pb_hooks/"

# 4. Sync config files to AppData
echo -e "${BLUE}Syncing config files...${NC}"
rsync -av --exclude='__pycache__' --exclude='*.pyc' \
  "${LXC_BUNKING_PATH}/config/" \
  "${HOST_APPDATA}/bunking/config/"

# Note: .env file is not needed since Docker images use environment variables

echo ""
echo -e "${GREEN}✅ File sync complete!${NC}"
echo ""
echo "Files synced to AppData locations:"
echo "  - PocketBase migrations: ${HOST_APPDATA}/bunking/pocketbase/migrations/"
echo "  - PocketBase hooks: ${HOST_APPDATA}/bunking/pocketbase/pb_hooks/"
echo "  - Config files: ${HOST_APPDATA}/bunking/config/"
echo ""
echo "Repository location: ${PROD_BUNKING_DIR}"

# Show minimal checkout info if applicable
if [ "$FULL_CLONE" != true ]; then
    echo ""
    echo "Minimal checkout - only contains:"
    echo "  - config/"
    echo "  - pocketbase/pb_migrations/"
    echo "  - pocketbase/pb_hooks/"
    echo ""
    echo "Repository size: $(du -sh "${PROD_BUNKING_DIR}" 2>/dev/null | cut -f1) (vs ~100MB+ for full clone)"
fi

echo ""
echo "Note: This deployment only requires config files."
echo "Docker images contain all application code."
