package sync

import (
	"fmt"
	"regexp"
	"slices"
	"strings"
	"time"
)

// The Family Camp family-facing roster: one row per person, campers and adults,
// grouped into banded blocks per household. kindred#2433.
//
// This file is the unit-testable core -- it reads PocketBase and returns an
// ordered Roster, and makes no Google calls. Rendering lives in
// family_camp_roster_sheet.go and the Drive/Sheets orchestration in
// family_camp_roster_export.go.

// rosterAdultPlaceholders are the values registrants type into an adult-name
// field to mean "there is no second adult". Rendering one puts a row called
// "N/A" in the middle of a family's block.
var rosterAdultPlaceholders = map[string]bool{
	"na": true, "n/a": true, "none": true, "-": true, "0": true, "no": true,
}

// rosterStateSuffix matches the trailing ", CA" that normalized_city carries.
// It is dropped because it is redundant on a roster whose families are almost
// all in one state, and because today's hand-made sheet omits it. Two UPPERCASE
// letters only: "Washington, District" is a city, not a state suffix.
var rosterStateSuffix = regexp.MustCompile(`,\s*[A-Z]{2}$`)

// rosterCamper is one enrolled child, before rendering.
type rosterCamper struct {
	Name      string
	Last      string
	Birthdate string // "YYYY-MM-DD", or "" when unknown
}

// rosterAdult is one accompanying adult, before rendering. Adults are not
// enrolled: they come from family_camp_adults, scraped from the registration
// form.
type rosterAdult struct {
	Number int
	Name   string
	Email  string
}

// rosterHousehold is one family's people, before ordering and rendering.
type rosterHousehold struct {
	ID      string // households PB record id
	City    string
	Campers []rosterCamper
	Adults  []rosterAdult
}

// rosterAgeLabel renders a birthdate as an age AT EXPORT TIME (design §Age):
// whole years from twelve months up, whole months below that, and nothing at all
// for a blank or unparseable birthdate.
//
// Sorting never goes through this -- two campers both displaying "8" must stay
// in real age order, so the sort reads the birthdate itself.
func rosterAgeLabel(birthdate string, on time.Time) string {
	born, ok := parseRosterBirthdate(birthdate)
	if !ok {
		return ""
	}

	months := (on.Year()-born.Year())*12 + int(on.Month()) - int(born.Month())
	if on.Day() < born.Day() {
		months--
	}
	// A birthdate in the future is bad data. It is never a negative age.
	months = max(months, 0)

	if months >= 12 {
		return fmt.Sprintf("%d", months/12)
	}
	if months == 1 {
		return "1 mo"
	}
	return fmt.Sprintf("%d mos", months)
}

// parseRosterBirthdate reads persons.birthdate, which is TEXT holding
// "YYYY-MM-DD" (2593 of 2598 rows for 2026; the rest are blank). The prefix
// slice is defensive against a value that ever gains a time component.
func parseRosterBirthdate(birthdate string) (time.Time, bool) {
	trimmed := strings.TrimSpace(birthdate)
	if len(trimmed) < len(time.DateOnly) {
		return time.Time{}, false
	}
	born, err := time.Parse(time.DateOnly, trimmed[:len(time.DateOnly)])
	if err != nil {
		return time.Time{}, false
	}
	return born, true
}

// rosterCleanCity prefers normalized_city, which fixes casing ("berkeley" ->
// "Berkeley, CA"), and falls back to the raw address_city.
func rosterCleanCity(normalized, raw string) string {
	value := strings.TrimSpace(normalized)
	if value == "" {
		value = strings.TrimSpace(raw)
	}
	return strings.TrimSpace(rosterStateSuffix.ReplaceAllString(value, ""))
}

// isRosterAdultName reports whether a coalesced adult name names a real person.
func isRosterAdultName(name string) bool {
	trimmed := strings.TrimSpace(name)
	return trimmed != "" && !rosterAdultPlaceholders[strings.ToLower(trimmed)]
}

// rosterAdultName coalesces family_camp_adults' name columns.
//
// `name` is the column of record and the split columns are the fallback, never
// the other way round: last_name is blank on every 2026 row, so reading the
// split pair first yields a first name with a trailing space.
func rosterAdultName(name, first, last string) string {
	if trimmed := strings.TrimSpace(name); trimmed != "" {
		return trimmed
	}
	return strings.TrimSpace(strings.TrimSpace(first) + " " + strings.TrimSpace(last))
}

// rosterCamperName renders a camper as the family would say it.
func rosterCamperName(preferred, first, last string) string {
	given := strings.TrimSpace(preferred)
	if given == "" {
		given = strings.TrimSpace(first)
	}
	return strings.TrimSpace(given + " " + strings.TrimSpace(last))
}

// rosterMonths names the months in full, matching the hand-made sheet.
var rosterMonths = [...]string{
	"January", "February", "March", "April", "May", "June",
	"July", "August", "September", "October", "November", "December",
}

