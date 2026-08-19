package sync

import (
	"context"
	"fmt"
	"strings"
)

// enrollmentStatusColumn is the additive text column kindred#2305 adds to all
// three family_camp_* tables (migration 1500000166).
//
// WHAT IT IS FOR. The three derived tables are keyed on (household, year) and
// built from CUSTOM VALUES -- a form a family filled in. Filling the form is
// not attending: between 46 and 89 households a year hold family-camp rows with
// nobody enrolled, and until this column existed nothing downstream could tell
// them apart from a household that came.
//
// AN ATTRIBUTE, NOT A KEY. The write key, the three ProcessedKey sets and the
// three unique indexes are unchanged by it, so the "grain is a triple" trap in
// docs/reference/family-camp-grain-collapse.md does not apply.
const enrollmentStatusColumn = "enrollment_status"

const (
	// enrollmentStatusEnrolled means at least one member of the household was
	// actively enrolled (status_id = 2) on a family OR adult weekend that year.
	enrollmentStatusEnrolled = "enrolled"
	// enrollmentStatusNoneOnFile means the household has NO family/adult
	// attendee row at all for the year -- it registered and never appeared in
	// CampMinder's enrollment ledger.
	//
	// Deliberately NOT the string "none". CampMinder has an occupied status
	// spelled exactly that (409 weekend rows on the production snapshot), so
	// reusing it would collapse "we have a row and it says none" into "we have
	// no row", which are different facts. `none_on_file` is the name the read
	// layer already gives the second one (EnrollmentState in
	// api/schemas/lodging.py).
	enrollmentStatusNoneOnFile = "none_on_file"
	// enrollmentStatusUnknown covers an attendee row whose status slug is
	// missing, or one whose slug says enrolled while its status_id does not.
	// enrollmentFilter.ts already reserves `unknown` for exactly that and gives
	// it a `?` indicator; production carries zero such rows today.
	enrollmentStatusUnknown = "unknown"
)

// ⚠️ THE STORED VOCABULARY IS WIDER THAN THE WIRE'S, and the read layer has to
// catch up before it can publish this column verbatim.
// api/schemas/lodging.py's EnrollmentState is
// Literal["enrolled", "none_on_file"] and it types
// HouseholdJourneyYear.enrollment -- so the kindred#2305 follow-on that
// switches build_household_journey onto this column must WIDEN that Literal
// first. 55 of 2026's 479 registration rows store a status slug (cancelled,
// incomplete, waitlisted, withdrawn, applied) the two-value Literal would
// reject with a Pydantic ValidationError the moment the journey was built.

// familyCampWeekendSessionTypes is which session types ARE family camp.
//
// ⚠️ An adult weekend is a family-camp weekend. It differs only in being
// person-grain -- it enrolls the parent directly rather than their children --
// and a derivation that filtered `session_type = "family"` alone would report
// every adult-weekend household as never enrolled. That is not hypothetical:
// it is the live defect kindred#2305 fixes, measured at 33 of the 89 journey
// rows badged "No enrollment" for 2026.
//
// This DUPLICATES api/services/lodging_repository.py's WEEKEND_SESSION_TYPES
// rather than importing it, because that one is Python. The Go pairing this
// would otherwise have reused (`familySessionTypes` in camper_history.go) went
// away with the camper_history table in migration 1500000157, so there is now
// nothing in Go to import OR to drift from.
var familyCampWeekendSessionTypes = []string{sessionTypeFamily, sessionTypeAdult}

// familyCampStatusPriority ranks the non-enrolled statuses, lower being more
// relevant. It MIRRORS STATUS_PRIORITY in frontend/src/utils/enrollmentFilter.ts
// -- the ordering the board already applies when it picks the one status to
// show a family that did not enroll.
//
// There is no shared source for it: the derivation runs in Go and
// getStatusPriority is TypeScript. TestFamilyCampStatusPriorityMatchesTheFrontend
// reads the real .ts file and fails if the two ever disagree, which is the only
// thing keeping them together.
//
// The tie-break is small but live: households with no enrolled member AND more
// than one distinct non-enrolled status number 2 (2026), 13 (2025), 21 (2024)
// and 35 (2023).
var familyCampStatusPriority = map[string]int{
	"waitlisted": 1,
	"applied":    2,
	"cancelled":  3,
	"withdrawn":  4,
	"left_early": 5,
	"dismissed":  6,
	"incomplete": 7,
	"inquiry":    8,
	"unknown":    9,
	"none":       10,
}

// familyCampStatusUnranked is where a status enrollmentFilter.ts has never
// heard of sorts: last, behind every known one, but still stored verbatim
// rather than discarded. A new CampMinder status should read as itself on the
// board, not vanish.
const familyCampStatusUnranked = 999

// familyCampStatusRank returns a status slug's position in the fallback order.
func familyCampStatusRank(status string) int {
	if rank, ok := familyCampStatusPriority[status]; ok {
		return rank
	}
	return familyCampStatusUnranked
}

// normaliseFamilyCampStatus folds an attendee row's status slug into the
// vocabulary the priority map is keyed on.
//
// A blank slug, or one reading `enrolled` on a row whose status_id is not 2,
// becomes `unknown`: the two columns disagreeing is a fact nothing here can
// resolve, and storing `enrolled` off the back of a non-enrolled status_id
// would contradict the very field this column exists to answer.
func normaliseFamilyCampStatus(raw string) string {
	slug := strings.ToLower(strings.TrimSpace(raw))
	if slug == "" || slug == enrollmentStatusEnrolled {
		return enrollmentStatusUnknown
	}
	return slug
}

