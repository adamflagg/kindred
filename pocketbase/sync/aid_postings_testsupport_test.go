package sync

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

// newAidTestApp builds, in Go, every collection the aid_postings transform
// reads or writes, with only the fields it touches (the newSyncTestApp
// convention: a Go test cannot replay JS migrations). The unique indexes match
// pb_migrations/1500000196..199. CI's fixture-vs-schema diff (kindred#1921)
// covers newSyncTestApp only, so TestAidTestFixtureFieldsAreDeclaredInMigrations
// pins these aid_* field names to the migration text instead.
func newAidTestApp(t *testing.T) core.App {
	t.Helper()
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	t.Cleanup(app.Cleanup)

	sessions := core.NewBaseCollection("camp_sessions")
	sessions.Fields.Add(&core.NumberField{Name: "cm_id"})
	sessions.Fields.Add(&core.TextField{Name: "name"})
	sessions.Fields.Add(&core.TextField{Name: "session_type"})
	sessions.Fields.Add(&core.NumberField{Name: "year"})
	saveCollection(t, app, sessions)

	households := core.NewBaseCollection("households")
	households.Fields.Add(&core.NumberField{Name: "cm_id"})
	households.Fields.Add(&core.NumberField{Name: "year"})
	saveCollection(t, app, households)

	persons := core.NewBaseCollection("persons")
	persons.Fields.Add(&core.NumberField{Name: "cm_id"})
	persons.Fields.Add(&core.NumberField{Name: "year"})
	persons.Fields.Add(&core.NumberField{Name: "household_id"})
	for _, rel := range []string{"household", "primary_childhood_household", "alternate_childhood_household"} {
		persons.Fields.Add(&core.RelationField{Name: rel, CollectionId: households.Id, MaxSelect: 1})
	}
	saveCollection(t, app, persons)

	attendees := core.NewBaseCollection("attendees")
	attendees.Fields.Add(&core.NumberField{Name: "person_id"})
	attendees.Fields.Add(&core.RelationField{Name: "session", CollectionId: sessions.Id, MaxSelect: 1})
	attendees.Fields.Add(&core.NumberField{Name: "status_id"})
	attendees.Fields.Add(&core.NumberField{Name: "year"})
	saveCollection(t, app, attendees)

	fa := core.NewBaseCollection("financial_aid_applications")
	fa.Fields.Add(&core.NumberField{Name: "person_id"})
	fa.Fields.Add(&core.NumberField{Name: "year"})
	for _, f := range []string{"summer_program", "fc_program", "tbm_program"} {
		fa.Fields.Add(&core.TextField{Name: f})
	}
	saveCollection(t, app, fa)

	txns := core.NewBaseCollection("financial_transactions")
	for _, f := range []string{"cm_id", "year", "person_cm_id", "household_cm_id", "session_cm_id",
		"financial_category_cm_id"} {
		txns.Fields.Add(&core.NumberField{Name: f})
	}
	txns.Fields.Add(&core.NumberField{Name: "amount"})
	txns.Fields.Add(&core.BoolField{Name: "is_reversed"})
	txns.Fields.Add(&core.TextField{Name: "description"})
	txns.Fields.Add(&core.DateField{Name: "post_date"})
	txns.Fields.Add(&core.DateField{Name: "effective_date"})
	txns.Fields.Add(&core.DateField{Name: "reversal_date"})
	txns.Fields.Add(&core.TextField{Name: "transaction_note"})
	saveCollection(t, app, txns)

	sources := core.NewBaseCollection(colAidSources)
	for _, f := range []string{"description_key", "description", "source_name", "source_family", "funder_type",
		"classified_by", "note"} {
		sources.Fields.Add(&core.TextField{Name: f})
	}
	sources.Fields.Add(&core.BoolField{Name: "counts_as_aid"})
	sources.Fields.Add(&core.BoolField{Name: "counts_toward_budget"})
	sources.Fields.Add(&core.BoolField{Name: "incentive"})
	sources.Fields.Add(&core.TextField{Name: "grantor_key"})
	sources.Fields.Add(&core.JSONField{Name: "implied_program_families", MaxSize: 2000})
	sources.Indexes = []string{"CREATE UNIQUE INDEX `idx_aid_sources_description_key` " +
		"ON `aid_sources` (`description_key`)"}
	saveCollection(t, app, sources)

	links := core.NewBaseCollection(colAidHouseholdLinks)
	links.Fields.Add(&core.NumberField{Name: "year"})
	links.Fields.Add(&core.NumberField{Name: "household_cm_id"})
	links.Fields.Add(&core.TextField{Name: "family_key"})
	links.Fields.Add(&core.TextField{Name: "source"})
	links.Fields.Add(&core.BoolField{Name: "excluded"})
	links.Indexes = []string{"CREATE UNIQUE INDEX `idx_aid_household_links_household_family_year` " +
		"ON `aid_household_links` (`household_cm_id`, `family_key`, `year`)"}
	saveCollection(t, app, links)

	postings := core.NewBaseCollection(colAidPostings)
	for _, f := range []string{"year", "transaction_cm_id", "financial_category_cm_id", "household_cm_id", "person_cm_id",
		"attributed_person_cm_id", "attributed_session_cm_id"} {
		postings.Fields.Add(&core.NumberField{Name: f})
	}
	postings.Fields.Add(&core.NumberField{Name: "amount"})
	for _, f := range []string{"source_key", "effective_source_key", "source_family", "funder_type", "transaction_note",
		"program_family", "attribution_level", "attribution_method", "request_id"} {
		postings.Fields.Add(&core.TextField{Name: f})
	}
	postings.Fields.Add(&core.BoolField{Name: "is_reversed"})
	postings.Fields.Add(&core.BoolField{Name: "counts_toward_budget"})
	postings.Fields.Add(&core.DateField{Name: "post_date"})
	postings.Fields.Add(&core.DateField{Name: "effective_date"})
	postings.Fields.Add(&core.DateField{Name: "reversal_date"})
	postings.Fields.Add(&core.JSONField{Name: "candidate_program_families", MaxSize: 2000})
	postings.Fields.Add(&core.JSONField{Name: "flags", MaxSize: 2000})
	postings.Indexes = []string{"CREATE UNIQUE INDEX `idx_aid_postings_txn_amount_year` " +
		"ON `aid_postings` (`transaction_cm_id`, `amount`, `year`)"}
	saveCollection(t, app, postings)

	overrides := core.NewBaseCollection(colAidOverrides)
	for _, f := range []string{"year", "transaction_cm_id", "attributed_person_cm_id", "attributed_session_cm_id"} {
		overrides.Fields.Add(&core.NumberField{Name: f})
	}
	for _, f := range []string{"program_family", "source_key_override", "source"} {
		overrides.Fields.Add(&core.TextField{Name: f})
	}
	saveCollection(t, app, overrides)

	// Minimal sync_runs: only the columns the F2 stale-input check and the per-season ledger tick
	// check read (pocketbase/sync/sync_runs.go's real migration carries many more).
	runs := core.NewBaseCollection(syncRunsCollection)
	runs.Fields.Add(&core.TextField{Name: "service"})
	runs.Fields.Add(&core.TextField{Name: "status"})
	runs.Fields.Add(&core.TextField{Name: "trigger"})
	runs.Fields.Add(&core.NumberField{Name: "year"})
	runs.Fields.Add(&core.DateField{Name: "started"})
	runs.Fields.Add(&core.DateField{Name: "ended"})
	saveCollection(t, app, runs)

	return app
}

