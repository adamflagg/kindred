package sync

import (
	"fmt"
	"slices"
	"testing"
	"time"

	"github.com/camp/kindred/pocketbase/campminder"
	"github.com/pocketbase/pocketbase/core"
)

// The closed-season freeze (closed_season_freeze.go). CampMinder answers a past season with
// TODAY's household, so a re-read of a closed season (older than the synced pair N, N-1) must not
// rewrite that season's family structure: persons' household pointers, the season's households,
// and its automatic aid_household_links stay as they were. The open seasons behave as before.

// TestIsClosedSeason pins the rule: closed means older than the oldest synced season.
func TestIsClosedSeason(t *testing.T) {
	t.Setenv("CAMPMINDER_SEASON_ID", "")
	after := pacific(t, 2026, time.October, 17, 9, 0) // primary 2027: synced 2027, 2026
	before := pacific(t, 2026, time.October, 1, 9, 0) // primary 2026: synced 2026, 2025
	for _, tc := range []struct {
		now    time.Time
		year   int
		closed bool
	}{
		{after, 2017, true}, {after, 2019, true}, {after, 2025, true},
		{after, 2026, false}, {after, 2027, false}, {after, 2028, false},
		{before, 2024, true}, {before, 2025, false}, {before, 2026, false},
	} {
		if got := isClosedSeason(tc.year, tc.now); got != tc.closed {
			t.Errorf("isClosedSeason(%d, %s) = %v, want %v", tc.year, tc.now.Format(time.DateOnly), got, tc.closed)
		}
	}
	if !isClosedSeasonFor(2025, 2027) || isClosedSeasonFor(2026, 2027) || isClosedSeasonFor(2028, 2027) {
		t.Error("isClosedSeasonFor(year, 2027) must close 2025 and older, and only those")
	}

	// A season that cannot be resolved (an invalid override) freezes: the safe side for history.
	t.Setenv("CAMPMINDER_SEASON_ID", "not-a-year")
	if !isClosedSeason(2026, after) {
		t.Error("an unresolvable season must count as closed")
	}
}

// freezeFixture seeds households 7001 (A) and 7002 (B) for year, and person 5001 of that year
// pointing all three household relations at A. Returns the app, the person and the households.
func freezeFixture(t *testing.T, year int) (core.App, *core.Record, map[int]*core.Record) {
	t.Helper()
	app := newMinimalPersonsTestApp(t)
	householdsCol := core.NewBaseCollection("households")
	householdsCol.Fields.Add(&core.NumberField{Name: "cm_id"})
	householdsCol.Fields.Add(&core.NumberField{Name: "year"})
	if err := app.Save(householdsCol); err != nil {
		t.Fatalf("create households: %v", err)
	}
	byID := map[int]*core.Record{}
	for _, id := range []int{7001, 7002} {
		hh := core.NewRecord(householdsCol)
		hh.Set("cm_id", id)
		hh.Set("year", year)
		if err := app.Save(hh); err != nil {
			t.Fatalf("seed household: %v", err)
		}
		byID[id] = hh
	}
	personsCol, err := app.FindCollectionByNameOrId("persons")
	if err != nil {
		t.Fatalf("find persons: %v", err)
	}
	person := core.NewRecord(personsCol)
	person.Set("cm_id", 5001)
	person.Set("year", year)
	for _, f := range []string{"household", "primary_childhood_household", "alternate_childhood_household"} {
		person.Set(f, byID[7001].Id)
	}
	if err := app.Save(person); err != nil {
		t.Fatalf("seed person: %v", err)
	}
	return app, person, byID
}

// A closed season keeps an existing persons row's three household relations when CampMinder now
// names another household; an open season re-points them, as before.
func TestClosedSeasonReReadKeepsAnExistingPersonsHouseholds(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		name   string
		year   int
		closed bool
		want   int
	}{
		{"closed season keeps A", 2019, true, 7001},
		{"open season re-points to B", 2026, false, 7002},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			app, person, hh := freezeFixture(t, tc.year)
			s := NewPersonsSync(app, nil)
			if tc.closed {
				s.freeze = startClosedSeasonFreeze(tc.year, map[int]*core.Record{5001: person})
			}
			ids := map[int]personHouseholdIDs{5001: {PrincipalID: 7002, PrimaryChildhoodID: 7002, AlternateChildhoodID: 7002}}
			if err := s.updatePersonHouseholdRelations(tc.year, hh, ids); err != nil {
				t.Fatalf("update: %v", err)
			}
			got := reload(t, app, person.Id)
			for _, f := range []string{"household", "primary_childhood_household", "alternate_childhood_household"} {
				if got.GetString(f) != hh[tc.want].Id {
					t.Errorf("%s = %q, want household %d (%q)", f, got.GetString(f), tc.want, hh[tc.want].Id)
				}
			}
			if tc.closed && s.freeze.relationsKept != 3 {
				t.Errorf("relationsKept = %d, want 3", s.freeze.relationsKept)
			}
		})
	}
}

