# Go Sync Service Patterns

Structural patterns for the Go sync services in `pocketbase/sync/`. Companion to
`docs/architecture/sync-layer.md` (architecture, job order, adding a new job) and
`docs/reference/sync-id-conventions.md` (CampMinder ID vs PocketBase ID).

## Service Struct Template

Every sync service follows the same structure:

```go
package sync

import (
    "context"
    "fmt"
    "log/slog"

    "github.com/camp/kindred/pocketbase/campminder"
    "github.com/pocketbase/pocketbase/core"
)

// WidgetsSync handles syncing widget records from CampMinder
type WidgetsSync struct {
    BaseSyncService
    // Add service-specific caches here
}

// NewWidgetsSync creates a new widgets sync service
func NewWidgetsSync(app core.App, client *campminder.Client) *WidgetsSync {
    return &WidgetsSync{
        BaseSyncService: NewBaseSyncService(app, client),
    }
}

// Name returns the name of this sync service
func (s *WidgetsSync) Name() string {
    return "widgets"
}

// Sync performs the widgets synchronization
func (s *WidgetsSync) Sync(ctx context.Context) error {
    s.LogSyncStart("widgets")
    s.Stats = Stats{}
    s.SyncSuccessful = false
    s.ClearProcessedKeys()

    // 1. Pre-load existing records
    year := s.Client.GetSeasonID()
    filter := fmt.Sprintf("year = %d", year)
    existingRecords, err := s.PreloadRecords("widgets", filter, func(record *core.Record) (interface{}, bool) {
        if cmID, ok := record.Get("cm_id").(float64); ok {
            return int(cmID), true
        }
        return nil, false
    })
    if err != nil {
        return err
    }

    // 2. Fetch from CampMinder
    widgets, err := s.Client.GetWidgets()
    if err != nil {
        return fmt.Errorf("fetching widgets: %w", err)
    }

    if len(widgets) > 0 {
        s.SyncSuccessful = true
    }

    // 3. Process each record
    for _, widgetData := range widgets {
        select {
        case <-ctx.Done():
            return fmt.Errorf("widgets sync cancelled: %w", ctx.Err())
        default:
        }

        // Errors vs Rejected: see "Error Handling" below. processWidget both transforms
        // AND writes, so its failures are indistinguishable at this call site and belong
        // on Errors. Split the transform out if you want its failures to be warn-only.
        if err := s.processWidget(widgetData, existingRecords); err != nil {
            slog.Error("Error processing widget", "error", err)
            s.Stats.Errors++
        }
    }

    // 4. Delete orphans
    // ... (see orphan detection section)

    // 5. WAL checkpoint
    if err := s.ForceWALCheckpoint(); err != nil {
        slog.Warn("WAL checkpoint failed", "error", err)
    }

    s.LogSyncComplete("Widgets")
    return nil
}
```

## Transform Service Template (No CampMinder Client)

Transform services compute derived data from existing PocketBase records. They do NOT embed `BaseSyncService` because they don't need a CampMinder client:

```go
type StaffSkillsSync struct {
    App            core.App
    Year           int
    Stats          Stats
    SyncSuccessful bool
}

func NewStaffSkillsSync(app core.App) *StaffSkillsSync {
    return &StaffSkillsSync{App: app}
}

// SetYear implements YearSetter for receiving year from orchestrator
func (s *StaffSkillsSync) SetYear(year int) {
    s.Year = year
}
```

Transform services implement `YearSetter` so the orchestrator can inject the correct year.

## Record Processing with Simple Keys

For tables where `cm_id` alone is the unique key:

```go
func (s *WidgetsSync) processWidget(data map[string]interface{}, existing map[interface{}]*core.Record) error {
    cmID := int(data["ID"].(float64))
    year := s.Client.GetSeasonID()

    // Track as processed for orphan detection
    s.TrackProcessedKey(cmID, year)

    // Build record data
    recordData := map[string]interface{}{
        "cm_id": cmID,
        "name":  data["Name"],
        "year":  year,
    }

    // Resolve relations (CM ID -> PB ID)
    relations := []RelationConfig{
        {FieldName: "session", Collection: "camp_sessions", CMID: sessionCMID, Required: true},
    }
    if err := s.PopulateRelations(recordData, relations); err != nil {
        return fmt.Errorf("populating relations: %w", err)
    }

    // Upsert (create or update)
    return s.ProcessSimpleRecord("widgets", cmID, recordData, existing, nil)
}
```

The last parameter of `ProcessSimpleRecord` is `compareFields` -- pass `nil` to compare all fields, or a slice of field names to compare only specific fields.

## Record Processing with Composite Keys

For tables where uniqueness requires multiple fields (e.g., attendees = person + session):

```go
key := fmt.Sprintf("%d:%d", personCMID, sessionCMID)
s.TrackProcessedCompositeKey(key, year)

// PreloadCompositeRecords returns map[string]*core.Record (string keys, not interface{})
return s.ProcessCompositeRecord("attendees", key, recordData, existingRecords, []string{"year"})
```

