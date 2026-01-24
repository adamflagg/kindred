# Metrics & Reporting System Design

> **Status**: Phase 3 Complete (15/15 tables exported)
> **Date**: 2026-01-23 (updated)
> **Purpose**: Centralized reporting for year-over-year camp metrics with Google Sheets integration

## Problem Statement

The nonprofit needs centralized reporting of various metrics year-over-year. Currently:
- CampMinder reports require manual weekly exports
- Reports are not API-accessible
- Data is scattered across multiple spreadsheets
- No automated year-over-year comparisons
- Team needs shared access via Google Sheets ecosystem

## Requirements Summary

### Retention Analysis
- By gender, grade, session, bunk, years at camp, city, school, synagogue
- Year-over-year tracking (e.g., 2022→2023→2024→2025)
- Bunk-by-bunk staff effectiveness (counselor retention impact)

### Registration Analysis
- Monthly registration counts and velocity
- Priority reg vs early reg vs total
- New vs returning breakdown
- By session length (1-week, 2-week, 3-week)
- Registration velocity: "how fast do sessions fill year over year"
- Waitlist analysis: accepted/declined/expired, already in another session

### Enrollment Forecast
- Budget vs actuals (camper counts and fees)
- Fees collected vs budgeted
- Year-over-year comparison
- Weekly snapshots for historical comparison

### Constraints
- ~1,200-1,500 campers per year
- Daily sync preferred (especially during registration season)
- Historical lookback across multiple years required
- Must work in Google Sheets ecosystem (IMPORTRANGE, downstream usage)
- Budget data not in CampMinder (manual input required)
- Can't predict all future report needs → must export raw tables

---

## CampMinder API Data Availability

### Financial API (NEW - Now Accessible)

| Endpoint | Data | Count | Notes |
|----------|------|-------|-------|
| `/financials/financialcategories` | Fee categories | 94 | "Fees - Summer Camp", "Financial Assistance", etc. |
| `/financials/paymentmethods` | Payment types | 9 | Check, Credit Card, Cash, etc. |
| `/financials/transactionreporting/transactiondetails` | All transactions | 13,220+ | Per-person fee tracking |

**Transaction Detail Fields:**
```json
{
  "transactionId": 57783711,
  "season": 2025,
  "postDate": "2025-11-11T17:05:26.363Z",
  "effectiveDate": "2025-11-11T00:00:00",
  "financialCategoryId": 22650,
  "description": "Session 2 - Camper Fee",
  "amount": 128.0,
  "sessionId": 1335115,
  "programId": null,
  "personId": 3451504,
  "householdId": 3539709
}
```

### Staff API (NEW)

| Endpoint | Data | Count | Notes |
|----------|------|-------|-------|
| `/staff` | Staff list | 274 active | Includes bunk assignments |
| `/staff/positions` | Position types | 72 | Counselor, Unit Head, etc. |
| `/staff/programareas` | Program areas | — | Area categorization |

**Staff Fields:**
- `PersonID`, `Position1ID`, `Position2ID`
- `BunkAssignments` (array of bunk IDs)
- `BunkStaff` (boolean)
- `DivisionID`, `Years` (years as staff)
- `Salary` (often null)

### Divisions API (NEW)

| Endpoint | Data | Count | Notes |
|----------|------|-------|-------|
| `/divisions` | Division definitions | 85 | Grade/gender groupings |
| `/divisions/attendees` | Person-division mapping | 7,952 | Seasonal assignments |

**Division Fields:**
- `Name`, `StartGradeRangeID`, `EndGradeRangeID`
- `GenderID`, `Capacity`, `SubOfDivisionID`

### Existing Synced Data

| Table | Key Fields for Metrics |
|-------|------------------------|
| `attendees` | `PostDate` (registration date!), `EffectiveDate`, `StatusID`, `SessionID` |
| `persons` | `School`, `YearsAtCamp`, `LastYearAttended`, `CampGradeID`, Address (city) |
| `camp_sessions` | Dates, types (main/ag/embedded), programs |
| `bunk_assignments` | Historical bunk assignments by session |
| `bunk_plans` | Capacity planning |

### Key Discovery: PostDate = Registration Date