type aidFixture struct {
	t           *testing.T
	app         core.App
	sessionPB   map[int]string
	householdPB map[int]string
	configRoots []string
	configBase  string
}

func newAidFixture(t *testing.T) *aidFixture {
	t.Helper()
	// Hermetic: no candidate path can find a real config file.
	return &aidFixture{t: t, app: newAidTestApp(t), sessionPB: map[int]string{}, householdPB: map[int]string{},
		configRoots: []string{filepath.Join(t.TempDir(), "none")}, configBase: t.TempDir()}
}

func (f *aidFixture) session(cm int, name, sessionType string, year int) {
	f.sessionPB[cm] = saveRecord(f.t, f.app, "camp_sessions",
		map[string]any{"cm_id": cm, "name": name, "session_type": sessionType, "year": year})
}

func (f *aidFixture) household(cm, year int) {
	f.householdPB[cm] = saveRecord(f.t, f.app, "households", map[string]any{"cm_id": cm, "year": year})
}

// person saves a person whose own household is household; childhood[0] is the
// primary and childhood[1] the alternate childhood household.
func (f *aidFixture) person(cm, year, household int, childhood ...int) {
	values := map[string]any{"cm_id": cm, "year": year, "household_id": household, "household": f.householdPB[household]}
	for i, rel := range []string{"primary_childhood_household", "alternate_childhood_household"} {
		if i < len(childhood) {
			values[rel] = f.householdPB[childhood[i]]
		}
	}
	saveRecord(f.t, f.app, "persons", values)
}

func (f *aidFixture) attend(person, session, status, year int) {
	saveRecord(f.t, f.app, "attendees",
		map[string]any{"person_id": person, "session": f.sessionPB[session], "status_id": status, "year": year})
}

func (f *aidFixture) txn(
	cm, year int, amount float64, category int, description string, household, person, session int, reversed bool,
) string {
	return saveRecord(f.t, f.app, "financial_transactions", map[string]any{
		"cm_id": cm, "year": year, "amount": amount, "financial_category_cm_id": category, "description": description,
		"household_cm_id": household, "person_cm_id": person, "session_cm_id": session, "is_reversed": reversed,
		"post_date": "2026-03-02 00:00:00.000Z", "effective_date": "2026-03-02 00:00:00.000Z",
	})
}