// formatRosterDateRange renders the subtitle under the roster's title.
func formatRosterDateRange(start, end time.Time) string {
	startMonth := rosterMonths[start.Month()-1]
	endMonth := rosterMonths[end.Month()-1]

	if start.Year() != end.Year() {
		return fmt.Sprintf("%s %d, %d – %s %d, %d",
			startMonth, start.Day(), start.Year(), endMonth, end.Day(), end.Year())
	}
	if start.Month() == end.Month() {
		return fmt.Sprintf("%s %d–%d, %d", startMonth, start.Day(), end.Day(), end.Year())
	}
	return fmt.Sprintf("%s %d – %s %d, %d",
		startMonth, start.Day(), endMonth, end.Day(), end.Year())
}

// sortRosterCampers orders one household's campers youngest to oldest, with a
// missing birthdate filing last and the display name breaking ties so twins do
// not swap between two exports of unchanged data.
func sortRosterCampers(campers []rosterCamper) {
	slices.SortFunc(campers, func(a, b rosterCamper) int {
		aBorn, aOK := parseRosterBirthdate(a.Birthdate)
		bBorn, bOK := parseRosterBirthdate(b.Birthdate)
		switch {
		case aOK && !bOK:
			return -1
		case !aOK && bOK:
			return 1
		case aOK && bOK && !aBorn.Equal(bBorn):
			// Later birthdate = younger = first.
			return bBorn.Compare(aBorn)
		}
		return strings.Compare(strings.ToLower(a.Name), strings.ToLower(b.Name))
	})
}

// orderRosterHouseholds sorts blocks A->Z on the case-folded surname of the
// block's FIRST camper, which is what today's hand-made sheet already does.
//
// Call it only after sortRosterCampers, since "first camper" means the youngest.
// Both tiebreakers matter: two unrelated families sharing a surname is common,
// and without a total order two exports of unchanged data differ.
func orderRosterHouseholds(households []rosterHousehold) {
	slices.SortFunc(households, func(a, b rosterHousehold) int {
		if c := strings.Compare(rosterSortSurname(&a), rosterSortSurname(&b)); c != 0 {
			return c
		}
		if c := strings.Compare(rosterSortName(&a), rosterSortName(&b)); c != 0 {
			return c
		}
		return strings.Compare(a.ID, b.ID)
	})
}

// rosterSortSurname and rosterSortName read the first camper's keys. A household
// reaches the roster only by having an enrolled camper, so the guard is
// defensive rather than a real case.
func rosterSortSurname(h *rosterHousehold) string {
	if len(h.Campers) == 0 {
		return ""
	}
	return strings.ToLower(h.Campers[0].Last)
}

func rosterSortName(h *rosterHousehold) string {
	if len(h.Campers) == 0 {
		return ""
	}
	return strings.ToLower(h.Campers[0].Name)
}

// linkedHouseholdGroups returns householdID -> 1-based group number for
// households that SHARE an adult; households in no group are absent from the
// result (design §5).
//
// Two households in one weekend may share an adult -- a friend attending with
// another family, or co-parents keeping two homes. They are never merged:
// merging would fix the first case and force a single wrong city onto the
// second. The color means "these are linked, look here", never "these should
// be merged".
//
// Grouping is TRANSITIVE. If A shares an adult with B and B with C, all three
// are one group and get one color -- a household in two groups would need two
// fills and would read as two separate pairings.
//
// Group numbers follow `order`, the roster's own household order, so
// re-exporting unchanged data paints the same households the same color.
func linkedHouseholdGroups(order []string, adults map[string][]string) map[string]int {
	// A name repeated within ONE household is kindred#2483's duplicate-adult
	// defect, not a link, so each household contributes a name at most once.
	byName := make(map[string][]string)
	for _, household := range order {
		seen := make(map[string]bool)
		for _, name := range adults[household] {
			key := strings.ToLower(strings.TrimSpace(name))
			if key == "" || seen[key] {
				continue
			}
			seen[key] = true
			byName[key] = append(byName[key], household)
		}
	}

	find := newRosterUnionFind()
	for _, sharing := range byName {
		for _, household := range sharing[1:] {
			find.union(sharing[0], household)
		}
	}

	members := make(map[string]int)
	for _, household := range order {
		members[find.root(household)]++
	}

	groups := make(map[string]int)
	numbers := make(map[string]int)
	for _, household := range order {
		root := find.root(household)
		if members[root] < 2 {
			continue
		}
		if numbers[root] == 0 {
			numbers[root] = len(numbers) + 1
		}
		groups[household] = numbers[root]
	}
	return groups
}

// rosterUnionFind is a disjoint-set over household ids. Unseen ids are their own
// root, so a household naming no adult needs no initialisation.
type rosterUnionFind struct{ parent map[string]string }

func newRosterUnionFind() *rosterUnionFind {
	return &rosterUnionFind{parent: make(map[string]string)}
}

func (u *rosterUnionFind) root(id string) string {
	root := id
	for {
		parent, ok := u.parent[root]
		if !ok || parent == root {
			break
		}
		root = parent
	}
	// Compress in a second pass. Compressing during the walk would need the
	// grandparent, which is absent for a root and would store "" as a parent.
	for id != root {
		next := u.parent[id]
		u.parent[id] = root
		id = next
	}
	return root
}

func (u *rosterUnionFind) union(a, b string) {
	rootA, rootB := u.root(a), u.root(b)
	if rootA != rootB {
		u.parent[rootB] = rootA
	}
}
