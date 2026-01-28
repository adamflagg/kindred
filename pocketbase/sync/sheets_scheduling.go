package sync

import (
	"fmt"
	"strconv"
	"strings"
)

// GoogleSheetsExportOptions configures export behavior
type GoogleSheetsExportOptions struct {
	IncludeGlobals  bool  // Export global tables (globals-*)
	IncludeYearData bool  // Export year-specific tables ({year}-*)
	Years           []int // Specific years to export (empty = current year)
}

// NewGoogleSheetsExportOptions creates default export options
func NewGoogleSheetsExportOptions() *GoogleSheetsExportOptions {
	return &GoogleSheetsExportOptions{
		IncludeGlobals:  true,
		IncludeYearData: true,
		Years:           []int{},
	}
}

// ParseExportYearsParam parses a comma-separated years parameter
func ParseExportYearsParam(param string) ([]int, error) {
	if param == "" {
		return []int{}, nil
	}

	parts := strings.Split(param, ",")
	years := make([]int, 0, len(parts))

	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}

		year, err := strconv.Atoi(p)
		if err != nil {
			return nil, fmt.Errorf("invalid year: %s", p)
		}
		years = append(years, year)
	}

	return years, nil
}

// ValidateExportYears validates the years list for export
func ValidateExportYears(years []int, maxYear int) error {
	const minYear = 2017
	const maxYearsPerRequest = 5

	if len(years) > maxYearsPerRequest {
		return fmt.Errorf("too many years: max %d per request", maxYearsPerRequest)
	}

	for _, year := range years {
		if year < minYear {
			return fmt.Errorf("year %d is too old (minimum: %d)", year, minYear)
		}
		if year > maxYear {
			return fmt.Errorf("year %d is in the future (maximum: %d)", year, maxYear)
		}
	}

	return nil
}