// A NEW persons row in a closed season changes no history, so it is linked like an open season's:
// to the season's household when one exists (counted), and to the household created for it when
// none did (see the households test below). It stays blank only when the household has no record
// at all, which happens only when its creation failed.
func TestClosedSeasonNewPersonIsLinkedToTheSeasonsHousehold(t *testing.T) {
	t.Parallel()
	const year = 2019
	app, existing, hh := freezeFixture(t, year)
	newID := saveRecord(t, app, "persons", map[string]any{"cm_id": 5002, "year": year})

	s := NewPersonsSync(app, nil)
	s.freeze = startClosedSeasonFreeze(year, map[int]*core.Record{5001: existing})
	ids := map[int]personHouseholdIDs{5002: {PrincipalID: 7002, PrimaryChildhoodID: 7999}}
	s.freeze.allowHouseholdsOfNewPersons(ids)
	if err := s.updatePersonHouseholdRelations(year, hh, ids); err != nil {
		t.Fatalf("update: %v", err)
	}
	got := reload(t, app, newID)
	if got.GetString("household") != hh[7002].Id {
		t.Errorf("household = %q, want the season's own household 7002 (%q)", got.GetString("household"), hh[7002].Id)
	}
	if s.freeze.newPersonLinksToExistingHouseholds != 1 {
		t.Errorf("newPersonLinksToExistingHouseholds = %d, want 1", s.freeze.newPersonLinksToExistingHouseholds)
	}
	if got.GetString("primary_childhood_household") != "" {
		t.Errorf("primary_childhood_household = %q, want blank: household 7999 has no record",
			got.GetString("primary_childhood_household"))
	}
	if s.freeze.newRelationsLeftBlank != 1 {
		t.Errorf("newRelationsLeftBlank = %d, want 1", s.freeze.newRelationsLeftBlank)
	}
	if s.freeze.relationsKept != 0 {
		t.Errorf("relationsKept = %d, want 0: linking a new row is not a re-point", s.freeze.relationsKept)
	}
}

// A closed season creates no household that only an EXISTING person names (today's household for
// someone the season already has), and creates, as CampMinder gives it, one a NEW person needs. An
// open season creates both. Either way an EXISTING household row still takes this run's fields
// (unchanged, and outside the freeze).
func TestClosedSeasonCreatesOnlyTheHouseholdsNewPersonsNeed(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		name   string
		year   int
		closed bool
	}{
		{"closed season", 2019, true},
		{"open season", 2026, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			app := newHouseholdsTestApp(t)
			seedHousehold(t, app, 7001, tc.year)
			s := NewPersonsSync(app, nil)
			if tc.closed {
				// 5001 had a row before this run; 5003 is new.
				s.freeze = startClosedSeasonFreeze(tc.year, map[int]*core.Record{5001: nil})
				s.freeze.allowHouseholdsOfNewPersons(map[int]personHouseholdIDs{
					5001: {PrincipalID: 7002},
					5003: {PrincipalID: 7003},
				})
			}
			existing := s.preloadExistingHouseholds(fmt.Sprintf("year = %d", tc.year), tc.year)
			payload := map[int]map[string]any{
				7001: {"ID": float64(7001), "Greeting": "today's greeting"},
				7002: {"ID": float64(7002), "Greeting": "today's household of a person the season has"},
				7003: {"ID": float64(7003), "Greeting": "the household of a person new to the season"},
			}
			stats := s.processHouseholds(payload, existing, tc.year)

			got := householdCMIDs(t, app, tc.year)
			if got[7002] == tc.closed {
				t.Errorf("household 7002 exists = %v, want %v", got[7002], !tc.closed)
			}
			if !got[7003] {
				t.Error("household 7003, needed by a new person, was not created")
			}
			wantCreated := 2
			if tc.closed {
				wantCreated = 1
				if s.freeze.householdsNotCreated != 1 {
					t.Errorf("householdsNotCreated = %d, want 1", s.freeze.householdsNotCreated)
				}
				if s.freeze.householdsCreatedForNewPersons != 1 {
					t.Errorf("householdsCreatedForNewPersons = %d, want 1", s.freeze.householdsCreatedForNewPersons)
				}
			}
			if stats.Created != wantCreated {
				t.Errorf("Created = %d, want %d", stats.Created, wantCreated)
			}
			rec, err := app.FindFirstRecordByFilter("households", fmt.Sprintf("cm_id = 7001 && year = %d", tc.year))
			if err != nil {
				t.Fatalf("find 7001: %v", err)
			}
			if rec.GetString("greeting") != "today's greeting" {
				t.Errorf("existing household greeting = %q; the freeze must leave field updates as they were",
					rec.GetString("greeting"))
			}
		})
	}
}

