package sync

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

// Registration-ask history (PR 4a). Aid intake reads it (api/services/financial_aid_registration_ask.py)
// to tie each captured ask to the registration it was typed at; nothing in it is shown to staff
// directly.
//
// WHY IT EXISTS. CampMinder keeps ONE registration ask per camper per season in the
// person custom field CA-FinancialAssistanceAmount, and a later registration overwrites it.
// This keeps our own dated copy so a later rule can attribute an ask to the registration it
// was typed at. The adult-weekend slot (WW-FA Amount) has the same one-slot shape, so both are
// captured.
//
// Two writers, one table:
//   - recordAskObservation, called from the custom-values hook (person_custom_field_values.go)
//     at the same two call sites as logLodgingValueChange.
//   - reconcileAskHistory, run by the FA applications job, which seeds the current slot and
//     heals a hook failure, so the newest history row always equals today's slot.
//
// DELIBERATE DIFFERENCE FROM lodging_value_history: a row is written when the value OR
// last_updated changes. A re-date at an unchanged amount is CampMinder saying "asked again at
// a new registration", which is exactly the evidence attribution needs.
//
// It is a focused copy of recordLodgingValueChange rather than a shared recorder: the two
// tables differ in grain (person only here), columns (amount, observed_by) and retention
// scope, and sharing would have meant parameterising all three.

// aidRegistrationAskHistoryCollection is created by
// pb_migrations/1500000246_aid_registration_ask_history.js. All five rules are null.
const aidRegistrationAskHistoryCollection = "aid_registration_ask_history"

// CampMinder custom-field DEFINITION ids (configuration, not person ids).
const (
	cmIDCAFinancialAssistanceAmount = 28906  // "CA-FinancialAssistanceAmount"
	cmIDWWFinancialAssistanceAmount = 209090 // "WW-FA Amount"
)

// aidAskHistoryFloorYear is the first season the table records (owner ruling: "2024 and prior
// dont need aid lists"). Only intake reads these rows, and intake takes in no season before
// AID_INTAKE_FLOOR_YEAR in api/services/financial_aid_intake_service.py; keep the two equal.
// The FA applications mirror is not floored, only this history.
const aidAskHistoryFloorYear = 2025

// aidAskFields is the retention scope: the two ask-amount fields.
var aidAskFields = map[int]bool{
	cmIDCAFinancialAssistanceAmount: true,
	cmIDWWFinancialAssistanceAmount: true,
}

// askObservation is one observed ask value.
type askObservation struct {
	Year       int
	FieldCMID  int
	PersonCMID int

	OldValue string
	NewValue string

	// SourceChangedAt is CampMinder's last_updated verbatim (text, so a failed parse
	// cannot lose the row).
	SourceChangedAt string

	// ObservedBy is the job that saw it: person_custom_values,
	// person_custom_values_family_camp or financial_aid_applications.
	ObservedBy string

	// IsGenesis is the first value THIS TABLE holds for the key: a floor on what is known,
	// not proof nothing came before.
	IsGenesis bool

	// IgnoreOldValue makes the already-recorded check compare (source_changed_at,
	// new_value) alone against the newest row. The reconcile uses it so a hook-written transition counts as present.
	IgnoreOldValue bool
}

// askRecorded reports whether the candidate duplicates the NEWEST row for the key. Only the
// newest row counts: the table is an append-only change history, so an A -> B -> A -> B walk
// must keep its second A -> B even when an older row matches it (an empty or repeated
// last_updated makes that routine). Order is created (millisecond autodate) with @rowid as the
// tiebreak, because PocketBase ids are random and cannot order two rows in the same ms.
func askRecorded(app core.App, obs *askObservation) (bool, error) {
	params := map[string]any{"year": obs.Year, "field": obs.FieldCMID, "person": obs.PersonCMID}
	filter := "year = {:year} && field_cm_id = {:field} && person_cm_id = {:person}"
	newest, err := app.FindRecordsByFilter(aidRegistrationAskHistoryCollection, filter, "-created,-@rowid", 1, 0, params)
	if err != nil {
		return false, fmt.Errorf("checking for an existing %s row: %w", aidRegistrationAskHistoryCollection, err)
	}
	if len(newest) == 0 {
		return false, nil
	}
	n := newest[0]
	if n.GetString("source_changed_at") != obs.SourceChangedAt || n.GetString("new_value") != obs.NewValue {
		return false, nil
	}
	return obs.IgnoreOldValue || n.GetString("old_value") == obs.OldValue, nil
}

