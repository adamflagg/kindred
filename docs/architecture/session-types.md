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
- `camp_sessions.parent_id`: a CampMinder ID, set by the sessions sync (`pocketbase/sync/sessions.go`) for three types:
  - **ag** — the main session with exactly the same start and end dates;
  - **embedded** — the longest session sharing its start or end date (the date-overlap pass);
  - **family_adult** — the Family Camp weekend it belongs to (see below).

  Every other session has none.
- `camp_sessions.session_type`: Distinguishes main, ag, embedded (and the non-summer programs)
- `bunks.gender`: `'M'`, `'F'`, or `'Mixed'` determines which area dropdowns show which cabins

**Note**: an embedded session's parent_id records the overlap only. Embedded sessions are still bunked and counted
independently.

## Family Camp: `family` and `family_adult`
- **family** — a Family Camp weekend (CampMinder's Family Camp group), registered by a family with children.
- **family_adult** — an **"Adult Reg: …"** session (kindred#3213). From 2027 CampMinder files one beside each Family Camp
  weekend, in the Adult Programs group. Adults beyond a family's first two, and adults with no children (empty nesters,
  paper registrations), register there. They are **adult-only Family Camp attendees**, not an adult weekend.
  - **Classified by name**: a name starting `Adult Reg:` is `family_adult` on both the group path and the name fallback.
  - **parent_id** is the paired weekend's cm_id. Pairing goes by the "Family Camp N" number in the name, then by the
    exact name after the prefix, and only then by identical dates, when exactly one weekend matches. Otherwise it is left
    empty and logged. Names come first because CampMinder's 2027 setup gives one Adult Reg session the next weekend's
    dates.
  - **Counts as Family Camp** for the household's Family Camp enrollment status (owner ruling 2026-10-14), the camper
    journey, the daily person custom-values cohort, and Camperships (aid is `family_camp`; an unclaimed one takes its
    weekend's rules program; a household's Family Camp aid request resolves to the paired weekend when Adult Reg is its
    only enrollment, `api/services/financial_aid_session_resolver.py`).
  - **Takes Jotform intake** (owner re-ruling 2026-10-14): each Adult Reg session gets its own tab on Manage › Lodging ›
    Jotform beside the adult weekends (`JOTFORM_SESSION_TYPES`, `api/services/jotform_repository.py`), and its filings
    are matched against that session's registrations as an adult weekend's are. With no weekend board to hold a Requests
    tab, its queue is reviewed on the Jotform tab itself. A regular `family` weekend takes no Jotform.
  - **Not yet on the weekend board**: no cards, no household linking, no cabin attribution. That arrives with the 2027
    Family Camp lodging work. It stays off the adult board, the weekend list and summer metrics.

## Frontend AG Detection Best Practices
- Use `session.session_type === 'ag'` to detect AG sessions (not name string matching)
- Use `session.session_type === 'main'` to determine if AG area should be shown
- Use `bunk.gender?.toLowerCase() === 'mixed'` to detect AG bunks
- Bunk names starting with `AG-` are AG bunks (reliable naming convention)