The attendee `PostDate` field contains the registration timestamp. This enables:
- Registration velocity tracking
- Year-over-year comparison at any point in time
- Weekly enrollment snapshots

### NOT Available via API

| Data | Status | Workaround |
|------|--------|------------|
| Referral Source | Custom field (not configured or not exposed) | Check CampMinder custom field setup |
| Synagogue | Custom field (not configured or not exposed) | Check CampMinder custom field setup |
| Budget Data | Not in CampMinder | Manual input sheet in destination |

---

## Recommended Architecture

```
CampMinder API
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│                     Kindred (Data Engine)                   │
│                                                             │
│  EXISTING SYNCS:              NEW SYNCS NEEDED:            │
│  • sessions ✅                • divisions                  │
│  • attendees ✅               • division_attendees         │
│  • persons (with custom) ✅                                │
│  • bunks ✅                                                │
│  • bunk_plans ✅                                           │
│  • bunk_assignments ✅                                     │
│  • financial_transactions ✅                               │
│  • financial_categories ✅                                 │
│  • staff ✅                                                │
│  • staff_positions ✅                                      │
│                                                             │
│  COMPUTED TABLES (Python):                                 │
│  • camper_history (denormalized per-camper-year)          │
│  • registration_velocity (cumulative by day)              │
│  • retention_by_bunk (counselor effectiveness)            │
│  • enrollment_snapshots (daily point-in-time)             │
│                                                             │
│  DERIVED FIELDS:                                           │
│  • years_at_camp (cross-year lookup)                      │
│  • is_returning (prior year enrolled)                     │
│  • prior_year_bunk, prior_year_counselor                  │
│  • registration_week (days since reg opened)              │
│  • session_length_weeks (1/2/3 categorization)            │
│  • normalized_school (fuzzy match)                        │
│                                                             │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼ Google Sheets API (daily push)
┌─────────────────────────────────────────────────────────────┐
│              Google Sheets (Single Master Workbook)         │
│                                                             │
│  YEAR-PREFIXED DATA SHEETS:     GLOBAL SHEETS:             │
│  ✅ 2025-attendees              ✅ globals-tag-definitions  │
│  ✅ 2025-persons                ✅ globals-custom-field-defs│
│  ✅ 2025-sessions               ✅ globals-financial-cats   │
│  ✅ 2025-staff                  ✅ globals-divisions        │
│  ✅ 2025-bunk-assignments                                  │
│  ✅ 2025-financial-transactions MANUAL INPUT:              │
│  ✅ 2025-bunks                  • budget                   │
│  ✅ 2025-households             • capacity_targets         │
│  ✅ 2025-session-groups                                    │
│  ✅ 2025-person-custom-values                              │
│  ✅ 2025-household-custom-values                           │
│  • 2024-* (all years)                                      │
│                                                             │
│  REPORT SHEETS (formulas reference data sheets):           │
│  • Retention Analysis                                      │
│  • Registration Velocity                                   │
│  • Enrollment Forecast                                     │
│  • Revenue vs Budget                                       │
│  • Waitlist Analysis                                       │
│                                                             │
└─────────────────────────┬───────────────────────────────────┘
                          │
            ┌─────────────┴─────────────┐
            ▼                           ▼
   ┌─────────────────┐         ┌─────────────────┐
   │  Looker Studio  │         │  Other Sheets   │
   │  (dashboards)   │         │  (IMPORTRANGE)  │
   └─────────────────┘         └─────────────────┘
```

### Why This Architecture

1. **Kindred handles relationships** - Cross-year joins, historical lookups, and denormalization are painful in Sheets but easy in Python/SQL

2. **Sheets as destination** - Team familiarity, IMPORTRANGE for downstream, no new tools to learn

3. **Looker Studio optional** - Can connect to Sheets for nicer dashboards, but Sheets charts work too

4. **Daily snapshots** - Store point-in-time enrollment counts to answer "where were we on March 15 last year"

5. **Raw + computed tables** - Export both raw data (for ad-hoc queries) and pre-computed metrics (for common reports)

---

## Sheet Architecture: Single Workbook with Year-Prefixed Sheets

### Decision
Use a **single Google Sheets workbook** with year-prefixed sheet names rather than separate workbooks per year.

