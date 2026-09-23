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

// sessionIndexHasWindow reports whether windows -- one party's enrolled
// sessions, as returned per-party by BuildHouseholdSessionIndex /
// BuildPersonSessionIndex -- includes sessionCMID (a camp_sessions CampMinder
// id).
//
// Keyed on the CampMinder id, not the PB record id (kindred#2042). Its only
// callers match a LODGING row's session against this index, and the lodging
// row's durable key is session_cm_id: a camp_sessions record recreated rather
// than updated gets a new PB id, the attendees re-sync onto it, and every
// lodging row keyed on the old one silently stops matching. camp_sessions is
// unique on (cm_id, year) and this index is built one year at a time, so the
// CampMinder id identifies a window just as precisely.
func sessionIndexHasWindow(windows []SessionWindow, sessionCMID int) bool {
	for _, w := range windows {
		if w.CMID == sessionCMID {
			return true
		}
	}
	return false
}

// reliableEnrolledSessions returns the set of session CampMinder ids with at
// least one actively-enrolled party in index. It is the per-session guard
// #2028 shares with stranded_assignment_cleanup.go's findEnrollmentOrphans: a
// session absent here had zero enrolled parties of this grain when index was
// built, which is as likely to be a failed attendee sync as a genuinely empty
// weekend, so nothing keyed to that session is swept by either caller
// (LodgingAssignmentsSync.deleteLodgingOrphans, reconcileLodgingOrphans).
//
// Keyed on the CampMinder id for the same reason sessionIndexHasWindow is --
// see that function.
func reliableEnrolledSessions(index map[int][]SessionWindow) map[int]bool {
	out := make(map[int]bool)
	for _, windows := range index {
		for _, w := range windows {
			out[w.CMID] = true
		}
	}
	return out
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
// From 2026 the ingest answers most multi-weekend parties from captured value
// history instead (attributeFromHistory, kindred#2784), and reaches this only
// for a season before capture began or a value with no usable clock.
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

// historyAttributionFirstSeason is the first season whose multi-weekend parties
// are attributed from captured value history (kindred#2784). Capture began on
// 2026-08-21 (kindred#2482), so no earlier season has any history, and the
// owner ruled the rule applies "for 2026 onward". Gating on the year rather
// than on "history exists" is what keeps a prior season untouched when the
// ingest is driven for it explicitly (?year=, a historical re-registration):
// with no history the current value alone would still place its last weekend,
// and 21 of 2025's household values were last edited in December.
const historyAttributionFirstSeason = 2026

// valueWrite is one known write of a cabin value: the value, and when CampMinder
// says it was written.
type valueWrite struct {
	At    time.Time
	Value string
}

// weekendValue is one weekend's cabin under the history rule.
//
// Known is false when the weekend started before the earliest write the
// timeline holds: whatever was in effect then was overwritten before capture
// began, so nothing can be said about it. A Known weekend with an empty Value
// had its cabin cleared when it started. Either way it is not placed.
type weekendValue struct {
	Window SessionWindow
	Value  string
	Known  bool
}

// placed reports whether this weekend has a cabin to write.
func (w weekendValue) placed() bool { return w.Known && w.Value != "" }

// sessionCutoff is the moment a weekend's cabin is read: the start of its first
// day, camp-local.
//
// camp_sessions.start_date is already stored as local midnight (07:00Z in
// summer, 08:00Z in winter), so for every current row this is the identity.
// Truncating anyway keeps the rule true if a start ever carries a check-in time:
// an edit made on the morning of arrival is after the cutoff, not before it.
func sessionCutoff(w SessionWindow, loc *time.Location) time.Time {
	local := w.Start.In(loc)
	return time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, loc)
}