// enrollmentStatusForHousehold resolves one household's stored status, and is
// the ONLY place the absent case is named. A household missing from the map has
// no family/adult attendee row for the year at all.
//
// Never returns "": an empty status is the "could not determine" value a
// consumer cannot act on, and the whole point of a non-nullable derived column
// is that it never appears.
func enrollmentStatusForHousehold(statuses map[string]string, householdPBID string) string {
	if status, ok := statuses[householdPBID]; ok && status != "" {
		return status
	}
	return enrollmentStatusNoneOnFile
}

// loadHouseholdEnrollmentStatus maps household PB id -> that household's
// family-camp enrollment status for the year.
//
// TWO STAGES, in this order:
//
//  1. ANY actively enrolled member (status_id = 2) on a family or adult
//     weekend makes the whole household `enrolled`. Mixed households are real
//     -- 43 of 594 at (household, year) grain in 2026, 142 of 973 in 2024 --
//     and a family with one cancelled child and one who came did attend.
//  2. Otherwise the single best non-enrolled status by familyCampStatusPriority.
//
// Households with no family/adult attendee row are ABSENT from the result
// rather than present with a sentinel; enrollmentStatusForHousehold names that
// case. Keyed on the household PocketBase id because that is what the three
// derived tables store in their `household` relation -- personToHousehold is
// the same mapping Sync already built for the custom-value load, so this costs
// one attendee scan and no second person query.
func (s *FamilyCampDerivedSync) loadHouseholdEnrollmentStatus(
	ctx context.Context, year int, personToHousehold map[string]string,
) (map[string]string, error) {
	weekends, err := LoadSessionWindows(s.App, year, familyCampWeekendSessionTypes)
	if err != nil {
		return nil, fmt.Errorf("loading family/adult sessions for %d: %w", year, err)
	}
	if len(weekends) == 0 {
		// NO WEEKENDS IS TWO DIFFERENT FACTS, and only one of them is an answer.
		//
		// `none_on_file` is a POSITIVE claim -- "we hold no attendee row for
		// this household" -- and absence from the returned map is what produces
		// it. If camp_sessions was simply never synced for the year, every
		// household is absent for a reason that has nothing to do with the
		// household, and because this column is part of all three change
		// comparisons the wrong answer WRITES rather than sitting inert. That
		// is precisely the "could not determine" case the column exists to
		// prevent, so the run refuses rather than asserting it.
		//
		// The discriminator is the year's camp_sessions rows, not its weekends.
		// A season that ran sessions and no family or adult weekend is a real
		// answer; a season with no sessions row at all has not been synced.
		// Every year 2017-2026 on the production snapshot carries between 6 and
		// 18 weekends, so the second case is never a real season.
		sessions, countErr := s.App.FindRecordsByFilter(
			"camp_sessions", fmt.Sprintf("year = %d", year), sortByID, 1, 0)
		if countErr != nil {
			return nil, fmt.Errorf("checking camp_sessions for %d: %w", year, countErr)
		}
		if len(sessions) == 0 {
			return nil, fmt.Errorf(
				"no camp_sessions rows for year %d: enrollment status is underivable, and "+
					"writing none_on_file would assert a household never enrolled on the "+
					"strength of a table that was never synced -- run the sessions service first",
				year)
		}
		// Sessions exist, none of them is a weekend: every household is
		// honestly none_on_file, and the attendee scan below could only miss.
		return map[string]string{}, nil
	}

	enrolled := make(map[string]bool)
	bestRank := make(map[string]int)
	bestStatus := make(map[string]string)

	filter := fmt.Sprintf("year = %d", year)
	page := 1
	const perPage = 500

	for {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		default:
		}

		records, findErr := s.App.FindRecordsByFilter("attendees", filter, sortByID, perPage, (page-1)*perPage)
		if findErr != nil {
			return nil, fmt.Errorf("querying attendees page %d: %w", page, findErr)
		}

		for _, record := range records {
			if _, isWeekend := weekends[record.GetString("session")]; !isWeekend {
				continue
			}
			household := personToHousehold[record.GetString("person")]
			if household == "" {
				continue
			}
			// status_id, not the slug, decides enrollment: it is the numeric
			// CampMinder authority every other read in this repository uses
			// for the same question.
			if record.GetInt("status_id") == statusIDActiveEnrolled {
				enrolled[household] = true
				continue
			}
			status := normaliseFamilyCampStatus(record.GetString("status"))
			rank := familyCampStatusRank(status)
			if current, seen := bestRank[household]; !seen || rank < current {
				bestRank[household] = rank
				bestStatus[household] = status
			}
		}

		if len(records) < perPage {
			break
		}
		page++
	}

	result := make(map[string]string, len(enrolled)+len(bestStatus))
	for household, status := range bestStatus {
		result[household] = status
	}
	// Applied second: an enrolled member outranks every fallback, however the
	// rows happened to page in.
	for household := range enrolled {
		result[household] = enrollmentStatusEnrolled
	}
	return result, nil
}
