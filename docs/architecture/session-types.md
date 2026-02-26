# Session Types and Bunking Structure

## Three Session Types (Summer Camp)
Summer camp tracks three types of sessions in the `camp_sessions` table:

| Type | Description | Duration | Parent Relationship |
|------|-------------|----------|---------------------|
| **main** | Standard sessions (Session 1, 2, 3, 4) | Full session | None (is a parent) |
| **ag** | All-Gender sessions | Full session (same as parent main) | Links to main session |
| **embedded** | Standalone partial sessions (2a, 2b, 3a, etc.) | Partial dates | None (fully independent) |

## Query Pattern for Summer Sessions
```typescript
// Landing page: Show main + embedded separately (AG stats fold into main)
filter: `(session_type = "main" || session_type = "embedded") && year = ${currentYear}`

// Session dropdown: Same as landing page, sorted logically (1, 2, 2a, 2b, 3, ...)
```

## Embedded Sessions Explained
Embedded sessions are **fully independent** sessions that happen during partial date ranges. They use the **same physical cabins** as main sessions but during **different time periods**.

**Capacity calculation**:
- Capacity = `bunk_plans count × defaultCapacity` (from config, typically 12)
- Each `bunk_plan` represents "work to do" - a camper assignment slot
- No overage logic - always use the standard capacity from config

## AG (All-Gender) Sessions
- Run the full duration of their parent main session
- Campers are ONLY bunked in cabins marked as `gender = "Mixed"` (the actual DB value)
- AG bunks are named with `AG-` prefix (e.g., AG-8, AG-10)
- **AG stats combine with their parent main session** on landing page
- **No AG area dropdown when viewing embedded sessions** (AG is main-only)

## Bunk Plan Structure
- **Main sessions**: Have `bunk_plans` for non-AG bunks only (B-*, G-*)
- **AG sessions**: Have their own `bunk_plans` for AG bunks (AG-*)
- **Embedded sessions**: Have `bunk_plans` for their specific bunks (independent)

## Database Relationships
- `camp_sessions.parent_id`: Links **AG sessions only** to their parent main session (via CampMinder ID)
- `camp_sessions.session_type`: Distinguishes main, ag, embedded
- `bunks.gender`: `'M'`, `'F'`, or `'Mixed'` determines which area dropdowns show which cabins

**Note**: Embedded sessions do NOT have parent_id - they are fully independent.

## Frontend AG Detection Best Practices
- Use `session.session_type === 'ag'` to detect AG sessions (not name string matching)
- Use `session.session_type === 'main'` to determine if AG area should be shown
- Use `bunk.gender?.toLowerCase() === 'mixed'` to detect AG bunks
- Bunk names starting with `AG-` are AG bunks (reliable naming convention)
