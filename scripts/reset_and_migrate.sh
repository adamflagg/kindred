#!/bin/bash
# Reset PocketBase and apply fresh migration

set -e

# Get project root relative to script location
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "=== PocketBase Reset and Migration ==="
echo "This will backup and reset your PocketBase database"
echo

# Change to PocketBase directory
cd "$PROJECT_ROOT/pocketbase"

# Stop PocketBase if running
echo "1. Stopping PocketBase..."
pkill -f pocketbase || true
sleep 2

# Backup current database
BACKUP_DIR="$PROJECT_ROOT/backups"
mkdir -p "$BACKUP_DIR"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

echo "2. Creating backup..."
if [ -f "pb_data/data.db" ]; then
    cp -r pb_data "$BACKUP_DIR/pb_data_backup_$TIMESTAMP"
    echo "   Backup saved to: $BACKUP_DIR/pb_data_backup_$TIMESTAMP"
else
    echo "   No existing database found"
fi

# Option 1: Clean migration approach (recommended)
echo "3. Cleaning up for fresh migration..."

# Remove the problematic migration that already ran
sqlite3 pb_data/data.db "DELETE FROM _migrations WHERE file IN ('1735900001_campminder_mirror_clean.js', '1735920000_enhanced_hybrid_scenario_planning.js');" 2>/dev/null || true

# Remove the old migration files
rm -f pb_migrations/1735900001_campminder_mirror_clean.js
rm -f pb_migrations/1735920000_enhanced_hybrid_scenario_planning.js

echo "4. Migration files ready:"
ls -la pb_migrations/*.js

echo
echo "5. Starting PocketBase with fresh migration..."
echo "   The new migration (1736000000_year_based_schema.js) will:"
echo "   - Create all tables with year fields"
echo "   - NO seasons table"
echo "   - Proper indexes for year-based queries"
echo "   - All required fields including pronouns, gender options, etc."
echo

# Start PocketBase (already in pocketbase directory)
./pocketbase serve --http=0.0.0.0:8090 &
PB_PID=$!

echo "6. Waiting for PocketBase to start and apply migrations..."
sleep 10

# Check if migration applied
if curl -s http://localhost:8090/api/health > /dev/null 2>&1; then
    echo "✓ PocketBase is running"
    
    # Check migration status
    MIGRATION_COUNT=$(sqlite3 pb_data/data.db "SELECT COUNT(*) FROM _migrations WHERE file='1736000000_year_based_schema.js';" 2>/dev/null || echo "0")
    
    if [ "$MIGRATION_COUNT" = "1" ]; then
        echo "✓ Migration applied successfully!"
    else
        echo "⚠ Migration may not have applied. Check logs."
    fi
else
    echo "✗ PocketBase failed to start. Check logs."
fi

echo
echo "=== Next Steps ==="
echo "1. Verify schema: python3 scripts/verify_year_schema.py"
echo "2. Sync current data: python3 scripts/sync/sync_all_layers.py"
echo "3. Sync historical data: python3 scripts/sync_historical_attendees_only.py"
echo
echo "PocketBase Admin: http://localhost:8090/_/"
echo "Username: admin@camp.local"
echo "Password: campbunking123"