// recordAskObservation appends one observation, idempotently. A no-op outside the retention
// scope, for a season before aidAskHistoryFloorYear, and for a genesis observation of an empty
// value.
func recordAskObservation(app core.App, obs *askObservation) error {
	if !aidAskFields[obs.FieldCMID] || obs.Year < aidAskHistoryFloorYear {
		return nil
	}
	if obs.IsGenesis && obs.NewValue == "" {
		return nil
	}
	collection, err := app.FindCollectionByNameOrId(aidRegistrationAskHistoryCollection)
	if err != nil {
		return fmt.Errorf("finding %s collection: %w", aidRegistrationAskHistoryCollection, err)
	}
	present, err := askRecorded(app, obs)
	if err != nil {
		return err
	}
	if present {
		return nil
	}

	record := core.NewRecord(collection)
	record.Set("year", obs.Year)
	record.Set("field_cm_id", obs.FieldCMID)
	record.Set("person_cm_id", obs.PersonCMID)
	record.Set("old_value", obs.OldValue)
	record.Set("new_value", obs.NewValue)
	// The same parse the mirror uses, so there is one rule for both.
	record.Set("amount", parseNumberValue(obs.NewValue))
	record.Set("source_changed_at", obs.SourceChangedAt)
	record.Set("observed_at", time.Now().UTC().Format("2006-01-02 15:04:05.000Z"))
	record.Set("observed_by", obs.ObservedBy)
	record.Set("is_genesis", obs.IsGenesis)
	if err := app.Save(record); err != nil {
		return fmt.Errorf("saving %s row: %w", aidRegistrationAskHistoryCollection, err)
	}
	return nil
}

// logAskChange is the non-critical call-site wrapper: a failure is logged and the sync
// carries on. DryRun is honored structurally (both call sites sit after App.Save).
func logAskChange(app core.App, obs *askObservation) {
	if err := recordAskObservation(app, obs); err != nil {
		slog.Warn("Failed to record registration ask",
			"field_cm_id", obs.FieldCMID, "person_cm_id", obs.PersonCMID,
			"year", obs.Year, "is_genesis", obs.IsGenesis, "error", err)
	}
}

// reconcileAskHistory appends a genesis row for every current ask value (28906 / 209090) of
// the season whose (source_changed_at, value) differs from the newest history row. It seeds the table, heals a
// hook failure, and keeps the newest history row equal to today's slot. Non-dry-run only.
func (s *FinancialAidApplicationsSync) reconcileAskHistory(
	ctx context.Context, year int, personInfo map[string]*personInfoEntry,
) error {
	if year < aidAskHistoryFloorYear {
		slog.Info("Registration-ask history skipped: the season is before the aid intake floor",
			"year", year, "floor", aidAskHistoryFloorYear)
		return nil
	}
	defs, err := s.App.FindRecordsByFilter("custom_field_defs",
		"cm_id = {:ca} || cm_id = {:ww}", "", 0, 0,
		map[string]any{"ca": cmIDCAFinancialAssistanceAmount, "ww": cmIDWWFinancialAssistanceAmount})
	if err != nil {
		return fmt.Errorf("finding ask field definitions: %w", err)
	}
	fieldCM := make(map[string]int, len(defs)) // field_definition PB id -> field cm_id
	for _, d := range defs {
		fieldCM[d.Id] = d.GetInt("cm_id")
	}
	if len(fieldCM) == 0 {
		return nil
	}

	// Only the ask fields' rows: scanning every custom value of the season on each nightly
	// run would page through the whole table to look at two fields.
	filter := fmt.Sprintf("year = %d && (", year)
	fparams := make(map[string]any, len(fieldCM))
	i := 0
	for id := range fieldCM {
		if i > 0 {
			filter += " || "
		}
		key := fmt.Sprintf("fd%d", i)
		filter += "field_definition = {:" + key + "}"
		fparams[key] = id
		i++
	}
	filter += ")"
	const perPage = 500
	for page := 1; ; page++ {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}
		records, err := s.App.FindRecordsByFilter(
			"person_custom_values", filter, sortByID, perPage, (page-1)*perPage, fparams)
		if err != nil {
			return fmt.Errorf("querying person custom values page %d: %w", page, err)
		}
		for _, r := range records {
			cm, ok := fieldCM[r.GetString("field_definition")]
			if !ok || r.GetString("value") == "" {
				continue
			}
			info := personInfo[r.GetString("person")]
			if info == nil || info.cmID < 1 {
				continue
			}
			logAskChange(s.App, &askObservation{
				Year: year, FieldCMID: cm, PersonCMID: info.cmID,
				NewValue: r.GetString("value"), SourceChangedAt: r.GetString("last_updated"),
				ObservedBy: serviceNameFinancialAidApplications, IsGenesis: true, IgnoreOldValue: true,
			})
		}
		if len(records) < perPage {
			return nil
		}
	}
}