### Sheet Naming Convention (Implemented)
```
# Year-specific (11 tables per year)
2025-attendees
2025-persons
2025-sessions
2025-staff
2025-bunk-assignments
2025-financial-transactions
2025-bunks
2025-households
2025-session-groups
2025-person-custom-values
2025-household-custom-values

# Global (4 tables, no year prefix)
globals-tag-definitions
globals-custom-field-definitions
globals-financial-categories
globals-divisions
```

### Rationale

**Cross-year analysis is the primary use case.** Retention analysis, registration velocity comparisons, and YoY enrollment tracking all require joining data across years.

| Approach | Cross-Year Formula |
|----------|-------------------|
| **Separate workbooks** | `=VLOOKUP(A2, IMPORTRANGE("2024_workbook_id", "attendees!A:A"), 1, FALSE)` |
| **Single workbook** | `=VLOOKUP(A2, '2024-attendees'!A:A, 1, FALSE)` |

The single-workbook approach eliminates:
- IMPORTRANGE permission grants (manual step per link)
- Multiple workbook IDs in configuration
- Formula breakage when workbook IDs change
- Slow recalculation from cross-workbook lookups

### Comparison Summary

| Factor | Per-Year Workbooks | Single Workbook (chosen) |
|--------|-------------------|-------------------------|
| Cross-year queries | IMPORTRANGE required | Direct sheet references |
| Implementation | Track N workbook IDs | Single workbook ID |
| Adding new year | Create workbook, copy structure | Add new year-prefixed sheets |
| Tab organization | Clean (8-10 tabs) | Busy (50+ tabs, mitigated by color-coding) |
| Data volume | More headroom per file | 2.3M << 10M limit, plenty of room |
| Sharing | Fine-grained per year | All-or-nothing |

### Tab Organization Strategy
- Color-code sheets by year (2025=blue, 2024=green, 2023=yellow, etc.)
- Group Report sheets at the end with distinct color
- Staff primarily interact with Report sheets, not raw data tabs
- Alphabetical sort groups years naturally: `2024-*`, `2025-*`, `globals-*`

### Implementation (Actual Code)

Sheet names are resolved via `ExportConfig.GetResolvedSheetName(year)` in `table_exporter.go`:

```go
// Get all sheet names for a full export
names := GetAllExportSheetNames(2025)
// Returns: ["2025-attendees", "2025-persons", "2025-sessions",
//           "2025-staff", "2025-bunk-assignments", "2025-financial-transactions",
//           "2025-bunks", "2025-households", "2025-session-groups",
//           "2025-person-custom-values", "2025-household-custom-values",
//           "globals-tag-definitions", "globals-custom-field-definitions",
//           "globals-financial-categories", "globals-divisions"]

// Export configs define sheet names with {year} placeholder
GetYearSpecificExports() // 11 year-specific tables
GetGlobalExports()       // 4 global tables
```

### Export Table Implementation Status

