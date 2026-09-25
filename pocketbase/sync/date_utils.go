package sync

import (
	"log/slog"
	"strings"
	"time"

	// campMinderLocation below calls time.LoadLocation("America/Denver"). PocketBase ships
	// on chainguard/static, which carries no guarantee of /usr/share/zoneinfo, and a
	// LoadLocation that silently failed would read every CampMinder timestamp as UTC again
	// -- the exact bug this file fixes. Embedding the database costs ~450KB and removes the
	// dependency on the base image entirely. Also imported in family_camp_roster_sheet.go;
	// importing it here too makes this file's own dependency explicit.
	_ "time/tzdata"
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

// ParseDateValue is a convenience wrapper that accepts any instead of
// string. It handles nil and non-string values gracefully. This replaces the
// financial_transactions.go parseDate which accepted interface{}.
func ParseDateValue(value any) string {
	if value == nil {
		return ""
	}
	dateStr, ok := value.(string)
	if !ok || dateStr == "" {
		return ""
	}
	return ParseDate(dateStr)
}

// campMinderZone is the zone of CampMinder's API timestamps. The API appends "Z", but the
// wall clock is US Mountain time (campership design §6.2), so reading the "Z" literally
// stores every timestamp 6-7 hours early.
const campMinderZone = "America/Denver"

// campMinderMSTFallback is the fallback when campMinderZone cannot be loaded: fixed
// Mountain Standard Time, UTC-7 year round. It is off by at most one hour during MDT
// (mid-March to early November), against the 6-7 hours a literal-UTC read is off by --
// see ParseCampMinderInstant's doc comment for the failure this whole file exists to fix.
var campMinderMSTFallback = time.FixedZone("MST", -7*60*60)

// loadCampMinderLocation loads campMinderZone via load, falling back to
// campMinderMSTFallback on failure. It never panics: this package is imported by
// main.go, so a panic in a package-level initializer would crash the entire
// PocketBase server at startup over a timestamp-formatting concern. With time/tzdata
// embedded (see the import above), the failure path is not expected to run in
// production; it exists for the day that import is removed or the embedded data is
// somehow incomplete, and a loud, non-fatal fallback beats a wrong instant that
// still shipped and a crash that took down sync, RBAC and everything else with it.
func loadCampMinderLocation(load func(string) (*time.Location, error)) *time.Location {
	loc, err := load(campMinderZone)
	if err != nil {
		slog.Error("could not load CampMinder timezone, reading timestamps as fixed MST",
			"zone", campMinderZone, "fallback", "MST (UTC-7, no DST)", "error", err)
		return campMinderMSTFallback
	}
	return loc
}

// campMinderLocation is loaded once at package init.
var campMinderLocation = loadCampMinderLocation(time.LoadLocation)

// ParseCampMinderInstant converts a CampMinder API timestamp to PocketBase's UTC format
// "2006-01-02 15:04:05Z".
//
// Not named ParseCampMinderTimestamp: sync/lodging_session_attribution.go already declares
// a function of that name, with a different signature, for a different column
// (household_custom_values.last_updated / person_custom_values.last_updated). That one keeps
// its literal-UTC reading -- untouched by this task.
//
//   - "...Z", "...+00:00", "...-00:00" or no zone: the wall clock is Mountain time. It is
//     read in America/Denver, which applies MST or MDT for that date, then converted.
//   - A non-zero numeric offset ("-05:00"): honored as written.
//   - Anything else, such as a US-style date: ParseDate's fallbacks.
//
// In the fall-back hour a wall clock names two instants and Go picks the first (daylight)
// one; TestParseCampMinderInstant pins that. Use this for true instants only. A calendar
// date (service_start_date, effective_date) stays on ParseDate, because midnight must not
// become 06:00 UTC.
func ParseCampMinderInstant(value any) string {
	s, ok := value.(string)
	if !ok {
		return ""
	}
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}

	wall, zeroOffset := s, false
	for _, suffix := range []string{"Z", "+00:00", "-00:00"} {
		if trimmed, found := strings.CutSuffix(s, suffix); found {
			wall, zeroOffset = trimmed, true
			break
		}
	}
	if !zeroOffset {
		if t, err := time.Parse(time.RFC3339Nano, s); err == nil {
			return t.UTC().Format("2006-01-02 15:04:05Z")
		}
	}
	// Parsing accepts a fractional second after :05 even though the layout omits it.
	for _, layout := range []string{"2006-01-02T15:04:05", "2006-01-02"} {
		if t, err := time.ParseInLocation(layout, wall, campMinderLocation); err == nil {
			return t.UTC().Format("2006-01-02 15:04:05Z")
		}
	}
	return ParseDate(s)
}
