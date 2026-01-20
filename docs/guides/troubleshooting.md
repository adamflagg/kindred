# Troubleshooting Guide

Common issues and solutions for Kindred.

## Quick Fixes

### Service Won't Start

#### Port Already in Use
```bash
# Check what's using the port
lsof -i :8090  # PocketBase
lsof -i :8000  # Solver
lsof -i :3000  # Frontend

# Kill the process
kill -9 [PID]

# Or change the port in configuration
```

#### Permission Denied
```bash
# Make scripts executable
chmod +x scripts/*.sh
chmod +x scripts/start_dev.sh

# Fix PocketBase permissions
chmod +x pocketbase/pocketbase
```

#### Module Not Found
```bash
# Ensure venv is activated
source venv/bin/activate

# Reinstall dependencies
pip install -r requirements.txt
```

### Sync Issues

#### Authentication Failed
```bash
# Check .env file exists and has credentials
grep CAMPMINDER .env

# Clear cached token
rm ~/.campminder_token_cache.json

# Test authentication
uv run python -c "
from campminder.auth import CampMinderAuth
auth = CampMinderAuth()
print(auth.get_token())
"
```

#### Rate Limit Exceeded
- Wait 60 seconds before retrying
- Check if multiple sync processes are running
- Use state files to resume: `ls state/`

#### No Data Synced
```bash
# Check season_id in .env
grep CAMPMINDER_SEASON_ID .env

# Run with verbose output
LOG_LEVEL=DEBUG uv run python scripts/sync/sync_01_sessions.py
```

### Database Issues

#### Database is Locked
```bash
# Force WAL checkpoint
uv run python scripts/force_wal_checkpoint.py

# Check for other processes
fuser pocketbase/pb_data/data.db

# Restart PocketBase
pkill pocketbase
cd pocketbase && ./pocketbase serve
```

#### Migration Failed
```bash
# Check migration files
ls pocketbase/pb_migrations/

# Run migrations manually
cd pocketbase
./pocketbase migrate

# Check logs for errors
tail -f pocketbase/pb_data/logs.db
```

#### Data Integrity Errors
```bash
# Validate year data
uv run python scripts/check/validate_year_integrity.py

# Check for orphaned records
uv run python scripts/diagnostic_tool_v2.py

# Rebuild relationships if needed
uv run python scripts/fix/fix_orphaned_assignments.py
```

### Frontend Issues

#### Blank Page / Won't Load
```bash
# Check console for errors (F12 in browser)

# Clear and rebuild
cd frontend
rm -rf node_modules dist .vite
npm install
npm run dev

# Check environment variables
cat .env
```

#### Can't Connect to Backend
- Verify PocketBase is running: `curl http://localhost:8090/api/health`
- Check CORS settings in PocketBase admin
- Ensure frontend proxy is configured correctly

#### Drag and Drop Not Working
- Clear browser cache
- Check browser console for errors
- Verify user has proper permissions
- Ensure assignments aren't locked

### Solver Issues

#### Solver Timeout
```bash
# Increase time limit in API call
{
  "session_id": "123",
  "time_limit": 300  # 5 minutes
}
```

#### No Feasible Solution
- Check constraint violations
- Verify bunk capacities
- Ensure enough bunks for campers
- Review locked assignments

#### Solver Won't Start
```bash
# Check OR-Tools installation
uv run python -c "from ortools.sat.python import cp_model"

# Reinstall dependencies (includes OR-Tools)
./venv/bin/pip install -r requirements.txt

# Check solver logs
tail -f logs/solver.log
```

## Common Error Messages

### "Token validation failed"
**Cause**: Expired or invalid CampMinder token  
**Fix**: 
```bash
rm ~/.campminder_token_cache.json
uv run python scripts/sync/sync_01_persons.py
```

### "UNIQUE constraint failed"
**Cause**: Trying to insert duplicate record  
**Fix**: 
- Check for existing records first
- Use upsert operations
- Validate unique constraints

### "No such table: bunks"
**Cause**: Migrations haven't run  
**Fix**:
```bash
cd pocketbase
./pocketbase migrate
```