| Collection | Sheet Name | Status | Notes |
|------------|------------|--------|-------|
| **YEAR-SPECIFIC EXPORTS (11)** | | | |
| attendees | {year}-attendees | ✅ Done | All records (no filter), FK resolution |
| persons | {year}-persons | ✅ Done | Demographics, tags, divisions |
| camp_sessions | {year}-sessions | ✅ Done | All session types (no filter) |
| staff | {year}-staff | ✅ Done | Positions inlined, program areas resolved |
| bunk_assignments | {year}-bunk-assignments | ✅ Done | Person/session/bunk with CM IDs + is_deleted |
| financial_transactions | {year}-financial-transactions | ✅ Done | Comprehensive (32 columns) |
| bunks | {year}-bunks | ✅ Done | cm_id, name, gender, is_active, area_id |
| households | {year}-households | ✅ Done | cm_id, mailing_title |
| session_groups | {year}-session-groups | ✅ Done | cm_id, name, description, is_active |
| person_custom_values | {year}-person-custom-values | ✅ Done | Person + field def + value |
| household_custom_values | {year}-household-custom-values | ✅ Done | Household + field def + value |
| **GLOBAL EXPORTS (4)** | | | |
| person_tag_defs | globals-tag-definitions | ✅ Done | Tag type definitions |
| custom_field_defs | globals-custom-field-definitions | ✅ Done | Custom field schemas |
| financial_categories | globals-financial-categories | ✅ Done | Fee categories |
| divisions | globals-divisions | ✅ Done | With parent resolution |
| **EXCLUDED - REDUNDANT** | | | |
| bunk_plans | — | ❌ Excluded | Data redundant with bunk_assignments |
| payment_methods | — | ❌ Excluded | Inlined in financial_transactions |
| staff_positions | — | ❌ Excluded | Inlined in staff export |
| staff_program_areas | — | ❌ Excluded | Resolved via staff.position double-FK |
| staff_org_categories | — | ❌ Excluded | Resolved via staff.organizational_category |
| **EXCLUDED - INTERNAL/SOLVER** | | | |
| config | — | ❌ Excluded | Internal app config |
| config_sections | — | ❌ Excluded | Internal app config |
| solver_runs | — | ❌ Excluded | Solver execution logs |
| saved_scenarios | — | ❌ Excluded | Draft bunking scenarios |
| locked_groups | — | ❌ Excluded | Solver constraints |
| locked_group_members | — | ❌ Excluded | Solver constraints |
| bunk_assignments_draft | — | ❌ Excluded | Draft assignments |
| debug_parse_results | — | ❌ Excluded | Debug data |
| users | — | ❌ Excluded | Auth users |
| **EXCLUDED - REQUEST PROCESSING** | | | |
| bunk_requests | — | ❌ Excluded | Processed requests (internal) |
| original_bunk_requests | — | ❌ Excluded | Raw CSV imports (internal) |
| bunk_request_sources | — | ❌ Excluded | Source tracking (internal) |

**Summary:** 15 tables implemented (11 year-specific + 4 global), 17 tables excluded.

---

## Implementation Phases

### Phase 1: Add New CampMinder Syncs to Kindred ✅ COMPLETE

**Go sync services** (`pocketbase/sync/`):
- ✅ `financial_transactions.go` - Sync transaction details
- ✅ `financial_categories.go` - Sync fee categories
- ✅ `staff.go` - Sync staff with positions
- ✅ `staff_positions.go` - Sync position types
- ⬜ `divisions.go` - Sync divisions and attendee mappings (not yet needed)

**PocketBase tables:**
- ✅ `financial_transactions`
- ✅ `financial_categories`
- ✅ `staff`
- ✅ `staff_positions`
- ⬜ `divisions` (not yet needed)
- ⬜ `division_attendees` (not yet needed)

### Phase 2: Computed Tables and Derived Fields ⬜ NOT STARTED

**New Python module** (`bunking/metrics/`):
- `camper_history.py` - Denormalized per-camper-year view
- `registration_velocity.py` - Cumulative enrollment by day
- `retention_analysis.py` - Retention by various dimensions
- `enrollment_snapshots.py` - Daily snapshot generation

**Derived field computation:**
- Add `first_year_attended`, `is_returning`, `prior_year_session`, `prior_year_bunk` to attendees
- Add `normalized_school` with fuzzy matching
- Add `session_length_weeks` to sessions

### Phase 3: Google Sheets Export Service ✅ COMPLETE

**Go services** (`pocketbase/sync/`):
- ✅ `google_sheets.go` - Main export service with `Sync()` entry point
- ✅ `sheets_scheduling.go` - `SyncGlobalsOnly()`, `SyncDailyOnly()`, `SyncForYears()`
- ✅ `table_exporter.go` - Generic `TableExporter` with column configs and FK resolution

**Exports all 15 tables:**
- Year-specific (11): `{year}-attendees`, `{year}-persons`, `{year}-sessions`, `{year}-staff`, `{year}-bunk-assignments`, `{year}-financial-transactions`, `{year}-bunks`, `{year}-households`, `{year}-session-groups`, `{year}-person-custom-values`, `{year}-household-custom-values`
- Global (4): `globals-tag-definitions`, `globals-custom-field-definitions`, `globals-financial-categories`, `globals-divisions`

