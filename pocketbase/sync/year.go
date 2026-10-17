package sync

import (
	"fmt"
	"os"
	"slices"
	"strconv"
	"time"
	_ "time/tzdata" // the season rule needs America/Los_Angeles on a minimal image
)

// syncYearMin and syncYearMax bound every year the sync layer accepts, whether it arrives
// from CAMPMINDER_SEASON_ID or from an operator's `?year=` parameter.
//
// The sync_runs.year column is deliberately wider (2000–2100, see
// pb_migrations/1500000152_sync_runs.js). It is a storage sanity bound, not the business
// rule, and it has to strictly contain this range: a year that passes here and fails there
// is not rejected at the request, it is accepted and then silently drops every row of the
// run, because the write path logs the rejection and swallows it. Widen this range and the
// column's has to be widened first.
const (
	syncYearMin = 2017
	syncYearMax = 2050
)

// ValidSyncYear reports whether year is one the sync layer will accept.
func ValidSyncYear(year int) bool {
	return year >= syncYearMin && year <= syncYearMax
}

// The season rolls over at the start of Oct 15 in camp's timezone (owner ruling, 2026-10-14:
// "oct 15 works"; "oct 15 gates all"). A constant, not configuration: if camp's calendar ever
// moves, it is a one-line PR (the project prefers code constants to rarely-tuned knobs).
const (
	seasonRolloverMonth = time.October
	seasonRolloverDay   = 15
)

var seasonLocation = func() *time.Location {
	loc, err := time.LoadLocation("America/Los_Angeles")
	if err != nil {
		panic("season rule: America/Los_Angeles unavailable (is time/tzdata imported?): " + err.Error())
	}
	return loc
}()

// nowFn is the rule's clock; tests replace it.
var nowFn = time.Now

// overrideSeason reads CAMPMINDER_SEASON_ID. ok=false when unset; err when set but invalid.
func overrideSeason() (year int, ok bool, err error) {
	yearStr := os.Getenv("CAMPMINDER_SEASON_ID")
	if yearStr == "" {
		return 0, false, nil
	}
	year, err = strconv.Atoi(yearStr)
	if err != nil {
		return 0, true, fmt.Errorf("CAMPMINDER_SEASON_ID invalid: %q: %w", yearStr, err)
	}
	if !ValidSyncYear(year) {
		return 0, true, fmt.Errorf("CAMPMINDER_SEASON_ID out of range (%d-%d): %d", syncYearMin, syncYearMax, year)
	}
	return year, true, nil
}

// PrimarySeason is the season the app treats as current: CAMPMINDER_SEASON_ID when set (an
// optional override), otherwise next year from Oct 15 in Pacific time, and this year before it.
func PrimarySeason(now time.Time) (int, error) {
	if y, ok, err := overrideSeason(); ok {
		return y, err
	}
	t := now.In(seasonLocation)
	rollover := time.Date(t.Year(), seasonRolloverMonth, seasonRolloverDay, 0, 0, 0, 0, seasonLocation)
	if !t.Before(rollover) {
		return t.Year() + 1, nil
	}
	return t.Year(), nil
}

// SyncedSeasons is every season the scheduled runs cover, primary first: [N, N-1].
func SyncedSeasons(now time.Time) ([]int, error) {
	p, err := PrimarySeason(now)
	if err != nil {
		return nil, err
	}
	return syncedSeasonsFor(p), nil
}

// syncedSeasonsFor is SyncedSeasons for a known primary season.
func syncedSeasonsFor(primary int) []int {
	return []int{primary, primary - 1}
}

// isClosedSeason reports whether year is a CLOSED season at now: older than every season the
// scheduled runs cover (SyncedSeasons), so 2025 and before once 2027 is the primary. CampMinder
// answers a closed season with today's households, so a re-read of one must not rewrite that
// season's family structure (closed_season_freeze.go). A season that cannot be resolved (an
// invalid CAMPMINDER_SEASON_ID override) counts as closed: freezing is the side that loses nothing.
func isClosedSeason(year int, now time.Time) bool {
	primary, err := PrimarySeason(now)
	if err != nil {
		return true
	}
	return isClosedSeasonFor(year, primary)
}

// isClosedSeasonFor is isClosedSeason for a known primary season.
func isClosedSeasonFor(year, primary int) bool {
	return year < slices.Min(syncedSeasonsFor(primary))
}

// SeasonSource says where the primary came from, for Manage > Sync.
func SeasonSource() string {
	if _, ok, _ := overrideSeason(); ok {
		return "override"
	}
	return "rule"
}

// ParseSeasonYear returns the primary season. Kept by name so its callers need no change; it
// no longer requires CAMPMINDER_SEASON_ID.
func ParseSeasonYear() (int, error) {
	return PrimarySeason(nowFn())
}

// seasonConfigProblem reports a season configuration error: only an invalid
// CAMPMINDER_SEASON_ID override; an unset variable is fine now that the rule supplies one.
func seasonConfigProblem() error {
	_, err := ParseSeasonYear()
	return err
}
