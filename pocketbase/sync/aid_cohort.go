package sync

import (
	"fmt"
	"log/slog"
	"slices"

	"github.com/pocketbase/pocketbase/core"
)

// CampMinder financial categories whose postings are aid (campership design §6.4):
// "Financial Assistance" and "JFAM". Stable CampMinder ids.
const (
	aidCategoryFinancialAssistance = 3840
	aidCategoryJFAM                = 19616
)

// aidCohort is who the bounded daily custom-values pass keeps fresh for financial aid in
// season N (design §6.4). FA answers are CampMinder custom fields, served one person per
// call, so they ride on that pass instead of a job of their own.
type aidCohort struct {
	personCMIDs    []int
	householdCMIDs []int
}

// loadAidCohort returns season N's aid cohort:
//   - persons: every season-N person with an application marked is_applicant for N, or
//     named on an aid posting (categories 3840/19616) in N or N+1, or in a household named
//     on one (most aid postings carry a household but no person);
//   - households: those posting households plus the households of the cohort's persons.
//
// Only ids with a season-N record are returned, because the pass stores values against
// season-N rows. A family new in N+1 joins once the season rolls over.
func loadAidCohort(app core.App, year int) (aidCohort, error) {
	direct := map[int]bool{}
	postingHouseholds := map[int]bool{}

	apps, err := app.FindRecordsByFilter("financial_aid_applications",
		fmt.Sprintf("year = %d && is_applicant = true", year), "", 0, 0)
	if err != nil {
		return aidCohort{}, fmt.Errorf("aid cohort: reading applications: %w", err)
	}
	for _, r := range apps {
		if id := r.GetInt("person_id"); id > 0 {
			direct[id] = true
		}
	}

	postings, err := app.FindRecordsByFilter("financial_transactions", fmt.Sprintf(
		"(year = %d || year = %d) && (financial_category_cm_id = %d || financial_category_cm_id = %d)",
		year, year+1, aidCategoryFinancialAssistance, aidCategoryJFAM), "", 0, 0)
	if err != nil {
		return aidCohort{}, fmt.Errorf("aid cohort: reading aid postings: %w", err)
	}
	for _, r := range postings {
		if id := r.GetInt("person_cm_id"); id > 0 {
			direct[id] = true
		}
		if id := r.GetInt("household_cm_id"); id > 0 {
			postingHouseholds[id] = true
		}
	}

	yearFilter := fmt.Sprintf("year = %d", year)
	households, err := app.FindRecordsByFilter("households", yearFilter, "", 0, 0)
	if err != nil {
		return aidCohort{}, fmt.Errorf("aid cohort: reading households: %w", err)
	}
	seasonHouseholds := make(map[int]bool, len(households))
	for _, h := range households {
		seasonHouseholds[h.GetInt("cm_id")] = true
	}

	persons, err := app.FindRecordsByFilter("persons", yearFilter, "", 0, 0)
	if err != nil {
		return aidCohort{}, fmt.Errorf("aid cohort: reading persons: %w", err)
	}
	personSet := map[int]bool{}
	householdSet := map[int]bool{}
	for id := range postingHouseholds {
		if seasonHouseholds[id] {
			householdSet[id] = true
		}
	}
	for _, p := range persons {
		cmID, hh := p.GetInt("cm_id"), p.GetInt("household_id")
		if cmID <= 0 || (!direct[cmID] && !postingHouseholds[hh]) {
			continue
		}
		personSet[cmID] = true
		if hh > 0 && seasonHouseholds[hh] {
			householdSet[hh] = true
		}
	}

	cohort := aidCohort{personCMIDs: sortedIDs(personSet), householdCMIDs: sortedIDs(householdSet)}
	slog.Debug("Resolved aid cohort", "year", year,
		"persons", len(cohort.personCMIDs), "households", len(cohort.householdCMIDs))
	return cohort, nil
}

func sortedIDs(set map[int]bool) []int {
	out := make([]int, 0, len(set))
	for id := range set {
		out = append(out, id)
	}
	slices.Sort(out)
	return out
}

// unionCMIDs returns a followed by the ids of b that a lacks, in first-seen order.
func unionCMIDs(a, b []int) []int {
	seen := make(map[int]bool, len(a)+len(b))
	out := make([]int, 0, len(a)+len(b))
	for _, ids := range [][]int{a, b} {
		for _, id := range ids {
			if !seen[id] {
				seen[id] = true
				out = append(out, id)
			}
		}
	}
	return out
}
