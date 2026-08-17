package sync

import (
	"context"
	"errors"
	"fmt"
)

// Orphan-sweep thresholds (kindred#2279).
//
// An orphan sweep deletes every row on disk that this run's computed set does
// not account for. That is correct when the computed set is trustworthy and
// catastrophic when it is not: an upstream mapping that comes back empty or
// short turns the sweep into a mass delete, and the sync reports success
// afterwards because nothing in the run failed.
//
// The shipped guard caught only a TOTAL collapse -- computed set empty, rows on
// disk. A PARTIAL collapse (5 computed against 300 on disk) sailed past it and
// deleted the other 295. These two constants are what widen "empty" to
// "suspiciously small".
const (
	// OrphanSweepRatioFloor is the share of the rows on disk that this run's
	// computed set must cover for a sweep to proceed.
	//
	// 0.5 is a judgement call, chosen to sit far above real churn and far below
	// any plausible collapse. A run that computes fewer than half the rows
	// already stored is asserting that more than half of a season disappeared
	// from CampMinder between two syncs. No product workflow does that:
	// enrollment attrition is single-digit percentages, and a season rollover
	// lands in a new `year` partition rather than shrinking an existing one.
	// Meanwhile the failure this guards against -- a staff or person lookup that
	// returns a fraction of its rows after a timeout or a mid-page API error --
	// lands far below 0.5. Tune it here; it is read in exactly one place.
	OrphanSweepRatioFloor = 0.5

	// OrphanSweepMinRows is the point below which the ratio carries no signal
	// and only the empty-computed-set rule applies.
	//
	// A table holding four rows can legitimately lose three; a table holding
	// hundreds cannot. Without this floor the guard would refuse legitimately
	// small early-season syncs, where a handful of rows exist and the shape of
	// the season is still changing week to week -- exactly the runs an operator
	// needs to succeed unattended.
	OrphanSweepMinRows = 20
)

// OrphanSweepGuard refuses an orphan sweep whose computed set is too small to be
// believed. It is the single implementation behind every guarded sweep in this
// package: staff_vehicle_info and staff_applications shipped one hand-written
// copy each (kindred#2273, kindred#2279 Gap 2), and rather than write a
// fifteenth, every guarded service now fills in this struct.
//
// The COLLAPSE arm reaches every sweep in the package. BaseSyncService fills this
// struct in for the sweeps it owns, and the ten services that do not embed it --
// camper_dietary, camper_history, camper_transportation, family_camp_derived,
// household_demographics, normalize_geographic, quest_registrations, staff_skills,
// staff_applications and staff_vehicle_info -- each construct one inside their own
// deleteOrphans (kindred#2280, kindred#2296). family_camp_derived is the tenth and
// the last to arrive: it performs THREE sweeps rather than one, so it builds three
// guards, one per derived table.
//
// The REJECTION arm is narrower, and that is the part to watch. Only BaseSyncService
// fills in Rejected, so for those ten SkipReason and RejectionsExplainShortfall can
// never fire -- they build the guard without it. That is harmless today because none
// of them counts a rejection, and nothing pins it: a future reclassification into one
// of those files gets the collapse guard but no rejection protection and no warning.
//
// Computed is the size of the set this run built from CampMinder, NOT the number
// of rows on disk it happens to match. The distinction matters: a healthy run can
// legitimately share no keys at all with what is stored -- one person leaves and
// another arrives -- so an empty intersection is not evidence of anything, while
// an empty or short computed set is.
type OrphanSweepGuard struct {
	// Entity names the collection in the refusal, so an operator reading a log
	// knows which sweep stopped.
	Entity string
	// Year names the season, for the same reason.
	Year int
	// Computed is the number of entries in this run's computed set.
	Computed int
	// Rejected is how many upstream records this run refused to turn into rows.
	// Non-zero means the computed set is known-incomplete for a reason that has
	// nothing to do with CampMinder, and SkipReason abandons the sweep on it.
	//
	// BaseSyncService fills this in from its own Stats, so every sweep that routes
	// through DeleteOrphans / DeleteOrphansGuarded / DeleteOrphansFromPreloaded gets
	// it without a call site having to remember -- which is every sweep a rejecting
	// service performs today. A hand-rolled sweep would have to set it itself, after
	// checking it is actually exposed: PersonsSync.deleteHouseholdOrphans is not,
	// because it builds its key set upstream of the transform that rejects.
	Rejected int
	// Hint points at the upstream that produces this service's computed set --
	// the place an operator has to look. Optional.
	Hint string
}

// Check reports whether sweeping `existing` rows against g.Computed is safe.
// A non-nil error means the caller must delete nothing and surface the error.
func (g OrphanSweepGuard) Check(existing int) error {
	if existing <= 0 {
		return nil // nothing on disk, so there is no sweep to refuse
	}

	// Arm 1: total collapse. An empty computed set against any populated year is
	// always a broken input -- there is no legitimate "CampMinder returned
	// nothing" -- so this arm applies at every table size.
	refuse := g.Computed == 0

	// Arm 2: partial collapse, only where a ratio means something.
	if !refuse && existing >= OrphanSweepMinRows {
		refuse = float64(g.Computed) < OrphanSweepRatioFloor*float64(existing)
	}

	if !refuse {
		return nil
	}

	msg := fmt.Sprintf(
		"refusing to sweep %d existing %s rows for year %d against a computed set of %d "+
			"(%.1f%% of what is on disk, floor %.0f%%)",
		existing, g.Entity, g.Year, g.Computed,
		float64(g.Computed)*100/float64(existing), OrphanSweepRatioFloor*100)

	if g.Hint != "" {
		msg += ": " + g.Hint
	}

	return fmt.Errorf("%s", msg)
}

