package sync

import (
	"fmt"
	"os"
	"strconv"
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

// ParseSeasonYear reads and validates the CAMPMINDER_SEASON_ID env var.
// Returns an error if the value is missing, non-numeric, or outside 2017–2050.
func ParseSeasonYear() (int, error) {
	yearStr := os.Getenv("CAMPMINDER_SEASON_ID")
	if yearStr == "" {
		return 0, fmt.Errorf("CAMPMINDER_SEASON_ID not set")
	}
	year, err := strconv.Atoi(yearStr)
	if err != nil {
		return 0, fmt.Errorf("CAMPMINDER_SEASON_ID invalid: %q: %w", yearStr, err)
	}
	if !ValidSyncYear(year) {
		return 0, fmt.Errorf("CAMPMINDER_SEASON_ID out of range (%d-%d): %d",
			syncYearMin, syncYearMax, year)
	}
	return year, nil
}