// The legacy FamilyPersons household_id is a household pointer too (aid attribution reads it):
// a closed season keeps an existing row's, an open season takes CampMinder's.
func TestClosedSeasonReReadKeepsAnExistingPersonsLegacyHouseholdID(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		name   string
		year   int
		closed bool
		want   int
	}{
		{"closed season keeps 7001", 2019, true, 7001},
		{"open season takes 7002", 2026, false, 7002},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			app := newPersonsTestApp(t)
			col, err := app.FindCollectionByNameOrId("persons")
			if err != nil {
				t.Fatalf("find persons: %v", err)
			}
			col.Fields.Add(&core.NumberField{Name: "household_id"})
			if saveErr := app.Save(col); saveErr != nil {
				t.Fatalf("add household_id: %v", saveErr)
			}
			id := saveRecord(t, app, "persons", map[string]any{"cm_id": 5001, "year": tc.year,
				"first_name": "Emma", "last_name": "Johnson", "is_camper": true, "household_id": 7001})

			s := NewPersonsSync(app, nil)
			existing := s.preloadExistingPersons(fmt.Sprintf("year = %d", tc.year), tc.year)
			if tc.closed {
				s.freeze = startClosedSeasonFreeze(tc.year, existing)
			}
			payload := validPersonData(5001)
			payload["FamilyPersons"] = []any{map[string]any{"FamilyID": float64(7002)}}
			if err := s.processPerson(payload, true, existing, map[string]string{}, map[int]string{}, tc.year); err != nil {
				t.Fatalf("processPerson: %v", err)
			}
			if got := reload(t, app, id).GetInt("household_id"); got != tc.want {
				t.Errorf("household_id = %d, want %d", got, tc.want)
			}
			if tc.closed && s.freeze.householdIDsKept != 1 {
				t.Errorf("householdIDsKept = %d, want 1", s.freeze.householdIDsKept)
			}
		})
	}
}

// A closed season's automatic aid_household_links are not re-derived from today's family
// structure, so a posting keeps the attribution it had; an open season re-derives them as before.
// The fixture's live season is 2026 (aidFixture.service), so 2024 is closed and 2026 open.
func TestClosedSeasonAutoLinksAreNotRederived(t *testing.T) {
	t.Parallel()
	type link struct {
		h      int
		key    string
		source string
	}
	for _, tc := range []struct {
		name       string
		year       int
		wantLinks  []link
		wantPerson int
	}{
		// The season's links as last derived joined 100 with 300; today's structure joins 100
		// with 200. Closed: kept as they were, and the posting on 300 still reaches the camper.
		{"closed season", 2024,
			[]link{{100, "hh-100", "auto"}, {300, "hh-100", "auto"}, {600, "hh-100", "staff"}}, 1001},
		{"open season", 2026,
			[]link{{100, "hh-100", "auto"}, {200, "hh-100", "auto"}, {600, "hh-100", "staff"}}, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			f := newAidFixture(t)
			f.session(11, "Session 2", "main", tc.year)
			for _, h := range []int{100, 200, 300, 600} {
				f.household(h, tc.year)
			}
			f.person(1001, tc.year, 100, 200)
			f.attend(1001, 11, 2, tc.year)
			for _, l := range []link{{100, "hh-100", "auto"}, {300, "hh-100", "auto"}, {600, "hh-100", "staff"}} {
				saveRecord(t, f.app, colAidHouseholdLinks, map[string]any{"year": tc.year, "household_cm_id": l.h,
					"family_key": l.key, "source": l.source})
			}
			f.txn(9001, tc.year, -500, aidCategoryFinancialAssistance, aidTestCampAid, 300, 0, 0, false)

			f.run("", tc.year)

			rows := f.rows(colAidHouseholdLinks, tc.year)
			got := make([]link, 0, len(rows))
			for _, r := range rows {
				got = append(got, link{r.GetInt("household_cm_id"), r.GetString("family_key"), r.GetString("source")})
			}
			slices.SortFunc(got, func(a, b link) int { return a.h - b.h })
			if !slices.Equal(got, tc.wantLinks) {
				t.Errorf("links = %v, want %v", got, tc.wantLinks)
			}
			if p := f.posting(9001); p.GetInt("attributed_person_cm_id") != tc.wantPerson {
				t.Errorf("posting on household 300 attributed to %d, want %d", p.GetInt("attributed_person_cm_id"),
					tc.wantPerson)
			}
		})
	}
}