### "Maximum call stack size exceeded"
**Cause**: Circular dependency in frontend  
**Fix**:
- Check for circular imports
- Review component dependencies
- Clear node_modules and reinstall

## Performance Issues

### Slow Sync Operations
```bash
# Check API response times
time curl -X GET "https://api.campminder.com/seasons"

# Reduce batch size
# Edit sync script to use smaller batches

# Run syncs individually instead of all at once
```

### Frontend Lag
```bash
# Check browser performance (F12 → Performance)

# Reduce data loaded
# Implement pagination
# Use React.memo for expensive components
```

### Database Queries Slow
```bash
# Check indexes
uv run python scripts/check/check_db_indexes.py

# Vacuum database
sqlite3 pocketbase/pb_data/data.db "VACUUM;"

# Check query plans
sqlite3 pocketbase/pb_data/data.db "EXPLAIN QUERY PLAN SELECT ..."
```

## Data Recovery

### Restore from Backup
```bash
# Stop services
docker-compose down

# Restore database
cp -r backups/latest/pb_data/* pocketbase/pb_data/

# Restart services
docker-compose up -d
```

### Fix Corrupted State
```bash
# Backup current state
cp -r state/ state_backup_$(date +%Y%m%d)

# Remove corrupted state files
rm state/sync_*.json

# Re-run sync from beginning
uv run python scripts/sync/sync_all_layers.py
```

### Recover Lost Assignments
```bash
# Check audit log
sqlite3 pocketbase/pb_data/data.db \
  "SELECT * FROM _bunk_assignments_history ORDER BY created DESC LIMIT 100;"

# Restore from scenario
uv run python scripts/restore_from_scenario.py --scenario-id [ID]
```

## Debugging Techniques

### Enable Debug Logging
```bash
# Standard debugging (AI prompts, resolution details)
export LOG_LEVEL=DEBUG
uv run python scripts/sync/sync_01_persons.py

# Very verbose debugging (API params, SDK internals)
export LOG_LEVEL=TRACE
uv run python -m bunking.sync.bunk_request_processor.process_requests \
    --year 2025 --session all --dry-run

# Frontend
```

### Inspect Network Traffic
```bash
# Use browser DevTools Network tab

# Or use curl for API testing
curl -X GET http://localhost:8090/api/collections/persons/records \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### Database Inspection
```bash
# Open SQLite console
sqlite3 pocketbase/pb_data/data.db

# Useful queries
.tables
.schema persons
SELECT COUNT(*) FROM persons WHERE year = 2025;
SELECT * FROM persons LIMIT 10;
```

### Check Process Status
```bash
# All processes
ps aux | grep -E "pocketbase|python|node"

# Docker containers
docker ps
docker logs bunking_solver_1 --tail=50

# System resources
top
htop
df -h
```

## Getting Help

### Before Asking for Help
1. Check this troubleshooting guide
2. Search existing documentation
3. Check component logs
4. Try common fixes

### Information to Provide
- Error messages (full text)
- Steps to reproduce
- Environment details (OS, versions)
- Recent changes made
- Relevant log files

### Log Locations
- Sync logs: `logs/sync.log`
- Solver logs: `logs/solver.log`
- Frontend logs: Browser console
- PocketBase logs: `pocketbase/pb_data/logs.db`
- Docker logs: `docker-compose logs [service]`

## Enhanced Request System Issues

### Bunk Requests Sync Errors

#### Missing Methods Error
```
ERROR - Failed to collect requests from row: 'BunkRequestsSync' object has no attribute 'has_prior_year_continuity'
```
**Solution**: Update sync script to latest version with all required methods:
```bash
git pull
uv run python scripts/sync/sync_bunk_requests.py
```

#### Friend Groups Not Showing
**Symptoms**: Friend Groups tab shows "No friend groups found"
**Causes**:
1. Friend groups haven't been created yet
2. Filter syntax issues

**Solution**:
```bash
# Run bunk requests sync to populate friend groups
uv run python scripts/sync/sync_bunk_requests.py