// reversePair stores a reversed pair the way CampMinder returns it: both legs
// share the transaction id, carry is_reversed = true and the same reversal
// date, and differ in sign. amount is the credit leg (negative).
func (f *aidFixture) reversePair(
	cm, year int, amount float64, category int, description string, household, person int, reversalDate string,
) {
	for _, a := range []float64{amount, -amount} {
		saveRecord(f.t, f.app, "financial_transactions", map[string]any{
			"cm_id": cm, "year": year, "amount": a, "financial_category_cm_id": category, "description": description,
			"household_cm_id": household, "person_cm_id": person, "is_reversed": true,
			"post_date": "2026-03-02 00:00:00.000Z", "effective_date": "2026-03-02 00:00:00.000Z",
			"reversal_date": reversalDate, "transaction_note": "Reversed by a fictional staff user",
		})
	}
}

// reverseLive turns a stored live row into a reversed pair, as the next
// CampMinder fetch would after staff reverse it.
func (f *aidFixture) reverseLive(recordID, reversalDate string) {
	f.t.Helper()
	rec, err := f.app.FindRecordById("financial_transactions", recordID)
	if err != nil {
		f.t.Fatal(err)
	}
	rec.Set("is_reversed", true)
	rec.Set("reversal_date", reversalDate)
	if err := f.app.Save(rec); err != nil {
		f.t.Fatal(err)
	}
	saveRecord(f.t, f.app, "financial_transactions", map[string]any{
		"cm_id": rec.GetInt("cm_id"), "year": rec.GetInt("year"), "amount": -rec.GetFloat("amount"),
		"financial_category_cm_id": rec.GetInt("financial_category_cm_id"), "description": rec.GetString("description"),
		"household_cm_id": rec.GetInt("household_cm_id"), "person_cm_id": rec.GetInt("person_cm_id"), "is_reversed": true,
		"post_date": reversalDate, "effective_date": reversalDate, "reversal_date": reversalDate,
	})
}

func (f *aidFixture) writeConfig(doc string) string {
	path := filepath.Join(f.t.TempDir(), aidSourcesConfigFileName)
	if err := os.WriteFile(path, []byte(doc), 0o600); err != nil {
		f.t.Fatal(err)
	}
	return path
}

// recordSyncRun seeds a sync_runs row for the F2 stale-input check: aid_postings reads this
// table directly to learn whether financial_transactions' most recent run succeeded, rather
// than coupling to the orchestrator. started/ended are RFC3339; PocketBase stores and sorts
// them as its own DateTime string, so ordering by wall-clock time here matches ordering there.
func (f *aidFixture) recordSyncRun(service, status, started, ended string) {
	saveRecord(f.t, f.app, syncRunsCollection,
		map[string]any{"service": service, "status": status, "started": started, "ended": ended})
}

// recordSeasonRun records a finished run the way recordSyncRun does, with the trigger and the season
// year sync_runs carries, which the per-season ledger tick check reads.
func (f *aidFixture) recordSeasonRun(service, status, trigger string, year int, started, ended string) {
	saveRecord(f.t, f.app, syncRunsCollection, map[string]any{"service": service, "status": status,
		"trigger": trigger, "year": year, "started": started, "ended": ended})
}

// service is a hermetic AidPostingsSync: it can never find a real config file
// and never reads CAMPMINDER_SEASON_ID, so every test using it runs in parallel.
func (f *aidFixture) service() *AidPostingsSync {
	s := NewAidPostingsSync(f.app)
	s.ConfigRoots, s.ConfigBase, s.Season = f.configRoots, f.configBase, 2026
	return s
}

func (f *aidFixture) run(configPath string, year int) *AidPostingsSync {
	f.t.Helper()
	s := f.service()
	s.Year = year
	s.ConfigPath = configPath
	if err := s.Sync(f.t.Context()); err != nil {
		f.t.Fatalf("Sync: %v", err)
	}
	return s
}

func (f *aidFixture) rows(collection string, year int) []*core.Record {
	f.t.Helper()
	filter, params := "", dbx.Params{}
	if year != 0 {
		filter, params = "year = {:year}", dbx.Params{"year": year}
	}
	rows, err := findAllRecords(f.app, collection, filter, params)
	if err != nil {
		f.t.Fatal(err)
	}
	return rows
}

func (f *aidFixture) posting(txn int) *core.Record {
	f.t.Helper()
	rec, err := f.app.FindFirstRecordByFilter(colAidPostings, "transaction_cm_id = {:t}", dbx.Params{"t": txn})
	if err != nil {
		f.t.Fatalf("posting %d: %v", txn, err)
	}
	return rec
}

func aidJSON(t *testing.T, rec *core.Record, field string) []string {
	t.Helper()
	var out []string
	if err := rec.UnmarshalJSONField(field, &out); err != nil {
		t.Fatalf("%s: %v", field, err)
	}
	return out
}
