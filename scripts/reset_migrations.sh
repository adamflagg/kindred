#!/bin/bash
# Script to reset migrations and allow re-running

echo "WARNING: This will reset migration history for the complete_v2_schema migration"
echo "This allows the migration to be re-run with modifications"
echo ""
read -p "Continue? (y/N) " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
    # Remove the migration record from the database
    sqlite3 pb_data/data.db "DELETE FROM _migrations WHERE file = '1737000000_complete_v2_schema.js';"
    
    echo "Migration record removed. You can now:"
    echo "1. Edit the migration file at pocketbase/pb_migrations/1737000000_complete_v2_schema.js"
    echo "2. Restart PocketBase to apply the migration again"
else
    echo "Cancelled."
fi