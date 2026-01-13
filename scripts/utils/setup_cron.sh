#!/bin/bash
# Setup cron jobs for sync schedules

# Get project root relative to script location
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}Setting up cron jobs for sync schedules...${NC}"
echo "Project root: $PROJECT_ROOT"

# Create logs directory if it doesn't exist
mkdir -p "$PROJECT_ROOT/logs"

# Remove old sync jobs if they exist
echo -e "${YELLOW}Removing old sync jobs...${NC}"
(crontab -l 2>/dev/null | grep -v "sync_current_year_complete.py" | grep -v "sync_all_layers.py" | grep -v "sync_hourly_variable_data.py" | grep -v "sync_weekly_static_data.py" | grep -v "rotate_logs.sh") | crontab -

# Add new jobs
echo -e "${GREEN}Adding new sync schedules...${NC}"

# Hourly sync (variable data only) - every hour at :05
(crontab -l 2>/dev/null ; echo "5 * * * * cd $PROJECT_ROOT && uv run python scripts/sync/sync_hourly_variable_data.py >> logs/sync_hourly_\$(date +\%Y\%m\%d).log 2>&1") | crontab -

# Weekly sync (static data) - Sunday at 2:00 AM
(crontab -l 2>/dev/null ; echo "0 2 * * 0 cd $PROJECT_ROOT && uv run python scripts/sync/sync_weekly_static_data.py >> logs/sync_weekly_\$(date +\%Y\%m\%d).log 2>&1") | crontab -

# Log rotation - Daily at 3:00 AM
(crontab -l 2>/dev/null ; echo "0 3 * * * cd $PROJECT_ROOT && ./scripts/utils/rotate_logs.sh") | crontab -

echo -e "${GREEN}Cron jobs installed!${NC}"
echo ""
echo -e "${GREEN}Current sync schedule:${NC}"
echo "  - Hourly (Variable Data): Attendees & Bunk Assignments - Every hour at :05"
echo "  - Weekly (Static Data): Sessions, Divisions, Persons, Bunks, Plans - Sunday 2:00 AM"
echo "  - Log Rotation: Daily at 3:00 AM"
echo ""
echo "Current crontab:"
crontab -l | grep -E "(sync_hourly|sync_weekly|rotate_logs)"