// attributeFromHistory gives each of a party's weekends the cabin value in
// effect when that weekend started (kindred#2784, owner rulings 2026-09-23).
//
// candidates are the party's enrolled weekends of the field's own session type,
// sorted by Start ascending. history holds the captured writes in any order.
// current is the value CampMinder holds now, with its own change time.
//
// The rule, weekend by weekend:
//
//   - A weekend that has not started yet takes the current value. Until it
//     starts, what is in CampMinder now is its answer.
//   - The party's LAST weekend takes the current value if anything was written
//     after it started -- the "lone late edit": staff edit housing before
//     weekends, not after, so a later write is a correction of the last one.
//   - Every other weekend takes the latest value written strictly before its
//     cutoff. An unchanged value therefore carries forward to every later
//     weekend, which is ruling 3 and also why this does not "smear" one yearly
//     value the way #2393 guarded against: a value written after a weekend
//     started can never land on it.
//   - The timeline is known only from its earliest write. A weekend whose cutoff
//     falls before that floor gets Known=false. With no history row the floor
//     is the current value's own change time, which is sound on its own:
//     CampMinder is saying the value has not changed since then.
//
// Ordering is by time, never by position. Ties go to the current value, which is
// appended last and sorted stably, so the history row that recorded the current
// value (same time, same value) and the current value itself agree.
func attributeFromHistory(
	candidates []SessionWindow, history []valueWrite, current valueWrite, now time.Time, loc *time.Location,
) []weekendValue {
	timeline := make([]valueWrite, 0, len(history)+1)
	timeline = append(timeline, history...)
	timeline = append(timeline, current)
	slices.SortStableFunc(timeline, func(a, b valueWrite) int { return a.At.Compare(b.At) })

	last := len(candidates) - 1
	out := make([]weekendValue, 0, len(candidates))
	for i, w := range candidates {
		cutoff := sessionCutoff(w, loc)
		wv := weekendValue{Window: w}
		switch {
		case cutoff.After(now):
			wv.Value, wv.Known = current.Value, true
		case i == last && !timeline[len(timeline)-1].At.Before(cutoff):
			wv.Value, wv.Known = current.Value, true
		default:
			wv.Value, wv.Known = latestBefore(timeline, cutoff)
		}
		out = append(out, wv)
	}
	return out
}

// latestBefore returns the value of the last write strictly before cutoff in a
// time-sorted timeline, and false when the timeline starts at or after it.
func latestBefore(timeline []valueWrite, cutoff time.Time) (string, bool) {
	value, known := "", false
	for _, w := range timeline {
		if !w.At.Before(cutoff) {
			break
		}
		value, known = w.Value, true
	}
	return value, known
}

// changeTimeLayoutsWithZone are the zoned layouts parseSourceChangeTime tries
// after ParseCampMinderTimestamp. Fractional seconds need no layout of their
// own: time.Parse accepts them after the seconds field regardless.
var changeTimeLayoutsWithZone = []string{
	"2006-01-02 15:04:05Z07:00",
	"2006-01-02 15:04:05Z",
}

// changeTimeLayoutsLocal carry no zone, so they are read as camp-local time.
// A bare date is local midnight, which puts an edit on arrival day on the right
// side of that day's cutoff (not before it).
var changeTimeLayoutsLocal = []string{
	"2006-01-02T15:04:05",
	"2006-01-02 15:04:05",
	"2006-01-02",
	"1/2/2006 3:04:05 PM",
	"1/2/2006 3:04 PM",
	"1/2/2006 15:04:05",
	"1/2/2006 15:04",
	"1/2/2006",
}

// parseSourceChangeTime reads a CampMinder change time defensively.
//
// Every captured value in the 2026 snapshot is the .NET DateTimeOffset
// ParseCampMinderTimestamp already reads, but CampMinder's free-text dates have
// appeared in 7+ formats elsewhere in this repo, and a value this cannot read
// is not dropped: the caller falls back to our own observation time and logs.
// Anything no layout accepts returns false rather than a guess.
func parseSourceChangeTime(s string, loc *time.Location) (time.Time, bool) {
	if t, ok := ParseCampMinderTimestamp(s); ok {
		return t, true
	}
	s = strings.TrimSpace(s)
	if s == "" {
		return time.Time{}, false
	}
	for _, layout := range changeTimeLayoutsWithZone {
		if t, err := time.Parse(layout, s); err == nil {
			return t, true
		}
	}
	for _, layout := range changeTimeLayoutsLocal {
		if t, err := time.ParseInLocation(layout, s, loc); err == nil {
			return t, true
		}
	}
	return time.Time{}, false
}
