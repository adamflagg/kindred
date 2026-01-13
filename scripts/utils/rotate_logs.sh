#!/bin/bash

# Log rotation script for sync logs
# Keeps only the last 7 days of logs

# Get project root relative to script location
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

LOG_DIR="$PROJECT_ROOT/logs"
DAYS_TO_KEEP=7

echo "Rotating logs in $LOG_DIR..."

# Find and remove logs older than DAYS_TO_KEEP
find "$LOG_DIR" -name "sync_*.log" -type f -mtime +$DAYS_TO_KEEP -exec rm -f {} \;

# Count remaining logs
REMAINING=$(find "$LOG_DIR" -name "sync_*.log" -type f | wc -l)
echo "Kept $REMAINING log files from the last $DAYS_TO_KEEP days"

# Optional: Compress logs older than 1 day
# find "$LOG_DIR" -name "sync_*.log" -type f -mtime +1 -exec gzip {} \;