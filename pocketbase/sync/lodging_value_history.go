package sync

import (
	"fmt"
	"log/slog"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

// Cabin-value change capture (kindred#2482).
//
// WHY THIS TABLE EXISTS
//
// `Family Camp Cabin` (cm_id 218072) is a HOUSEHOLD-grain custom field holding
// exactly one value per household per YEAR -- family_camp_registrations is
// UNIQUE on (household, year). A household attending two family weekends
// therefore has one slot for two answers, so when staff type the second
// weekend's cabin the first weekend's is gone. The assignment ingest cannot tell
// which weekend a string belongs to and files `ambiguous_session` rather than
// guessing (lodging_assignments_sync.go, "flag, do not guess (spec 3.6)").
//
// This table keeps what the source overwrites, so the question "which cabin was
// in effect for THIS weekend" becomes answerable from recorded observations
// instead of a timestamp heuristic. Nothing in this file derives a session --
// that read side is deliberately not built here, and no published value moves
// because of this capture.
//
// WHY NOT lodging_assignment_history
//
// It is already a per-change table, and it cannot serve this: ingestValue
// returns on `attr.Reason != attrSingleSession` BEFORE every writeHistory call,
// so it is blind in exactly the ambiguous case that needs it, and its organizing
// key is `session` -- the unknown. This table sits UPSTREAM of attribution.
//
// SHAPE NOTES (each a deliberate departure from attendee_status_history)
//
//   - No `session` column. It is required there; here it is the unknown.
//   - old_value/new_value are TEXT, not select. 88 distinct hand-typed cabin
//     strings exist across all years; a select would reject the first
//     unanticipated name and lose the change at the moment it matters. The same
//     reasoning is already written down for lodging_assignment_history's
//     old_unit/new_unit.
//   - Dual clock. source_changed_at is CampMinder's own last_updated;
//     observed_at is when this sync saw it. They are different facts, and the
//     retroactive-entry case needs both (21 of 2025's household cabin values
//     were last edited in December, after every 2025 weekend).
//   - The create branch writes too, as is_genesis. The first observed cabin is a
//     fact worth keeping; attendee_status_history logs only transitions.

// lodgingValueHistoryCollection is the append-only capture table created by
// pb_migrations/1500000165_lodging_value_history.js.
const lodgingValueHistoryCollection = "lodging_value_history"

// lodgingRetainedHistoryFields is the RETENTION SCOPE, ruled as cabin fields
// only: `Family Camp Cabin` (household grain) and `Reportable Family Camp Cabin`
// (person grain). The value is the display name stamped into source_field.
//
// The other lodging source fields -- bathroom, CPAP, infant, opt-out
// (lodging_fields.go) -- are held out NOT on the merits but because they are
// medical-adjacent, and api/routers/lodging.py records a deliberate ruling that
// that surface has no access log and that one was removed on purpose. Reversing
// that as a side effect of a cabin-attribution change would be the wrong way to
// reverse it. Dietary and transport answers are consumed once, when they are
// relevant; where people slept is the field with a historical question attached.
//
// Widening the scope later is an edit to THIS map. It needs no migration.
var lodgingRetainedHistoryFields = map[int]string{
	cmIDFamilyCampCabin:           fieldNameFamilyCampCabin,
	cmIDReportableFamilyCampCabin: fieldNameReportableFamilyCampCabin,
}

// lodgingValueObservation is one observed cabin-value change, on either grain.
// Exactly one of HouseholdCMID / PersonCMID is set; the other stays 0, which is
// what keeps the two grains in one table without a nullable relation.
type lodgingValueObservation struct {
	Year          int
	FieldCMID     int
	HouseholdCMID int
	PersonCMID    int

	OldValue string
	NewValue string

	// SourceChangedAt is CampMinder's last_updated for the value, verbatim. It
	// is stored as text rather than parsed: CampMinder free-text date handling
	// elsewhere in this repo has produced 7+ formats, and a strict parse that
	// fails would discard the change rather than the timestamp.
	SourceChangedAt string

	// IsGenesis marks the first observation of a value rather than a transition.
	IsGenesis bool
}

// recordLodgingValueChange appends one observation to lodging_value_history.
//
// It is a no-op for a field outside the retention scope, and for a genesis
// observation of an empty value (a household with no cabin recorded yet is not a
// fact about where anyone slept; a change TO empty still is, and takes the
// transition path).
//
// Re-observing the same change is idempotent: the table carries a unique index
// on (year, field_cm_id, household_cm_id, person_cm_id, source_changed_at,
// new_value), and this checks for the row before inserting so a re-run neither
// duplicates nor produces a constraint error to swallow.
func recordLodgingValueChange(app core.App, obs *lodgingValueObservation) error {
	sourceField, retained := lodgingRetainedHistoryFields[obs.FieldCMID]
	if !retained {
		return nil
	}
	if obs.IsGenesis && obs.NewValue == "" {
		return nil
	}

	collection, err := app.FindCollectionByNameOrId(lodgingValueHistoryCollection)
	if err != nil {
		return fmt.Errorf("finding %s collection: %w", lodgingValueHistoryCollection, err)
	}

	const dedupe = "year = {:year} && field_cm_id = {:field} && household_cm_id = {:household} && " +
		"person_cm_id = {:person} && source_changed_at = {:changed} && new_value = {:new}"
	params := map[string]any{
		"year": obs.Year, "field": obs.FieldCMID, "household": obs.HouseholdCMID,
		"person": obs.PersonCMID, "changed": obs.SourceChangedAt, "new": obs.NewValue,
	}
	existing, err := app.FindRecordsByFilter(lodgingValueHistoryCollection, dedupe, "", 1, 0, params)
	if err != nil {
		return fmt.Errorf("checking for an existing %s row: %w", lodgingValueHistoryCollection, err)
	}
	if len(existing) > 0 {
		return nil
	}

	record := core.NewRecord(collection)
	record.Set("year", obs.Year)
	record.Set("field_cm_id", obs.FieldCMID)
	record.Set("household_cm_id", obs.HouseholdCMID)
	record.Set("person_cm_id", obs.PersonCMID)
	record.Set("source_field", sourceField)
	record.Set("old_value", obs.OldValue)
	record.Set("new_value", obs.NewValue)
	record.Set("source_changed_at", obs.SourceChangedAt)
	record.Set("observed_at", time.Now().UTC().Format("2006-01-02 15:04:05.000Z"))
	record.Set("is_genesis", obs.IsGenesis)

	if err := app.Save(record); err != nil {
		return fmt.Errorf("saving %s row: %w", lodgingValueHistoryCollection, err)
	}
	return nil
}

// logLodgingValueChange is the call-site wrapper: capture is non-critical, so a
// failure is logged and the custom-values sync carries on, mirroring how
// attendees.go treats logStatusChange.
//
// DryRun is honored STRUCTURALLY rather than by a flag check here -- both call
// sites sit after the custom-values App.Save, which DryRun returns before, so a
// dry run cannot reach this at all.
func logLodgingValueChange(app core.App, obs *lodgingValueObservation) {
	if err := recordLodgingValueChange(app, obs); err != nil {
		slog.Warn("Failed to record lodging value change",
			"field_cm_id", obs.FieldCMID,
			"household_cm_id", obs.HouseholdCMID,
			"person_cm_id", obs.PersonCMID,
			"year", obs.Year,
			"is_genesis", obs.IsGenesis,
			"error", err)
	}
}
