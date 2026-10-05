package sync

import (
	"cmp"
	"fmt"
	"log/slog"
	"slices"

	"github.com/pocketbase/pocketbase/core"
)

// aidAdultsField is households.aid_adults (migration 1500000232): the adults CampMinder names
// for a household of the financial-aid cohort. Camperships reads it, and nothing else may: the
// field is hidden, the audit log drops it, and the anonymizer fakes it.
const aidAdultsField = "aid_adults"

// aidAdultsBatchSize is GetPersons' request bound, as in processPersonBatches.
const aidAdultsBatchSize = 500

// CampMinder FamilyPersons roles that make a person a household's adult.
const (
	roleFirstPrincipal  = 1
	roleSecondPrincipal = 2
)

// aidAdult is one entry of households.aid_adults. Role is the FamilyPersons role, 1 (First
// Principal) or 2 (Second Principal); staff screens say "Adult 1" / "Adult 2" and never infer
// a relationship from it. IsGuardian is CampMinder's flag on any cohort camper's Relatives
// entry for this person.
type aidAdult struct {
	CMID       int    `json:"cm_id"`
	First      string `json:"first"`
	Last       string `json:"last"`
	Preferred  string `json:"preferred"`
	Role       int    `json:"role"`
	IsGuardian bool   `json:"is_guardian"`
}

// relativeRef is one entry of a person's CampMinder Relatives: an id, and whether CampMinder
// marks that relative a guardian. It carries no relationship type and no name.
type relativeRef struct {
	ID         int
	IsGuardian bool
}

// aidAdultsStats counts one aid step: households named, adults placed in them, and households
// whose stored list changed (written, or cleared).
type aidAdultsStats struct {
	Households int
	Adults     int
	Updated    int
}

// relativesOf reads a GetPersons record's Relatives, skipping entries with no id.
func relativesOf(person map[string]any) []relativeRef {
	list, _ := person["Relatives"].([]any)
	out := make([]relativeRef, 0, len(list))
	for _, item := range list {
		rel, ok := item.(map[string]any)
		if !ok {
			continue
		}
		id, _ := rel["ID"].(float64)
		if id <= 0 {
			continue
		}
		guardian, _ := rel["IsGuardian"].(bool)
		out = append(out, relativeRef{ID: int(id), IsGuardian: guardian})
	}
	return out
}

// aidAdultsSeason reports whether year is the configured season (season is ParseSeasonYear in
// production; a parameter so its test needs no t.Setenv). aid_adults is current state, so a
// historical replay of the persons sync must not rewrite it.
func aidAdultsSeason(year int, season func() (int, error)) bool {
	configured, err := season()
	return err == nil && configured == year
}

// runAidAdults is the persons sync's aid step: the configured season only, its relatives
// fetched through the run's CampMinder client. A failure is logged and counted.
func (s *PersonsSync) runAidAdults(year int, batch *personBatchResult) {
	if !aidAdultsSeason(year, ParseSeasonYear) {
		slog.Info("Aid adults skipped: not the configured season", "year", year)
		return
	}
	if _, err := s.syncAidAdults(year, batch.relatives, batch.personHouseholdMap, s.Client.GetPersons); err != nil {
		slog.Error("Failed to sync aid adults", "year", year, "error", err)
		s.Stats.Errors++
	}
}