**Column Configuration:**
- ✅ All columns aligned with source table fields (no more blank columns)
- ✅ FK resolution field types for CM ID exports (VLOOKUPable between sheets)
- ✅ Nested field resolution (e.g., attendee → person → first_name)
- ✅ Write-in override fields (gender_identity_write_in takes precedence)
- ✅ Double FK resolution (position → program_area → name)
- ✅ CM ID lookup for self-references (session parent_id → session name)
- ✅ No filters on source data (filtering happens in Sheets formulas)

**Configuration:**
- ✅ `GOOGLE_SERVICE_ACCOUNT_KEY` - Service account JSON (base64 encoded)
- ✅ `GOOGLE_SPREADSHEET_ID` - Target workbook ID
- ✅ Button trigger in Metrics UI ("Export to Sheets")
- ⬜ Scheduled daily push (cron not yet configured)

### Phase 4: Report Templates ⬜ NOT STARTED

**Google Sheets templates:**
- Retention Analysis (QUERY formulas against data sheets)
- Registration Velocity (charts + YoY comparison)
- Enrollment Forecast (budget vs actuals)
- Waitlist Analysis

**Optional Looker Studio:**
- Connect to Sheets as data source
- Pre-built dashboard templates

---

## Data Volume Estimates

| Table | Rows/Year | Years | Total Rows | Columns | Cells |
|-------|-----------|-------|------------|---------|-------|
| attendees | 1,500 | 5 | 7,500 | 30 | 225K |
| persons | 3,000 | 5 | 15,000 | 40 | 600K |
| financial_transactions | 13,000 | 5 | 65,000 | 32 | 2.1M |
| bunk_assignments | 1,500 | 5 | 7,500 | 10 | 75K |
| staff | 300 | 5 | 1,500 | 20 | 30K |
| person_custom_values | 5,000 | 5 | 25,000 | 6 | 150K |
| household_custom_values | 2,000 | 5 | 10,000 | 5 | 50K |
| **Total** | | | | | **~3.2M** |

Google Sheets limit: 10M cells. We're well within limits.

---

## Open Questions

1. **Custom Fields**: Are referral source and synagogue configured as custom fields in CampMinder? Need to check their CampMinder setup.

2. **Historical Data**: How many years back do they need? API access to older seasons needs verification.

3. **Budget Input**: Where should budget data live? Options:
   - Manual sheet in the workbook
   - Kindred `config` table with UI
   - Separate budget spreadsheet with IMPORTRANGE

4. **Snapshot Frequency**: Daily snapshots during registration season, weekly otherwise? Or always daily?

5. **Dashboard Location**: Build charts in Sheets, Looker Studio, or Kindred frontend? Recommendation: Start with Sheets, add Looker Studio later if needed.

---

## What's Still TODO

### Immediate (Phase 3 Followup)
1. [ ] Configure scheduled daily export (cron job)
2. [ ] Add historical year export (2024, 2023, etc.)
3. [ ] Test full export with real data and verify all FK resolutions work

### Phase 2 (Computed Tables)
4. [ ] Build `bunking/metrics/` Python module
5. [ ] `camper_history.py` - Denormalized per-camper-year view
6. [ ] `registration_velocity.py` - Cumulative enrollment by day
7. [ ] `retention_analysis.py` - Retention by various dimensions
8. [ ] `enrollment_snapshots.py` - Daily snapshot generation

### Phase 4 (Report Templates)
9. [ ] Create Retention Analysis report template in Sheets
10. [ ] Create Registration Velocity report template with charts
11. [ ] Create Enrollment Forecast report (budget vs actuals)
12. [ ] Create Waitlist Analysis report

### Future Enhancements
13. [ ] Sync divisions and division_attendees if needed
14. [ ] Check CampMinder custom field configuration for referral/synagogue
15. [ ] Optional: Looker Studio dashboards

---

## Completed Milestones

- [x] Confirm historical data access (test syncing 2024, 2023 seasons)
- [x] Design PocketBase schema for new tables
- [x] Create Phase 1 implementation plan
- [x] Set up Google Sheets service account for testing
- [x] Wire up full Google Sheets export (15 tables)
- [x] Implement FK resolution field types
- [x] Add all year-specific exports (11 tables)
- [x] Add all global exports (4 tables)
- [x] Remove filters from attendees and camp_sessions (complete data export)
- [x] Comprehensive financial_transactions export (32 columns)
