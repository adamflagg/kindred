package sync

import (
	"log/slog"
	"time"
)

// DateFormats lists the date formats that CampMinder may return, ordered from
// most specific to least specific. This shared list replaces the duplicated
// format arrays previously scattered across attendees.go, sessions.go,
// staff.go, and financial_transactions.go.
var DateFormats = []string{
	time.RFC3339,               // "2006-01-02T15:04:05Z07:00"
	time.RFC3339Nano,           // "2006-01-02T15:04:05.999999999Z07:00"
	"2006-01-02T15:04:05Z",     // ISO 8601 with literal Z
	"2006-01-02T15:04:05.000Z", // ISO 8601 with milliseconds
	"2006-01-02T15:04:05",      // ISO 8601 without timezone
	"2006-01-02",               // Date only
	"1/2/2006",                 // US format M/D/YYYY
	"01/02/2006",               // US format MM/DD/YYYY
}

// ParseDate parses a date string from CampMinder into the PocketBase DateTime
// format "2006-01-02 15:04:05Z". It tries each format in DateFormats in order.
//
// On success, the parsed time is converted to UTC and formatted without
// milliseconds for consistent comparison and idempotent syncing.
//
// On failure, it returns an empty string and logs a warning. Returning empty
// instead of the raw input prevents idempotency issues on re-sync (see #739).
func ParseDate(dateStr string) string {
	if dateStr == "" {
		return ""
	}

	for _, format := range DateFormats {
		if t, err := time.Parse(format, dateStr); err == nil {
			return t.UTC().Format("2006-01-02 15:04:05Z")
		}
	}

	slog.Warn("Failed to parse date, returning empty string",
		"raw_value", dateStr)
	return ""
}

// ParseDateValue is a convenience wrapper that accepts interface{} instead of
// string. It handles nil and non-string values gracefully. This replaces the
// financial_transactions.go parseDate which accepted interface{}.
func ParseDateValue(value interface{}) string {
	if value == nil {
		return ""
	}
	dateStr, ok := value.(string)
	if !ok || dateStr == "" {
		return ""
	}
	return ParseDate(dateStr)
}