The `skipFields` parameter (last arg) lists fields to exclude from change detection. `"year"` is commonly skipped because it's part of the key, not variable data.

## Paginated Fetching from CampMinder

For large datasets, use pagination:

```go
page := 1
pageSize := LargePageSize  // 500

for {
    select {
    case <-ctx.Done():
        return fmt.Errorf("sync cancelled: %w", ctx.Err())
    default:
    }

    items, hasMore, err := s.Client.GetItemsPage(page, pageSize)
    if err != nil {
        return fmt.Errorf("fetching page %d: %w", page, err)
    }

    if page == 1 && len(items) > 0 {
        s.SyncSuccessful = true
    }

    for _, item := range items {
        // process...
    }

    if !hasMore || len(items) == 0 {
        break
    }
    page++
}
```

**Page size constants:**
- `SmallPageSize = 10` -- For endpoints with known limitations
- `DefaultPageSize = 100` -- General purpose
- `LargePageSize = 500` -- High-volume operations

## Orphan Detection

After processing all CampMinder records, delete PocketBase records that no longer exist in CampMinder:

### Simple key orphan deletion (re-queries PocketBase):
```go
s.DeleteOrphans("widgets",
    func(record *core.Record) (string, bool) {
        cmID, _ := record.Get("cm_id").(float64)
        yearVal, _ := record.Get("year").(float64)
        if cmID > 0 {
            return CompositeKey(int(cmID), int(yearVal)), true
        }
        return "", false
    },
    "widget",
    filter,
)
```

### Preloaded orphan deletion (~200x faster for large tables):
```go
s.DeleteOrphansFromPreloaded(existingRecords, "widget")
```

## Logging Patterns

```go
// Initialize once at app startup
import "github.com/camp/kindred/pocketbase/logging"
logging.Init("pocketbase")

// Then use slog throughout
slog.Info("Processing widget", "cm_id", cmID, "name", name)
slog.Error("Failed to process", "error", err, "cm_id", cmID)
slog.Warn("Skipping invalid record", "reason", "missing field")
slog.Debug("Detailed info", "field", value)  // Only visible with LOG_LEVEL=DEBUG
```

Format: `2026-01-06T14:05:52Z [pocketbase] INFO message key=value...`

Use structured key=value pairs, not formatted strings:
```go
// CORRECT
slog.Info("Fetched records", "count", len(records), "year", year)

// WRONG
slog.Info(fmt.Sprintf("Fetched %d records for year %d", len(records), year))
```

## Testing Patterns

Tests use table-driven style with the standard `testing` package:

```go
func TestWidgetsSync_Name(t *testing.T) {
    s := &WidgetsSync{}
    if got := s.Name(); got != "widgets" {
        t.Errorf("Name() = %q, want %q", got, "widgets")
    }
}

func TestWidgetsSync_Transform(t *testing.T) {
    tests := []struct {
        name    string
        input   map[string]interface{}
        want    int
        wantErr bool
    }{
        {
            name:  "valid widget",
            input: map[string]interface{}{"ID": float64(123), "Name": "Test"},
            want:  123,
        },
        {
            name:    "missing ID",
            input:   map[string]interface{}{"Name": "Test"},
            wantErr: true,
        },
    }

    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            // test logic...
        })
    }
}
```

**Note:** CampMinder API responses use `float64` for all numbers (JSON unmarshaling). Always type-assert as `float64` first, then convert: `int(data["ID"].(float64))`.

## Error Handling

**`Stats.Errors` is not a general-purpose "something went wrong" counter — it fails the
run.** kindred#2284 split the two kinds of failure a sync can count, because conflating them
is how a sync that could not write to SQLite still handed the operator a green checkmark:

| Counter | Means | Tolerance |
|---------|-------|-----------|
| `Stats.Errors` | **Infrastructure** — a local SQLite operation did not complete (`App.Save`, `App.Delete`, `App.Create`, `FindRecordsByFilter`) | **Zero. Any non-zero count fails the run.** There is no healthy run in which this is non-zero. |
| `Stats.Rejected` | **Per-record transform** — one upstream record could not be turned into a PocketBase row, so it was counted and skipped | Warn-only for its first season. Surfaced on the Sync tab, never fatal. |

The decision lives in one place, `applyCompletionStatus` in `orchestrator.go`, which all three
normal completion paths route through. It sums `Errors` across the service *and* its
`SubStats`, so a combined sync cannot hide a failing sub-entity.

**`Stats.Rejected` is wired, and the site list is machine-enforced — do not extend it by
hand.** kindred#2295 shipped the reclassification together with the sweep guard that makes it
safe, because a rejected record skips `TrackProcessedKey` via the same `continue` and the
orphan sweep would otherwise delete its existing row in the same run.

There are exactly **30** per-record rejection sites, and two AST census tests in
`pocketbase/sync/rejection_sites_test.go` hold that number in both directions:

| Test | Fails when |
|------|-----------|
| `TestPerRecordRejectionsUseTheRejectedCounter` | a declared site slips back to `Stats.Errors` |
| `TestNoUnexpectedSiteUsesTheRejectedCounter` | any `Rejected++` appears that is not on the declared list — **including one the census cannot classify** |

So adding a site means adding it to `expectedRejectSites` with the reasoning, in the same
change. Do not count the sites with `grep "Stats.Rejected++"`: that returns 32, because two
hits are prose in the census tests' own comments and because `householdStats.Rejected++`
contains the same substring.

**Before you reclassify a site, check that its sweep is actually guarded.** The *rejection*
arm reaches `DeleteOrphans`, `DeleteOrphansGuarded` and `DeleteOrphansFromPreloaded` — every
sweep that routes through `BaseSyncService`, which is the only thing that fills in
`OrphanSweepGuard.Rejected`. Nine services (`camper_dietary`, `camper_history`,
`camper_transportation`, `household_demographics`, `normalize_geographic`,
`quest_registrations`, `staff_skills`, `staff_applications`, `staff_vehicle_info`) do not
embed `BaseSyncService` at all and build their own `OrphanSweepGuard` inside their own
`deleteOrphans` (kindred#2280, kindred#2296). They get the *collapse* arm, but they leave
`Rejected` at zero, so a site reclassified in one of those gets **no rejection protection and
no warning**.

`persons.go` is the documented exception in the other direction: its household sweep needs no
guard, because `processBatchPersons` tracks a household from the same `id > 0` gate that
`transformHouseholdToPB` validates, upstream of the transform. See
`PersonsSync.deleteHouseholdOrphans`.

```go
// Wrap errors with context using fmt.Errorf and %w
if err != nil {
    return fmt.Errorf("fetching widgets page %d: %w", page, err)
}

// INFRASTRUCTURE failure: a database operation did not complete. Fails the run.
if err := s.App.Save(record); err != nil {
    slog.Error("Saving widget failed", "error", err, "cm_id", cmID)
    s.Stats.Errors++
    // Continue processing other records — but the run will report failed.
}

// PER-RECORD TRANSFORM failure: bad upstream data, no local fault. Warn-only.
// The `continue` skips TrackProcessedKey below, which is why the sweep has to
// refuse on Rejected > 0 (kindred#2295). Add the site to expectedRejectSites in
// rejection_sites_test.go in the same change, or the census fails.
if pbData, err := s.transformWidgetToPB(widgetData); err != nil {
    slog.Error("Error transforming widget", "error", err, "cm_id", cmID)
    s.Stats.Rejected++
    continue
}

// A wrapper that does BOTH stays on Errors: the call site cannot tell the two apart.
// processEnrollment (attendees.go) is the type case — it returns both
// `invalid or missing SessionID` and the result of ProcessCompositeRecord's App.Save.
// Splitting these needs typed errors from the wrappers — kindred#2292.

// wrapcheck linter exceptions in .golangci.yml:
// - github.com/pocketbase/pocketbase/tools/router (terminal HTTP responses)
// - github.com/camp/kindred/pocketbase/campminder (wrapped by callers)
```

## Linting Notes

Key linter configurations from `.golangci.yml`:

- **Line length**: 120 characters max (`lll`)
- **Cyclomatic complexity**: 15 max (`gocyclo`), relaxed for sync/ package
- **Duplication threshold**: 100 tokens (`dupl`), relaxed for sync/ package
- **Error wrapping**: Required by `wrapcheck` (exceptions for PocketBase router and CampMinder client)
- **Shadow detection**: Enabled via `govet.enable: shadow`
- **Exhaustive switches**: Required by `exhaustive` linter
- **Misspell**: US locale, with `cancelled` allowed as an exception
- **Build tags**: `pocketbase` tag required


## Year-scoped vs global collections

`PaginateRecords()` auto-adds a year filter for the collections that carry a `year` field, and
using the wrong helper for a collection silently reads or writes across years.

- **Year-scoped** (auto-filtered): `persons`, `camp_sessions`, `bunks`, `bunk_plans`,
  `bunk_assignments`, `attendees`
- **Global** (no `year` field): `session_groups`, `person_tag_definitions`,
  `custom_field_definitions` — use `PreloadRecordsGlobal()` and `ProcessSimpleRecordGlobal()`
  for these.

Year flows from the season env var and must be set on every year-scoped record:

```go
year := s.Client.GetSeasonID()  // From CAMPMINDER_SEASON_ID
recordData["year"] = year       // MUST be set on every record
```

## Orphan deletion is gated on a successful fetch

Orphan detection deletes records that were not seen during the sync. If the sync fails partway,
every record it had not yet reached looks like an orphan — so deletion is gated behind the
`SyncSuccessful` flag, which is only set once real data has come back:

```go
if page == 1 && len(results) > 0 {
    s.SyncSuccessful = true
}
```

Set it nowhere else. Setting it before the first successful page turns a transient API failure
into mass deletion.
