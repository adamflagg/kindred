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

## Teen Programs

Teens (rising 11th and 12th graders) participate in two distinct programs that
are tracked for enrollment and revenue but **do not bunk through Kindred** —
the camp handles their bunking separately due to the small cohort size.

| session_type | Display label | Underlying CampMinder sessions | Typical grade |
|---|---|---|---|
| `scit` | SCIT | Counselor In-Training + Specialist In-Training (collective camp name) | Rising 12th |
| `tli` | TLI | Teen Leadership Institute | Rising 11th |

**Metrics treatment:**
- Forecast: one row per `session_type`. SCIT aggregates CIT + SIT enrollments into one line item. TLI aggregates any TLI sessions.
- Bunking board: excluded (`scit`/`tli` not in `BUNK_SESSION_TYPES`). Teens never appear in cabin assignments, requests, or the bunking UI.
- Years-at-camp / retention: excluded by default — teens are tracked as a separate cohort, not as "main camp returners". A future opt-in toggle (`SUMMER_PROGRAM_WITH_TEENS_TYPES`) will allow including teens in retention calculations.

**Budget config:** Per-program (not per-CampMinder-session) — stored under `config_key='type_scit'` and `config_key='type_tli'` in the PocketBase `config` collection.

**Legacy note:** Pre-2026 historical data may have `session_type='training'` for CIT/SIT sessions. The script `scripts/migrate_teen_session_types.py` flips those to `'scit'`. The legacy `'training'` value is retained in the enum for any rows that haven't been migrated.
