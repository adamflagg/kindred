package sync

import (
	"fmt"
	"os"
	"strconv"
)

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
	if year < 2017 || year > 2050 {
		return 0, fmt.Errorf("CAMPMINDER_SEASON_ID out of range (2017-2050): %d", year)
	}
	return year, nil
}