// SkipReason returns a non-empty explanation when the sweep must be abandoned
// WITHOUT failing the run, or "" to proceed. It is a separate verdict from Check,
// and the difference is the point (kindred#2295).
//
// Check answers "is the computed set believable" and reports a collapse as an
// error, which fails the run. SkipReason answers "do we already know the computed
// set is short", and the honest answer to that must not fail anything, because
// Stats.Rejected is warn-only for its first season (kindred#2284): one malformed
// record out of 156,669 must not turn a run red.
//
// That is the whole justification, and it is worth being precise about what it is
// NOT. An earlier revision of this comment also claimed a returned error would
// abort the rest of a multi-collection service. It would not: staff_lookups and
// financial_lookups log a DeleteOrphans error and `return nil`, so the later
// collections sync regardless (staff_lookups.go, syncProgramAreas). The warn-only
// grounds stand on their own; that second argument was false.
//
// Why a rejection is a skip rather than a smaller sweep. A rejected record's key
// never reaches TrackProcessedKey: the counter bump and its `continue` both
// happen first. So its existing row reads as an orphan and the sweep deletes the
// good value stored by the last run. Tracking the rejected key instead, and
// sweeping the rest, was considered and rejected -- the `Invalid ... cm_id` branch
// fires precisely BECAUSE there is no usable key, so key-tracking can only ever
// cover half the sites, and half a fix that looks whole is worse than a blunt
// honest one.
//
// The cost is real and deliberate: a collection with a persistently malformed
// record is never swept, and genuine orphans accumulate. That is visible as a
// service sitting at rejected > 0 run after run, which is the signal to go fix
// the upstream data. There is no separate alerting path for it.
func (g OrphanSweepGuard) SkipReason() string {
	if g.Rejected <= 0 {
		return ""
	}

	// Year is unset on the unguarded entry points -- DeleteOrphans and
	// DeleteOrphansFromPreloaded take no year -- so five per-year services would
	// otherwise be told their sweep stopped "for year 0". Naming no season is
	// honest; naming a wrong one sends an operator to the wrong data.
	season := ""
	if g.Year != 0 {
		season = fmt.Sprintf(" for year %d", g.Year)
	}

	return fmt.Sprintf(
		"skipping the %s sweep%s: %d record(s) were rejected this run, so their keys "+
			"are missing from the computed set and their stored rows would be read as orphans",
		g.Entity, season, g.Rejected)
}

// RejectionsExplainShortfall reports whether this run's rejections are enough to
// account for every stored row the computed set fails to cover. It decides whether
// a Check refusal is REAL, and it needs no guessed threshold -- either the
// arithmetic works out or it does not (kindred#2299).
//
// The problem it solves: skipping on Rejected > 0 alone, ahead of Check, means one
// rejection alongside an entirely unrelated collapse turns a run-failing error into
// a benign warning. Running Check first instead is no better -- it fails the run
// whenever the rejections themselves are what made the computed set short, which is
// precisely what warn-only forbids.
//
// So Check still runs and its refusal still stands, unless the rejections account
// for the whole shortfall. Each rejection removes exactly one key from the computed
// set, so `Rejected` is an exact upper bound on how much of the shortfall they can
// explain. A shortfall of zero or less -- a computed set at least as large as the
// rows on disk -- is trivially explained.
//
// KNOWN RESIDUAL RISK (kindred#2325): "each rejection removes exactly one key"
// stopped being universally true the moment person_custom_field_values.go and
// household_custom_field_values.go started rejecting a SECOND entry for a key
// already tracked this run (kindred#2320's duplicate-in-run guard). That
// rejection bumps Rejected without shrinking Computed -- the key it
// "corresponds to" was never missing. Enough of those landing in the same run
// as an unrelated genuine shortfall of comparable size could make this
// arithmetic wave through a refusal it should not.
//
// This is left as documented risk rather than a second counter that tracks
// "rejections that did / didn't remove a key" (which means reopening the shared
// contract every guarded sweep reads, not just the two files kindred#2320
// touched), because the failure is ONE-WAY and cannot delete anything:
// deleteOrphans (base_sync.go) never acts on a masked refusal directly --
// skipSweepForRejections runs right after, unconditionally on Rejected > 0, and
// IT decides whether the sweep proceeds. A duplicate-inflated mask can only
// turn a run that should fail loud into one that logs a warning; it can never
// turn into a delete.
// TestDuplicateInflatedRejectionsCannotDeleteDespiteMaskingACollapse
// (orphan_guard_test.go) pins that half of the property. Today Rejected from
// the duplicate guard is 0 in every real run -- CampMinder packs multi-selects
// into one delimited value rather than repeating a field id -- so the compound
// precondition this needs has never actually occurred.
func (g OrphanSweepGuard) RejectionsExplainShortfall(existing int) bool {
	return existing-g.Computed <= g.Rejected
}

// wrapOrphanSweepError classifies a failed orphan sweep for the caller's return.
//
// A guard refusal and a cancelled context are different operational facts and
// must not share a message: "refused" says the computed set is not to be
// trusted and points an operator at the CampMinder feed, while "interrupted"
// says the run simply ran out of time and the data is probably fine. Reporting
// the second as the first sends them to investigate something that is not
// broken.
//
// kindred#2280 settled this wording on staff_vehicle_info.go and
// staff_applications.go; it lives here so every guarded sweep in the package
// reads the same rather than carrying its own copy. Returns nil for nil so it
// is safe to call unconditionally.
func wrapOrphanSweepError(err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return fmt.Errorf("orphan sweep interrupted: %w", err)
	}
	return fmt.Errorf("orphan sweep refused: %w", err)
}
