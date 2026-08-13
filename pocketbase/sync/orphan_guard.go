package sync

import "fmt"

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
	// enrolment attrition is single-digit percentages, and a season rollover
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
	// BaseSyncService fills this in from its own Stats, so the sweeps that route
	// through DeleteOrphans / DeleteOrphansGuarded / DeleteOrphansFromPreloaded
	// get it without a call site having to remember. A hand-rolled sweep -- there
	// is one, PersonsSync.deleteHouseholdOrphans -- has to set it itself.
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
// set is short", and the honest answer to that must not fail anything:
// Stats.Rejected is warn-only for its first season (kindred#2284), and a returned
// error would also abort the rest of a multi-collection service -- one malformed
// program area would stop staff positions and org categories syncing at all.
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

	return fmt.Sprintf(
		"skipping the %s sweep for year %d: %d record(s) were rejected this run, so their keys "+
			"are missing from the computed set and their stored rows would be read as orphans",
		g.Entity, g.Year, g.Rejected)
}
