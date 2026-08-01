package sync

import (
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// statusIDActiveEnrolled is CampMinder's "active enrolled" attendee status.
// Every lodging query filters on it; any other status is not attending.
const statusIDActiveEnrolled = 2

// Attribution reasons. attrAmbiguousSession and attrNoSession are also
// lodging_ingest_issues.kind values, so they must stay in step with
// migration 1500000122's select list.
const (
	attrSingleSession    = "single_session"
	attrAmbiguousSession = issueAmbiguousSession
	attrNoSession        = issueNoSession
)

// SessionWindow is one weekend's identity and date range.
type SessionWindow struct {
	ID    string // camp_sessions PB record id
	CMID  int
	Name  string
	Start time.Time
	End   time.Time
}

// Attribution is the result of pinning one cabin value to one weekend.
// SessionID is set only when attribution is unambiguous; BestGuess is advisory
// and exists so the work queue can offer a one-click confirmation.
type Attribution struct {
	SessionID  string
	Candidates []SessionWindow
	Reason     string
	BestGuess  string
}

// SessionCMID returns the attributed session's CampMinder id, or 0 when nothing
// was attributed.
//
// The placement tables require this column (migration 1500000124): camp_sessions
// is unique on (cm_id, year), so its PB record id is scoped to one season and
// cannot carry a cross-year question. Reading the id off the matching candidate
// rather than re-querying keeps the pair consistent -- an assignment whose
// session_cm_id disagreed with its session relation would be worse than either
// alone.
func (a Attribution) SessionCMID() int {
	if a.SessionID == "" {
		return 0
	}
	for _, c := range a.Candidates {
		if c.ID == a.SessionID {
			return c.CMID
		}
	}
	return 0
}

// CandidateCMIDs returns the candidate session CampMinder ids, for the queue item.
func (a Attribution) CandidateCMIDs() []int {
	out := make([]int, 0, len(a.Candidates))
	for _, c := range a.Candidates {
		out = append(out, c.CMID)
	}
	return out
}

// ParseCampMinderTimestamp parses the value in
// household_custom_values.last_updated / person_custom_values.last_updated.
//
// That column is TEXT, not a PocketBase date, and carries CampMinder's raw .NET
// DateTimeOffset: "2025-04-21T17:51:11.5964281+00:00" -- seven fractional digits
// and an explicit offset. Go's RFC3339 layout accepts both.
//
// The package's ParseDate helper (date_utils.go) does parse this format -- its
// DateFormats list leads with time.RFC3339 and time.Parse tolerates any number
// of fractional-second digits. It is the wrong tool here for a different reason:
// it returns a STRING formatted "2006-01-02 15:04:05Z", truncated to whole
// seconds, and AttributeSession needs a time.Time to compare against session
// start dates. Parsing here keeps the value typed and keeps the sub-second
// precision ParseDate's round-trip would drop.
func ParseCampMinderTimestamp(s string) (time.Time, bool) {
	s = strings.TrimSpace(s)
	if s == "" {
		return time.Time{}, false
	}
	if t, err := time.Parse(time.RFC3339, s); err == nil {
		return t, true
	}
	// PocketBase's own stored layout, in case a value is ever normalised on write.
	if t, err := time.Parse("2006-01-02 15:04:05.000Z", s); err == nil {
		return t, true
	}
	return time.Time{}, false
}

// LoadSessionWindows returns every camp_sessions row for the year whose
// session_type is in sessionTypes, keyed by PB record id.
func LoadSessionWindows(app core.App, year int, sessionTypes []string) (map[string]SessionWindow, error) {
	// No types means no sessions. Falling through would build `year = N && ()`,
	// which is a filter-parse error rather than the empty result a caller expects.
	if len(sessionTypes) == 0 {
		return map[string]SessionWindow{}, nil
	}

	quoted := make([]string, 0, len(sessionTypes))
	for _, st := range sessionTypes {
		quoted = append(quoted, "session_type = '"+st+"'")
	}
	// Session types are package constants, never user input, so inlining them is
	// safe here. Note the spaces around every operator -- PocketBase's filter
	// parser silently returns wrong results without them.
	filter := fmt.Sprintf("year = %d && (%s)", year, strings.Join(quoted, " || "))

	records, err := app.FindRecordsByFilter("camp_sessions", filter, "", 0, 0)
	if err != nil {
		return nil, fmt.Errorf("loading camp_sessions for %d: %w", year, err)
	}

	out := make(map[string]SessionWindow, len(records))
	for _, r := range records {
		out[r.Id] = SessionWindow{
			ID:   r.Id,
			CMID: r.GetInt("cm_id"),
			Name: r.GetString("name"),
			// start_date and end_date are PocketBase DATE fields stored as
			// "2025-05-23 07:00:00.000Z" -- a layout that matches none of
			// date_utils.go's DateFormats, so GetDateTime is the only correct read.
			Start: r.GetDateTime("start_date").Time(),
			End:   r.GetDateTime("end_date").Time(),
		}
	}
	return out, nil
}

// allParties is buildSessionIndex's "no CM-id filter": index the whole year.
// A real CampMinder id is never 0, so the sentinel cannot collide with one.
const allParties = 0

// BuildHouseholdSessionIndex maps household CampMinder id -> the distinct
// sessions that household is actively enrolled in.
//
// Path: attendees (status_id = 2) -> persons.household_id -> camp_sessions.
// Two enrolled siblings at one weekend are ONE household-weekend, so the result
// is deduplicated by session.
func BuildHouseholdSessionIndex(app core.App, year int, sessionTypes []string) (map[int][]SessionWindow, error) {
	return buildSessionIndex(app, year, sessionTypes, true, allParties)
}

// BuildPersonSessionIndex maps person CampMinder id -> that person's actively
// enrolled sessions. Used for adult weekends, which enroll real persons.
func BuildPersonSessionIndex(app core.App, year int, sessionTypes []string) (map[int][]SessionWindow, error) {
	return buildSessionIndex(app, year, sessionTypes, false, allParties)
}

// buildSessionIndex is the one place a party's candidate weekends are derived,
// for the whole-year sync pass and for a single-party replay alike.
//
// onlyCMID prunes the result to one party (allParties keeps everything). It
// deliberately prunes in Go, AFTER the same queries the full pass runs, rather
// than pushing a WHERE clause down: a filtered path that queries differently is
// a second derivation of "which weekends could this value describe", and the
// two drifting is exactly what makes a replayed placement disagree with the one
// the next sync would have written. Replay pays a whole-year scan for that
// guarantee, which is the smaller half of its ~1-2s cost.
func buildSessionIndex(
	app core.App, year int, sessionTypes []string, byHousehold bool, onlyCMID int,
) (map[int][]SessionWindow, error) {
	windows, err := LoadSessionWindows(app, year, sessionTypes)
	if err != nil {
		return nil, err
	}

	// Only the household index needs the person -> household mapping, and
	// building it is a full paged scan of persons for the year.
	var personToHousehold map[int]int
	if byHousehold {
		personToHousehold, err = loadPersonHouseholdCMIDs(app, year)
		if err != nil {
			return nil, err
		}
	}

	filter := fmt.Sprintf("year = %d && status_id = %d", year, statusIDActiveEnrolled)
	attendees, err := findAllRecords(app, "attendees", filter)
	if err != nil {
		return nil, err
	}

	seen := make(map[string]bool) // "<key>|<sessionID>"
	result := make(map[int][]SessionWindow)
	for _, a := range attendees {
		window, ok := windows[a.GetString("session")]
		if !ok {
			continue // not a family/adult session
		}

		key := a.GetInt("person_id")
		if byHousehold {
			key = personToHousehold[key]
		}
		if key == 0 {
			continue
		}
		if onlyCMID != allParties && key != onlyCMID {
			continue
		}

		dedup := fmt.Sprintf("%d|%s", key, window.ID)
		if seen[dedup] {
			continue
		}
		seen[dedup] = true
		result[key] = append(result[key], window)
	}

	for key := range result {
		slices.SortFunc(result[key], func(a, b SessionWindow) int {
			return a.Start.Compare(b.Start)
		})
	}
	return result, nil
}

// loadPersonHouseholdCMIDs maps person CampMinder id -> household CampMinder id.
// Both are CampMinder ids per the project-wide rule; persons.household is the PB
// relation and persons.household_id the CampMinder one.
func loadPersonHouseholdCMIDs(app core.App, year int) (map[int]int, error) {
	records, err := findAllRecords(app, "persons", fmt.Sprintf("year = %d && household_id > 0", year))
	if err != nil {
		return nil, err
	}
	out := make(map[int]int, len(records))
	for _, r := range records {
		out[r.GetInt("cm_id")] = r.GetInt("household_id")
	}
	return out, nil
}

// findAllRecords pages through a collection, matching the paging shape the other
// derived syncs in this package use.
//
// The sort is not cosmetic. LIMIT/OFFSET over an unsorted result set lets SQLite
// return a different row order per query, which silently skips or duplicates
// rows past page 1 -- and a skipped attendee turns a two-weekend household into
// a one-weekend one, so an ambiguous_session becomes a CONFIDENT WRONG
// attribution once Task 11 starts writing assignments. `id` is unique and
// immutable, so it is a stable page key.
func findAllRecords(app core.App, collection, filter string, params ...dbx.Params) ([]*core.Record, error) {
	const perPage = 500
	var all []*core.Record
	for page := 1; ; page++ {
		batch, err := app.FindRecordsByFilter(collection, filter, "id", perPage, (page-1)*perPage, params...)
		if err != nil {
			return nil, fmt.Errorf("querying %s page %d: %w", collection, page, err)
		}
		all = append(all, batch...)
		if len(batch) < perPage {
			return all, nil
		}
	}
}

// AttributeSession pins one cabin value to one weekend.
//
// candidates must be sorted by Start ascending (BuildHouseholdSessionIndex and
// BuildPersonSessionIndex both guarantee that).
//
// With one candidate the answer is certain. With none there is nothing to
// attribute to. With several, CampMinder's single per-year value cannot say
// which weekend it describes, so this returns a SUGGESTION and no assignment:
// spec 3.6 requires flagging those 6-10 households a year for manual entry, and
// a wrong cabin on the board is worse than a blank one.
//
// The suggestion is the earliest session starting on or after lastUpdated --
// staff edit the value shortly before the weekend it applies to, which held for
// all six ambiguous 2025 households. A value edited after every weekend has
// ended suggests the last one.
func AttributeSession(candidates []SessionWindow, lastUpdated time.Time) Attribution {
	switch len(candidates) {
	case 0:
		return Attribution{Reason: attrNoSession}
	case 1:
		return Attribution{
			SessionID:  candidates[0].ID,
			Candidates: candidates,
			Reason:     attrSingleSession,
		}
	}

	out := Attribution{Candidates: candidates, Reason: attrAmbiguousSession}
	if lastUpdated.IsZero() {
		return out
	}
	for _, c := range candidates {
		if !c.Start.Before(lastUpdated) {
			out.BestGuess = c.ID
			return out
		}
	}
	out.BestGuess = candidates[len(candidates)-1].ID
	return out
}