# Verify friend groups were created
uv run python -c "
import os
from pocketbase import PocketBase
pb = PocketBase('http://127.0.0.1:8090')
pb.admins.auth_with_password(
    os.getenv('POCKETBASE_ADMIN_EMAIL', 'admin@camp.local'),
    os.getenv('POCKETBASE_ADMIN_PASSWORD', 'campbunking123')
)
result = pb.collection('friend_groups').get_list(1, 10)
print(f'Total friend groups: {result.total_items}')
"
```

### Request Review Issues

#### Confidence Filter Not Working
**Solution**: The filter shows "Maximum Confidence to Show" - higher values show more requests

#### Request Types Not Matching
**Old values**: 'positive', 'negative'
**New values**: 'bunk_with', 'not_bunk_with'

**Fix existing data**:
```bash
uv run python scripts/fix_request_type_enum.py
```

#### All Confidence Scores Show 0
**Cause**: Unresolved names have 0 confidence
**Solution**: Review and manually match names in RequestReviewPanel

### Visual Indicator Issues

#### Red Ring Persists After Assignment
**Cause**: Cache not invalidated
**Solution**: Wait 30 seconds for cache to expire or refresh the page

#### No Campers Show Red Ring
**Check if requests exist**:
```bash
uv run python -c "
import os
from pocketbase import PocketBase
pb = PocketBase('http://127.0.0.1:8090')
pb.admins.auth_with_password(
    os.getenv('POCKETBASE_ADMIN_EMAIL', 'admin@camp.local'),
    os.getenv('POCKETBASE_ADMIN_PASSWORD', 'campbunking123')
)
requests = pb.collection('bunk_requests').get_full_list(
    query_params={'filter': 'year=2025', 'perPage': 5}
)
print(f'Total requests: {len(requests)}')
"
```

### Scenario Creation Error
**Error**: "Failed to create scenario: 500 Internal Server Error"
**Cause**: Field name mismatch between frontend and backend

**Solution**: Update to latest code version where SavedScenario model uses 'created_at'/'updated_at'

### Authentication Issues During Long Sessions

#### 403 Errors After Extended Use
**Cause**: Admin token expired
**Solution**: The withAuth wrapper automatically re-authenticates. If persistent:
```bash
# Restart services
docker-compose restart
# or
./scripts/start_dev.sh
```

### Friend Group Detection Issues

#### Groups Not Being Created
**Check sync output for**:
- "Friend groups detected: X"
- "Friend groups created: Y"

**Common causes**:
1. Requests not properly linked (check is_reciprocal flag)
2. Completeness threshold too high
3. Manual review items created instead of groups

#### Group Completeness Always 0%
**Cause**: Members not assigned to same bunk
**Solution**: Run solver after friend groups are created

### Database Migration Issues

#### Enum Values Not Updating
**Symptom**: Migration shows as applied but enum values unchanged
**Solution**: Use direct SQLite update:
```bash
uv run python scripts/fix_request_type_enum.py
```

#### Migration Syntax Errors
**Error**: "db.getCollection is not a function" or "Dao is not defined"
**Solution**: 
- For PocketBase v0.22.x and below: Use Dao pattern
- For PocketBase v0.23.0+: Use app parameter directly:
```javascript
// PocketBase v0.23.0+ syntax
migrate((app) => {
  const collection = app.findCollectionByNameOrId("collection_name")
  // make changes
  return app.save(collection)
})
```

## Preventive Measures

### Regular Maintenance
```bash
# Weekly
uv run python scripts/check/validate_year_integrity.py
uv run python scripts/force_wal_checkpoint.py

# Monthly
sqlite3 pocketbase/pb_data/data.db "VACUUM;"
docker system prune -a

# Before major changes
./scripts/backup.sh
```

### Monitoring
- Set up alerts for sync failures
- Monitor disk space usage
- Track API response times
- Review error logs regularly

### Best Practices
- Always use venv for Python
- Commit changes frequently
- Run tests before deploying
- Keep backups current
- Document custom changes