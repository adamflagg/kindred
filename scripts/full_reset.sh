#!/bin/bash
# Complete reset - backup and start fresh

set -e

# Get project root relative to script location
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "=== Complete PocketBase Reset ==="
echo "WARNING: This will delete all data and start fresh!"
echo "Press Ctrl+C to cancel, or wait 5 seconds to continue..."
sleep 5

# Stop everything
echo "1. Stopping all services..."
pkill -f pocketbase || true
pkill -f "npm run dev" || true
pkill -f "python.*solver" || true
sleep 2

# Backup
BACKUP_DIR="$PROJECT_ROOT/backups"
mkdir -p "$BACKUP_DIR"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

cd "$PROJECT_ROOT/pocketbase"

if [ -d "pb_data" ]; then
    echo "2. Creating backup..."
    cp -r pb_data "$BACKUP_DIR/pb_data_complete_$TIMESTAMP"
    echo "   Backup saved to: $BACKUP_DIR/pb_data_complete_$TIMESTAMP"
fi

# Complete reset
echo "3. Removing old database..."
rm -rf pb_data

# Remove old migrations to start with only the new one
echo "4. Cleaning up old migrations..."
mkdir -p pb_migrations_backup
mv pb_migrations/1735900001_campminder_mirror_clean.js pb_migrations_backup/ 2>/dev/null || true
mv pb_migrations/1735920000_enhanced_hybrid_scenario_planning.js pb_migrations_backup/ 2>/dev/null || true

echo "5. Migrations ready:"
ls -la pb_migrations/

echo
echo "6. Starting PocketBase fresh..."
./pocketbase serve --http=0.0.0.0:8090 &
PB_PID=$!

echo "7. Waiting for PocketBase to initialize..."
sleep 15

# Check if it started
if ps -p $PB_PID > /dev/null; then
    echo "✓ PocketBase is running"
    
    # Create admin account
    echo "8. Creating admin account..."
    curl -X POST http://localhost:8090/api/collections/_superusers/records \
      -H "Content-Type: application/json" \
      -d '{
        "email": "admin@camp.local",
        "password": "campbunking123",
        "passwordConfirm": "campbunking123"
      }' 2>/dev/null || echo "Admin might already exist"
    
    echo
    echo "=== Setup Complete ==="
    echo
    echo "PocketBase Admin: http://localhost:8090/_/"
    echo "Username: admin@camp.local"
    echo "Password: campbunking123"
    echo
    echo "The year-based schema should now be applied!"
    echo
    echo "Next steps:"
    echo "1. Verify: cd $PROJECT_ROOT && python3 scripts/verify_year_schema.py"
    echo "2. Start frontend: cd $PROJECT_ROOT && ./scripts/start_dev.sh"
else
    echo "✗ PocketBase failed to start"
    echo "Check for errors above"
fi