// Every path that re-reads a closed season builds that season's own instances, and the freeze
// keys on the instance's season, so it holds on each path: the weekly all-seasons re-sync
// (runSeasonPassWith -> yearServices), and a historical replay or a named single-job run for a
// closed year (RunSyncWithOptions{Year} -> replayOverrides). The open seasons stay unfrozen.
func TestClosedSeasonFreezeReachesEveryPathThatReReadsAClosedSeason(t *testing.T) {
	t.Setenv("CAMPMINDER_PRIMARY_KEY", "test-key")
	t.Setenv("CAMPMINDER_SEASON_ID", "")
	withNow(t, pacific(t, 2026, time.October, 17, 9, 0)) // primary 2027; closed is 2025 and older
	o := newTestOrchestrator(t)
	boot, err := campminder.NewClient(&campminder.Config{APIKey: "k", ClientID: "c", SeasonID: 2027})
	if err != nil {
		t.Fatalf("campminder.NewClient: %v", err)
	}
	o.baseClient = boot

	personsFrozen := func(t *testing.T, svcs map[string]Service) bool {
		t.Helper()
		p, ok := svcs["persons"].(*PersonsSync)
		if !ok || p.Client == nil {
			t.Fatalf("persons instance = %T", svcs["persons"])
		}
		return p.seasonFreeze(p.Client.GetSeasonID(), nil) != nil
	}
	aidClosed := func(t *testing.T, svcs map[string]Service, year int) bool {
		t.Helper()
		a, ok := svcs["aid_postings"].(*AidPostingsSync)
		if !ok {
			t.Fatalf("aid_postings instance = %T", svcs["aid_postings"])
		}
		years, yErr := a.targetYears()
		if yErr != nil || !slices.Equal(years, []int{year}) {
			t.Fatalf("aid_postings for %d covers %v (%v)", year, years, yErr)
		}
		return a.seasonClosed(year)
	}

	// The weekly pass: every season it walks, through the persons job it runs.
	if !slices.Contains(allSeasonsResyncJobs, "persons") {
		t.Fatal("the weekly pass no longer runs persons; re-check what re-reads households")
	}
	seasons, err := HistoricalSeasons(nowFn())
	if err != nil || len(seasons) == 0 {
		t.Fatalf("HistoricalSeasons = %v, %v", seasons, err)
	}
	for _, year := range seasons {
		if !personsFrozen(t, o.yearServices(year, false)) {
			t.Errorf("weekly pass, %d: persons is not frozen", year)
		}
	}

	// A replay, or a named single job, of a closed year.
	replay := o.replayOverrides(2019, false)
	if !personsFrozen(t, replay) {
		t.Error("2019 replay: persons is not frozen")
	}
	if !aidClosed(t, replay, 2019) {
		t.Error("2019 replay: aid_postings would re-derive its auto links")
	}

	// The open seasons behave as before.
	for _, year := range []int{2027, 2026} {
		svcs := o.yearServices(year, false)
		if personsFrozen(t, svcs) {
			t.Errorf("open season %d: persons is frozen", year)
		}
		if aidClosed(t, svcs, year) {
			t.Errorf("open season %d: aid_postings treats it as closed", year)
		}
	}
	if NewPersonsSync(nil, boot).seasonFreeze(2027, nil) != nil {
		t.Error("the registered primary persons instance is frozen")
	}
	daily := NewAidPostingsSync(nil)
	window, err := daily.targetYears()
	if err != nil {
		t.Fatalf("daily window: %v", err)
	}
	for _, year := range window {
		if daily.seasonClosed(year) {
			t.Errorf("the daily window's %d is treated as closed", year)
		}
	}
}
