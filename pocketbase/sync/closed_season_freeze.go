package sync

import (
	"log/slog"

	"github.com/pocketbase/pocketbase/core"
)

// The closed-season freeze.
//
// CampMinder answers a past season with TODAY's household. Asked for a 2019 camper, it returns
// the household the person belongs to now, not the one they belonged to in 2019. So a re-read of
// a closed season (isClosedSeason: older than the synced pair N, N-1) used to overwrite that
// season's family structure with today's: the persons row was re-pointed at today's household,
// a household the season never had was created for it, and aid_postings re-derived the season's
// automatic household links from the result, moving where its postings were attributed. Every
// path that re-reads a closed season did it: a historical replay, a named single job for an old
// year, and the weekly all-seasons re-sync (all_seasons_resync.go), which walks 2017 to N-2
// every Saturday.
//
// For a closed season, then, a re-read:
//   - never changes an existing persons row's household pointers: the three relations
//     (household, primary_childhood_household, alternate_childhood_household) and the legacy
//     FamilyPersons household_id, which aid attribution also reads (loadPersonHouseholds);
//   - never creates a household record for a person the season already has. A person NEW to the
//     season changes no history, so it is linked to the season's household when one exists, and
//     the household is created, as CampMinder gives it, when none does (both counted);
//   - never re-derives that season's automatic aid_household_links (AidPostingsSync.seasonClosed).
//     Staff links were never touched and still are not.
//
// Everything else a re-read writes is unchanged: the persons row's other fields, an existing
// household row's fields (address, mailing title, phone), and the open seasons as a whole.
//
// The check is made once per run, from the season the run's own instance is for: PersonsSync's
// client season and AidPostingsSync's target year. Every path builds a season's own instances
// (servicesForYear), so no caller gates it.

// closedSeasonFreeze is one persons run's freeze of a closed season. nil on PersonsSync means the
// season is open and nothing is frozen.
type closedSeasonFreeze struct {
	year int
	// existingPersons is the season's persons rows as they stood before this run (by CampMinder
	// id). A row in it is frozen; a row this run created is not.
	existingPersons map[int]*core.Record

	relationsKept         int // relation changes refused on existing rows (a re-point, or a fill)
	householdIDsKept      int // legacy household_id changes refused on existing rows
	householdsNotCreated  int // households only existing persons name (today's, for someone the season has)
	newRelationsLeftBlank int // a new row's relation left blank: its household has no record

	householdsCreatedForNewPersons     int // households created because a new person needs them
	newPersonLinksToExistingHouseholds int // a new row's relation linked to a household the season had

	// newPersonHouseholds is every household a NEW person's payload names this run: the only
	// households the freeze lets the run create (allowHouseholdsOfNewPersons). created is the ones
	// it did create, so a link to one is not counted as a link to a pre-existing household.
	newPersonHouseholds map[int]bool
	created             map[int]bool
}

// allowHouseholdsOfNewPersons records the households this run's NEW persons name, so they may be
// created: a new person changes no history, and a blank household would throw away the only
// information there is. A household named only by existing persons is today's household for
// someone the season already has, and is not created. A nil freeze records nothing.
func (f *closedSeasonFreeze) allowHouseholdsOfNewPersons(personHouseholds map[int]personHouseholdIDs) {
	if f == nil {
		return
	}
	f.newPersonHouseholds = map[int]bool{}
	for personCMID, ids := range personHouseholds {
		if f.existed(personCMID) {
			continue
		}
		for _, id := range []int{ids.PrincipalID, ids.PrimaryChildhoodID, ids.AlternateChildhoodID} {
			if id > 0 {
				f.newPersonHouseholds[id] = true
			}
		}
	}
}

// startClosedSeasonFreeze freezes year, a season already known to be closed.
func startClosedSeasonFreeze(year int, existing map[int]*core.Record) *closedSeasonFreeze {
	return &closedSeasonFreeze{year: year, existingPersons: existing}
}

// seasonFreeze is the freeze a persons run of year starts: nil for an open season.
func (s *PersonsSync) seasonFreeze(year int, existing map[int]*core.Record) *closedSeasonFreeze {
	if !isClosedSeason(year, nowFn()) {
		return nil
	}
	slog.Info("Closed season: this re-read keeps existing household pointers and creates households only for new persons",
		"year", year)
	return startClosedSeasonFreeze(year, existing)
}