// syncAidAdults rewrites households.aid_adults for the season's aid cohort (aid_cohort.go).
//
// Every relative of every cohort person is fetched, not only guardians: most adults of a
// second household are not marked guardians of the camper. Each fetched relative goes to the
// one cohort household where CampMinder lists them as First or Second Principal; anyone else
// (a sibling, a principal of a household outside the cohort) is left out. These adults are
// never written as persons rows: persons stays campers and staff, and its orphan sweep would
// fight them.
//
// The list is rewritten each run, never appended to, and a season household outside the
// result is cleared, so it always reads CampMinder's current state. A fetch failure returns
// before any write, so a failed run cannot read as "no adults".
//
// relatives and households are this run's, keyed by person CM id (processPersonBatches).
func (s *PersonsSync) syncAidAdults(
	year int,
	relatives map[int][]relativeRef,
	households map[int]personHouseholdIDs,
	fetch func([]int) ([]map[string]any, error),
) (aidAdultsStats, error) {
	cohort, err := loadAidCohort(s.App, year)
	if err != nil {
		return aidAdultsStats{}, err
	}

	targets := map[int]bool{}
	for _, h := range cohort.householdCMIDs {
		targets[h] = true
	}
	guardian := map[int]bool{}
	for _, person := range cohort.personCMIDs {
		ids := households[person]
		for _, h := range []int{ids.PrincipalID, ids.PrimaryChildhoodID, ids.AlternateChildhoodID} {
			if h > 0 {
				targets[h] = true
			}
		}
		for _, rel := range relatives[person] {
			guardian[rel.ID] = guardian[rel.ID] || rel.IsGuardian
		}
	}

	relativeIDs := make([]int, 0, len(guardian))
	for id := range guardian {
		relativeIDs = append(relativeIDs, id)
	}
	slices.Sort(relativeIDs)

	placed := map[int][]aidAdult{}
	seen := map[int]bool{}
	for batch := range slices.Chunk(relativeIDs, aidAdultsBatchSize) {
		people, fetchErr := fetch(batch)
		if fetchErr != nil {
			return aidAdultsStats{}, fmt.Errorf("aid adults: fetching relatives: %w", fetchErr)
		}
		for _, person := range people {
			id, _ := person["ID"].(float64)
			cmID := int(id)
			if cmID <= 0 || seen[cmID] {
				continue
			}
			household, role := principalHousehold(person, cmID, targets)
			if household == 0 {
				continue
			}
			seen[cmID] = true
			name, _ := person["Name"].(map[string]any)
			placed[household] = append(placed[household], aidAdult{
				CMID:       cmID,
				First:      s.fixAllCapsName(s.getString(name, "First", "")),
				Last:       s.fixAllCapsName(s.getString(name, "Last", "")),
				Preferred:  s.fixAllCapsName(s.getString(name, "Preferred", "")),
				Role:       role,
				IsGuardian: guardian[cmID],
			})
		}
	}

	stats := aidAdultsStats{Households: len(placed), Adults: len(seen)}
	for _, adults := range placed {
		slices.SortFunc(adults, func(a, b aidAdult) int {
			return cmp.Or(cmp.Compare(a.Role, b.Role), cmp.Compare(a.Last, b.Last),
				cmp.Compare(a.First, b.First), cmp.Compare(a.CMID, b.CMID))
		})
	}
	updated, err := s.writeAidAdults(year, placed)
	stats.Updated = updated
	if err != nil {
		return stats, err
	}
	slog.Info("Aid adults synced", "year", year, "relatives", len(relativeIDs),
		"households", stats.Households, "adults", stats.Adults, "updated", stats.Updated)
	return stats, nil
}

// principalHousehold is the target household where the person holds a principal role, and
// that role; 0, 0 when there is none. The first such FamilyPersons entry wins, so a person is
// placed in exactly one household.
func principalHousehold(person map[string]any, cmID int, targets map[int]bool) (household, role int) {
	families, _ := person["FamilyPersons"].([]any)
	for _, item := range families {
		fp, ok := item.(map[string]any)
		if !ok {
			continue
		}
		if pid, ok := fp["PersonID"].(float64); ok && int(pid) != cmID {
			continue
		}
		familyID, _ := fp["FamilyID"].(float64)
		roleID, _ := fp["RoleID"].(float64)
		r := int(roleID)
		if (r == roleFirstPrincipal || r == roleSecondPrincipal) && targets[int(familyID)] {
			return int(familyID), r
		}
	}
	return 0, 0
}

// writeAidAdults stores each season household's list: placed's, or none. A household whose
// stored list already matches is not saved. Returns how many changed (counted on a dry run
// too, where nothing is written).
func (s *PersonsSync) writeAidAdults(year int, placed map[int][]aidAdult) (int, error) {
	records, err := s.App.FindRecordsByFilter("households", fmt.Sprintf("year = %d", year), "", 0, 0)
	if err != nil {
		return 0, fmt.Errorf("aid adults: reading households: %w", err)
	}
	updated := 0
	for _, record := range records {
		cmID := record.GetInt("cm_id")
		want := placed[cmID]
		if aidAdultsStored(record, want) {
			continue
		}
		updated++
		if s.DryRun {
			continue
		}
		if len(want) == 0 {
			record.Set(aidAdultsField, nil)
		} else {
			record.Set(aidAdultsField, want)
		}
		if err := s.App.Save(record); err != nil {
			return updated, fmt.Errorf("aid adults: saving household %d: %w", cmID, err)
		}
	}
	return updated, nil
}

// aidAdultsStored reports whether the record already holds want: the same entries, or no
// entries when want is empty. An unreadable stored value never matches, so it is rewritten.
func aidAdultsStored(record *core.Record, want []aidAdult) bool {
	stored := record.GetString(aidAdultsField)
	if stored == "" || stored == "null" {
		return len(want) == 0
	}
	var have []aidAdult
	if err := record.UnmarshalJSONField(aidAdultsField, &have); err != nil {
		slog.Warn("Unreadable aid_adults; rewriting it", "household", record.GetInt("cm_id"), "error", err)
		return false
	}
	return slices.Equal(have, want)
}
