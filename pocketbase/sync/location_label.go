package sync

import (
	"regexp"
	"strings"
)

// locationStateSuffix matches the trailing ", CA" that normalized_city
// carries when the geo-normalization sync (normalize_geographic.go) has
// written it. Two uppercase letters only: "Washington, District" is a city,
// not a state suffix.
var locationStateSuffix = regexp.MustCompile(`,\s*[A-Z]{2}$`)

// PersonLocation composes a person's display-ready "City, ST" label from the
// same three columns every language reads: normalized_city, address_city and
// address_state (kindred#2755).
//
// normalized_city, set by normalize_geographic.go, is already the finished
// label when non-blank -- appending address_state to it a second time is
// what produced "San Carlos, CA, CA" (kindred#2753). Otherwise compose
// address_city + address_state, omitting either side that is blank.
//
// No caller in this package uses this today: family_camp_roster*.go only
// ever wants the city (PersonLocationCityOnly, below). This exists for the
// adult per-cabin export (kindred#2770), so both readers share one rule
// instead of each inventing its own.
func PersonLocation(normalizedCity, addressCity, addressState string) string {
	if v := strings.TrimSpace(normalizedCity); v != "" {
		return v
	}
	return joinCityState(addressCity, addressState)
}

// joinCityState joins raw city/state into "City, ST", omitting whichever
// side is blank rather than leaving a stray comma.
func joinCityState(city, state string) string {
	trimmedCity := strings.TrimSpace(city)
	trimmedState := strings.TrimSpace(state)
	switch {
	case trimmedCity == "":
		return trimmedState
	case trimmedState == "":
		return trimmedCity
	default:
		return trimmedCity + ", " + trimmedState
	}
}

// PersonLocationCityOnly returns a person's city with no state suffix, for a
// caller (the family-camp roster) that wants the city alone. It prefers
// normalized_city -- which also fixes casing, e.g. "berkeley" -> "Berkeley"
// -- falling back to the raw address_city, and strips a trailing ", ST"
// rather than composing with address_state at all: a caller that wants the
// state too calls PersonLocation instead of adding its own regex.
func PersonLocationCityOnly(normalizedCity, addressCity string) string {
	value := strings.TrimSpace(normalizedCity)
	if value == "" {
		value = strings.TrimSpace(addressCity)
	}
	return strings.TrimSpace(locationStateSuffix.ReplaceAllString(value, ""))
}