// existed reports whether the person had a row for the season before this run.
func (f *closedSeasonFreeze) existed(personCMID int) bool {
	_, ok := f.existingPersons[personCMID]
	return ok
}

// holds reports whether the freeze decides one of a person's household relations, counting what
// it refuses. record is the household this run's payload names, nil when the season has no record
// of it. An existing row's relation never changes, and neither does one that already holds a value
// (so a row the preload missed is still safe); a new row's is filled as in an open season, and left
// blank only when the household has no record (its creation failed). A nil freeze holds nothing.
func (f *closedSeasonFreeze) holds(personCMID int, current string, record *core.Record) bool {
	if f == nil {
		return false
	}
	if f.existed(personCMID) || current != "" {
		if record != nil && current != record.Id {
			f.relationsKept++
		}
		return true
	}
	if record == nil {
		f.newRelationsLeftBlank++
		return true
	}
	if !f.created[record.GetInt("cm_id")] {
		f.newPersonLinksToExistingHouseholds++
	}
	return false
}

// refusesNewHousehold reports, and counts, whether the freeze refuses to create household
// householdCMID: it creates only the households a new person needs (allowHouseholdsOfNewPersons).
// A nil freeze refuses nothing.
func (f *closedSeasonFreeze) refusesNewHousehold(householdCMID int) bool {
	if f == nil {
		return false
	}
	if f.newPersonHouseholds[householdCMID] {
		if f.created == nil {
			f.created = map[int]bool{}
		}
		f.created[householdCMID] = true
		f.householdsCreatedForNewPersons++
		return false
	}
	f.householdsNotCreated++
	return true
}

// keepLegacyHouseholdID drops a changed household_id from an existing row's update, so the row
// keeps the one it has. A nil freeze keeps nothing.
func (f *closedSeasonFreeze) keepLegacyHouseholdID(existing *core.Record, pbData map[string]any) {
	if f == nil {
		return
	}
	value, ok := pbData["household_id"]
	if !ok {
		return
	}
	if existing.GetInt("household_id") != toInt(value) {
		f.householdIDsKept++
	}
	delete(pbData, "household_id")
}

// log reports the run's counts: ids and counts only. Nothing for a nil freeze.
func (f *closedSeasonFreeze) log() {
	if f == nil {
		return
	}
	slog.Info("Closed season: family structure kept",
		"year", f.year,
		"relation_repoints_refused", f.relationsKept,
		"household_id_changes_refused", f.householdIDsKept,
		"households_not_created", f.householdsNotCreated,
		"households_created_for_new_persons", f.householdsCreatedForNewPersons,
		"new_person_links_to_existing_households", f.newPersonLinksToExistingHouseholds,
		"new_person_relations_left_blank", f.newRelationsLeftBlank)
}

// toInt reads a number the way pbData carries it (int from the transform, float64 from JSON).
func toInt(v any) int {
	switch n := v.(type) {
	case int:
		return n
	case float64:
		return int(n)
	}
	return 0
}

// seasonClosed reports whether year is a closed season for this run, whose automatic household
// links must not be re-derived. Season, when a test pins it, stands in for the primary, as it does
// for targetYears.
func (s *AidPostingsSync) seasonClosed(year int) bool {
	if s.Season != 0 {
		return isClosedSeasonFor(year, s.Season)
	}
	return isClosedSeason(year, nowFn())
}

// logHouseholdLinksKept reports what re-deriving a closed season's auto links would have done:
// the rows it would have created and the stored rows it would have swept. Counts only.
func logHouseholdLinksKept(year int, derived []aidHouseholdLink, stored map[string]*core.Record,
	staffKeys map[string]bool,
) {
	wanted := map[string]bool{}
	notCreated := 0
	for _, l := range derived {
		key := aidLinkKey(l.HouseholdCMID, l.FamilyKey)
		if staffKeys[key] {
			continue
		}
		wanted[key] = true
		if stored[key] == nil {
			notCreated++
		}
	}
	notSwept := 0
	for key := range stored {
		if !wanted[key] {
			notSwept++
		}
	}
	slog.Info("Closed season: automatic household links kept, not re-derived",
		"year", year, "stored_auto_links", len(stored),
		"links_not_created", notCreated, "links_not_swept", notSwept)
}
