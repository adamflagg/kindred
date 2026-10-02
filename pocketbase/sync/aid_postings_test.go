package sync

import (
	"fmt"
	"maps"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"testing"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

const (
	aidTestCampAid   = "Example Camp Financial Assistance"
	aidTestIncentive = "Family Incentive Grant"
	aidTestLegacy    = "Legacy Regional Grant"
	aidTestFeeCat    = 5000 // a fictional non-aid fee category
)

// A household of two siblings: 1001 in summer session 11, 1002 in family session 21.
func seedAidSiblings(f *aidFixture, year int) {
	f.session(11, "Session 2", "main", year)
	f.session(12, "Session 3", "main", year)
	f.session(21, "Family Weekend 1", "family", year)
	f.household(100, year)
	f.person(1001, year, 100, 100)
	f.person(1002, year, 100, 100)
	f.attend(1001, 11, 2, year)
	f.attend(1002, 21, 2, year)
}

func TestAidPostingsSyncWritesAPostingAndAnUnclassifiedSource(t *testing.T) {
	t.Parallel()
	f := newAidFixture(t)
	seedAidSiblings(f, 2026)
	f.txn(9001, 2026, -750, aidCategoryFinancialAssistance, aidTestCampAid, 100, 1001, 0, false)

	f.run("", 2026)

	p := f.posting(9001)
	if p.GetString("attribution_level") != aidLevelSession ||
		p.GetString("attribution_method") != aidMethodPostedPersonSingle ||
		p.GetInt("attributed_person_cm_id") != 1001 || p.GetInt("attributed_session_cm_id") != 11 ||
		p.GetString("program_family") != programFamilySummer || p.GetFloat("amount") != -750 {
		t.Errorf("unexpected posting: %v", p.FieldsData())
	}
	if got := aidJSON(t, p, "flags"); !slices.Equal(got, []string{aidFlagUnclassifiedSource}) {
		t.Errorf("flags = %v", got)
	}
	sources := f.rows(colAidSources, 0)
	if len(sources) != 1 || sources[0].GetString("description_key") != "example camp financial assistance" ||
		sources[0].GetString("classified_by") != aidClassifiedUnclassified ||
		sources[0].GetString("description") != aidTestCampAid {
		t.Fatalf("expected one unclassified source, got %d", len(sources))
	}
}

func TestAidPostingsSyncSkipsReversingLegsZeroAndNonAidRows(t *testing.T) {
	t.Parallel()
	f := newAidFixture(t)
	seedAidSiblings(f, 2026)
	f.txn(9001, 2026, -750, aidCategoryFinancialAssistance, aidTestCampAid, 100, 1001, 0, false)
	// An orphan positive reversing leg: never stored (only credit legs are history).
	f.txn(9001, 2026, 750, aidCategoryFinancialAssistance, aidTestCampAid, 100, 1001, 0, true)
	f.txn(9003, 2026, 0, aidCategoryFinancialAssistance, "Application Marker", 100, 1001, 0, false)
	f.txn(9004, 2026, 3000, aidTestFeeCat, "Session 2 Tuition", 100, 1001, 11, false)
	f.txn(9005, 2026, -100, aidCategoryAdjustments, "Staff Discount", 100, 1001, 0, false)

	f.run("", 2026)

	if got := f.rows(colAidPostings, 2026); len(got) != 1 || got[0].GetInt("transaction_cm_id") != 9001 {
		t.Fatalf("expected only 9001, got %d postings", len(got))
	}
	if got := aidJSON(t, f.posting(9001), "flags"); !slices.Equal(got, []string{aidFlagUnclassifiedSource}) {
		t.Errorf("flags = %v", got)
	}
	// 3839 never auto-creates a source; the zero-amount marker's description is registered.
	sources := f.rows(colAidSources, 0)
	keys := make([]string, 0, len(sources))
	for _, r := range sources {
		keys = append(keys, r.GetString("description_key"))
	}
	slices.Sort(keys)
	if !slices.Equal(keys, []string{"application marker", "example camp financial assistance"}) {
		t.Errorf("source keys = %v", keys)
	}
}

const aidTestConfig = `{"sources": [
  {"description": "Example Camp Financial Assistance", "source_name": "Camp aid", "source_family": "camp_fa",
   "funder_type": "camp", "counts_as_aid": true, "counts_toward_budget": true},
  {"description": "Family Incentive Grant", "source_name": "Family incentive", "source_family": "jfam_incentive",
   "funder_type": "incentive", "counts_as_aid": true, "implied_program_families": ["family_camp"]},
  {"description": "Legacy Regional Grant", "source_name": "Legacy grant", "source_family": "other_outside",
   "funder_type": "outside", "counts_as_aid": true}
]}`

// aidTestConfigEdited is aidTestConfig after a later file edit: the camp aid renamed and
// no longer counting toward the budget, the legacy grant renamed and moved to an
// incentive with an implied family. D105: none of it may reach a row that exists.
const aidTestConfigEdited = `{"sources": [
  {"description": "Example Camp Financial Assistance", "source_name": "Camp aid (renamed)",
   "source_family": "camp_fa", "funder_type": "camp", "counts_as_aid": true, "counts_toward_budget": false},
  {"description": "Family Incentive Grant", "source_name": "Family incentive", "source_family": "jfam_incentive",
   "funder_type": "incentive", "counts_as_aid": true, "implied_program_families": ["family_camp"]},
  {"description": "Legacy Regional Grant", "source_name": "Legacy grant (renamed)", "source_family": "jfam_incentive",
   "funder_type": "incentive", "counts_as_aid": true, "implied_program_families": ["family_camp"]}
]}`

// source reads one aid_sources row by its description key.
func (f *aidFixture) source(key string) *core.Record {
	f.t.Helper()
	rec, err := f.app.FindFirstRecordByFilter(colAidSources, "description_key = {:k}", dbx.Params{"k": key})
	if err != nil {
		f.t.Fatalf("aid source %q: %v", key, err)
	}
	return rec
}

// aidSourceSnapshot is every aid_sources field the file, the app or the sync can set.
func aidSourceSnapshot(t *testing.T, rec *core.Record) map[string]string {
	t.Helper()
	out := map[string]string{}
	for _, f := range []string{"description", "source_name", "source_family", "funder_type", "classified_by",
		"note", "grantor_key"} {
		out[f] = rec.GetString(f)
	}
	for _, f := range []string{"counts_as_aid", "counts_toward_budget", "incentive"} {
		out[f] = strconv.FormatBool(rec.GetBool(f))
	}
	out["implied_program_families"] = strings.Join(aidJSON(t, rec, "implied_program_families"), ",")
	return out
}

// D105: the file seeds a description Kindred has no row for yet, with the file's
// classification, before any season runs -- so a posting under a file-named description
// is classified in the same run, never flagged unclassified (a fresh database seeds whole).
func TestAidPostingsSyncSeedsNewDescriptionsFromTheConfigFile(t *testing.T) {
	t.Parallel()
	f := newAidFixture(t)
	seedAidSiblings(f, 2026)
	f.txn(9010, 2026, -200, aidCategoryJFAM, aidTestIncentive, 100, 0, 0, false)
	f.txn(9011, 2026, -300, aidCategoryAdjustments, aidTestLegacy, 100, 0, 0, false)

	s := f.run(f.writeConfig(aidTestConfig), 2026)

	want := map[string]map[string]string{
		"example camp financial assistance": {"description": aidTestCampAid, "source_name": "Camp aid",
			"source_family": "camp_fa", "funder_type": "camp", "classified_by": aidClassifiedConfigFile, "note": "",
			"grantor_key": "", "counts_as_aid": "true", "counts_toward_budget": "true", "incentive": "false",
			"implied_program_families": ""},
		"family incentive grant": {"description": aidTestIncentive, "source_name": "Family incentive",
			"source_family": "jfam_incentive", "funder_type": "incentive", "classified_by": aidClassifiedConfigFile,
			"note": "", "grantor_key": "", "counts_as_aid": "true", "counts_toward_budget": "false",
			"incentive": "true", "implied_program_families": programFamilyFamilyCamp},
		"legacy regional grant": {"description": aidTestLegacy, "source_name": "Legacy grant",
			"source_family": "other_outside", "funder_type": "outside", "classified_by": aidClassifiedConfigFile,
			"note": "", "grantor_key": "", "counts_as_aid": "true", "counts_toward_budget": "false",
			"incentive": "false", "implied_program_families": ""},
	}
	if got := len(f.rows(colAidSources, 0)); got != len(want) {
		t.Fatalf("expected %d seeded sources, got %d", len(want), got)
	}
	for key, w := range want {
		if got := aidSourceSnapshot(t, f.source(key)); !maps.Equal(got, w) {
			t.Errorf("%s = %v, want %v", key, got, w)
		}
	}
	if st := s.GetStats(); st.Created != len(want)+2 {
		t.Errorf("three seeded sources and two postings are created, got %+v", st)
	}
	inc := f.posting(9010)
	if inc.GetString("attribution_method") != aidMethodSourceImplied || inc.GetInt("attributed_session_cm_id") != 21 {
		t.Errorf("incentive grant must follow its implied family to session 21: %v", inc.FieldsData())
	}
	legacy := f.posting(9011) // 3839, included only because the file says it counts as aid
	if legacy.GetString("attribution_level") != aidLevelAmbiguous ||
		!slices.Equal(aidJSON(t, legacy, "candidate_program_families"),
			[]string{programFamilyFamilyCamp, programFamilySummer}) {
		t.Errorf("legacy grant must be ambiguous across both families: %v", legacy.FieldsData())
	}
	if flags := aidJSON(t, legacy, "flags"); slices.Contains(flags, aidFlagUnclassifiedSource) {
		t.Errorf("a classified source must not be flagged: %v", flags)
	}
}

// D105: once a description has a row, a later edit to the file never reaches it -- the
// fight between a file edit and an app edit that D105 removes. The grantor mapped in
// between (FastAPI's PUT /sources/{id}/grantor) survives, and the postings keep the
// classification the row holds.
func TestAidPostingsSyncNeverOverwritesASeededRowWhenTheFileChanges(t *testing.T) {
	t.Parallel()
	f := newAidFixture(t)
	seedAidSiblings(f, 2026)
	f.txn(9001, 2026, -750, aidCategoryFinancialAssistance, aidTestCampAid, 100, 1001, 0, false)
	f.txn(9011, 2026, -300, aidCategoryAdjustments, aidTestLegacy, 100, 0, 0, false)
	f.run(f.writeConfig(aidTestConfig), 2026)

	legacy := f.source(normalizeAidLabel(aidTestLegacy))
	legacy.Set("grantor_key", "legacy_fund")
	if err := f.app.Save(legacy); err != nil {
		t.Fatal(err)
	}
	before := map[string]map[string]string{}
	for _, r := range f.rows(colAidSources, 0) {
		before[r.GetString("description_key")] = aidSourceSnapshot(t, r)
	}

	s := f.run(f.writeConfig(aidTestConfigEdited), 2026)

	for key, want := range before {
		if got := aidSourceSnapshot(t, f.source(key)); !maps.Equal(got, want) {
			t.Errorf("the edited file reached %s: got %v, want %v", key, got, want)
		}
	}
	if p := f.posting(9011); p.GetString("attribution_level") != aidLevelAmbiguous {
		t.Errorf("9011 must keep its row's classification (ambiguous), got %v", p.FieldsData())
	}
	if p := f.posting(9001); !p.GetBool("counts_toward_budget") {
		t.Errorf("9001 must keep counting toward the budget, got %v", p.FieldsData())
	}
	if st := s.GetStats(); st.Created != 0 || st.Updated != 0 || st.Deleted != 0 {
		t.Errorf("an edited file over existing rows must write nothing, got %+v", st)
	}
}

// D105 Decision 2: a description that posted before the file named it already has a row,
// the sync's own unclassified placeholder. The file never fills it (staff classify it in
// the app); the file's other, new descriptions are still seeded.
func TestAidPostingsSyncLeavesAnExistingUnclassifiedRowToTheApp(t *testing.T) {
	t.Parallel()
	f := newAidFixture(t)
	seedAidSiblings(f, 2026)
	f.txn(9001, 2026, -750, aidCategoryFinancialAssistance, aidTestCampAid, 100, 1001, 0, false)
	f.run("", 2026)
	key := normalizeAidLabel(aidTestCampAid)
	before := aidSourceSnapshot(t, f.source(key))

	f.run(f.writeConfig(aidTestConfig), 2026)

	after := aidSourceSnapshot(t, f.source(key))
	if after["classified_by"] != aidClassifiedUnclassified || !maps.Equal(before, after) {
		t.Errorf("the file filled an existing unclassified row: got %v, want %v", after, before)
	}
	if flags := aidJSON(t, f.posting(9001), "flags"); !slices.Equal(flags, []string{aidFlagUnclassifiedSource}) {
		t.Errorf("9001 must stay flagged unclassified until staff classify it, got %v", flags)
	}
	for _, k := range []string{normalizeAidLabel(aidTestIncentive), normalizeAidLabel(aidTestLegacy)} {
		if got := f.source(k).GetString("classified_by"); got != aidClassifiedConfigFile {
			t.Errorf("%s classified_by = %q, want the file's new description seeded", k, got)
		}
	}
}

// Nothing else changes (D105): a dry run with the file seeds a new description in memory
// only, so a posting that counts only through the file is still computed, and no row is
// written.
func TestAidPostingsSyncDryRunSeedsNoSourceRow(t *testing.T) {
	t.Parallel()
	f := newAidFixture(t)
	seedAidSiblings(f, 2026)
	f.txn(9011, 2026, -300, aidCategoryAdjustments, aidTestLegacy, 100, 0, 0, false)
	s := f.service()
	s.Year, s.DryRun, s.ConfigPath = 2026, true, f.writeConfig(aidTestConfig)
	if err := s.Sync(t.Context()); err != nil {
		t.Fatal(err)
	}
	if n := len(f.rows(colAidSources, 0)); n != 0 {
		t.Fatalf("a dry run wrote %d source rows", n)
	}
	// 9011 is category 3839: it is aid only because the in-memory seed says so.
	if st := s.GetStats(); st.Created != 1 {
		t.Errorf("a dry run must report the would-be 3839 posting, got %+v", st)
	}
}

func TestAidPostingsSyncNeverOverwritesAStaffClassification(t *testing.T) {
	t.Parallel()
	f := newAidFixture(t)
	seedAidSiblings(f, 2026)
	saveRecord(t, f.app, colAidSources, map[string]any{"description_key": "example camp financial assistance",
		"source_name": "Staff wording", "source_family": "camp_fa", "funder_type": "camp",
		"counts_as_aid": true, "classified_by": aidClassifiedStaff})
	f.txn(9001, 2026, -750, aidCategoryFinancialAssistance, aidTestCampAid, 100, 1001, 0, false)

	f.run(f.writeConfig(aidTestConfig), 2026)

	rec, err := f.app.FindFirstRecordByFilter(colAidSources, "description_key = {:k}",
		dbx.Params{"k": "example camp financial assistance"})
	if err != nil || rec.GetString("source_name") != "Staff wording" ||
		rec.GetString("classified_by") != aidClassifiedStaff {
		t.Fatalf("staff classification was overwritten: %v %v", rec, err)
	}
}

// Review Focus 4, extended: a rerun must not just write nothing, it must report every
// unchanged row -- across all three collections this sync writes (postings, the auto
// household links, and config-classified sources) -- as Skipped, the same way every
// comparable job (financial_aid_applications.go, financial_transactions.go,
// base_sync.go's ProcessSimpleRecord) counts an unchanged upsert. Before this fix the
// Aid Ledger admin card showed no counts at all on a no-change rerun, while every other
// sync card shows "N skipped".
func TestAidPostingsSyncRerunIsANoOp(t *testing.T) {
	t.Parallel()
	f := newAidFixture(t)
	seedAidSiblings(f, 2026)
	f.household(200, 2026)
	f.person(1003, 2026, 200, 100, 200) // links 100 and 200
	f.attend(1003, 12, 2, 2026)
	f.txn(9001, 2026, -750, aidCategoryFinancialAssistance, aidTestCampAid, 100, 0, 0, false)
	f.reversePair(9002, 2026, -400, aidCategoryFinancialAssistance, aidTestCampAid, 100, 1002, "2026-03-20 18:00:00.000Z")
	f.run(f.writeConfig(aidTestConfig), 2026)

	wantSkipped := len(f.rows(colAidSources, 0)) + len(f.rows(colAidHouseholdLinks, 2026)) +
		len(f.rows(colAidPostings, 2026))
	if wantSkipped == 0 {
		t.Fatal("test setup produced nothing to skip on the rerun")
	}

	second := f.run(f.writeConfig(aidTestConfig), 2026)

	if st := second.GetStats(); st.Created != 0 || st.Updated != 0 || st.Deleted != 0 || st.Skipped != wantSkipped {
		t.Fatalf("a re-run with no change must write nothing and report every unchanged row "+
			"(sources + links + postings = %d) as skipped, got %+v", wantSkipped, st)
	}
}

// Review Focus 6, and spec §5 "Reversed rows are kept with their reversal date".
func TestAidPostingsSyncKeepsAReversedPostingAsHistory(t *testing.T) {
	t.Parallel()
	f := newAidFixture(t)
	seedAidSiblings(f, 2026)
	id := f.txn(9001, 2026, -750, aidCategoryFinancialAssistance, aidTestCampAid, 100, 1001, 0, false)
	f.reversePair(9002, 2026, -400, aidCategoryFinancialAssistance, aidTestCampAid, 100, 1002, "2026-03-20 18:00:00.000Z")
	f.run("", 2026)

	if got := f.rows(colAidPostings, 2026); len(got) != 2 {
		t.Fatalf("one live row and one reversed credit leg, got %d rows", len(got))
	}
	old := f.posting(9002)
	if !old.GetBool("is_reversed") || old.GetFloat("amount") != -400 ||
		old.GetDateTime("reversal_date").String() != "2026-03-20 18:00:00.000Z" ||
		old.GetInt("attributed_person_cm_id") != 1002 || old.GetString("program_family") != programFamilyFamilyCamp ||
		old.GetString("transaction_note") == "" {
		t.Errorf("the reversed posting must be kept, dated, attributed and annotated: %v", old.FieldsData())
	}
	if flags := aidJSON(t, old, "flags"); len(flags) != 0 {
		t.Errorf("a reversed history row carries no flags, got %v", flags)
	}

	f.reverseLive(id, "2026-04-01 16:00:00.000Z")
	s := f.run("", 2026)

	if got := f.rows(colAidPostings, 2026); len(got) != 2 {
		t.Fatalf("reversing 9001 must keep its row, got %d rows", len(got))
	}
	if p := f.posting(9001); !p.GetBool("is_reversed") || p.GetFloat("amount") != -750 {
		t.Errorf("9001 must now read as reversed history: %v", p.FieldsData())
	}
	if st := s.GetStats(); st.Deleted != 0 || st.Updated != 1 {
		t.Errorf("a reversal is one update and no delete, got %+v", st)
	}
}

func TestAidPostingsSyncSweepsARowThatIsNoLongerAid(t *testing.T) {
	t.Parallel()
	f := newAidFixture(t)
	seedAidSiblings(f, 2026)
	f.txn(9001, 2026, -750, aidCategoryFinancialAssistance, aidTestCampAid, 100, 1001, 0, false)
	f.txn(9002, 2026, -400, aidCategoryFinancialAssistance, "Placeholder Credit", 100, 1002, 0, false)
	f.run("", 2026)

	rec, err := f.app.FindFirstRecordByFilter(colAidSources, "description_key = {:k}",
		dbx.Params{"k": "placeholder credit"})
	if err != nil {
		t.Fatal(err)
	}
	rec.Set("source_family", "placeholder")
	rec.Set("funder_type", "camp")
	rec.Set("counts_as_aid", false)
	rec.Set("classified_by", aidClassifiedStaff)
	if err := f.app.Save(rec); err != nil {
		t.Fatal(err)
	}
	s := f.run("", 2026)

	if got := f.rows(colAidPostings, 2026); len(got) != 1 || got[0].GetInt("transaction_cm_id") != 9001 {
		t.Fatalf("9002 is no longer aid and must be swept, got %d postings", len(got))
	}
	if s.GetStats().Deleted != 1 {
		t.Errorf("Deleted = %d", s.GetStats().Deleted)
	}
}

// Review Focus 7: outside money booked as camp aid, with fictional descriptions.
func TestAidPostingsSyncReclassifiesAPostingThroughAnOverride(t *testing.T) {
	t.Parallel()
	f := newAidFixture(t)
	seedAidSiblings(f, 2026)
	f.txn(9001, 2026, -750, aidCategoryFinancialAssistance, aidTestCampAid, 100, 1001, 0, false)
	f.txn(9002, 2026, -400, aidCategoryFinancialAssistance, aidTestCampAid, 100, 1002, 0, false)
	saveRecord(t, f.app, colAidOverrides, map[string]any{"year": 2026, "transaction_cm_id": 9001,
		"source_key_override": "outside program award (reclassified)", "source": aidOverrideSourceStaff})
	config := `{"sources": [
  {"description": "Example Camp Financial Assistance", "source_name": "Camp aid", "source_family": "camp_fa",
   "funder_type": "camp", "counts_as_aid": true, "counts_toward_budget": true},
  {"description": "Outside Program Award (reclassified)", "source_name": "Outside program",
   "source_family": "other_outside",
   "funder_type": "outside", "counts_as_aid": true, "counts_toward_budget": false}
]}`

	f.run(f.writeConfig(config), 2026)

	p := f.posting(9001)
	if p.GetString("source_key") != "example camp financial assistance" ||
		p.GetString("effective_source_key") != "outside program award (reclassified)" ||
		p.GetString("source_family") != "other_outside" || p.GetString("funder_type") != "outside" ||
		p.GetBool("counts_toward_budget") {
		t.Errorf("9001 must keep its own description and take the target's classification: %v", p.FieldsData())
	}
	if p.GetString("attribution_level") != aidLevelSession ||
		p.GetString("attribution_method") != aidMethodPostedPersonSingle {
		t.Errorf("a reclassify-only override must leave placement to inference: %v", p.FieldsData())
	}
	if q := f.posting(9002); q.GetString("source_family") != aidSourceFamilyCampFA || !q.GetBool("counts_toward_budget") {
		t.Errorf("9002 has no override and keeps its own classification: %v", q.FieldsData())
	}
}

// CI's fixture-vs-schema diff covers newSyncTestApp only. This keeps
// newAidTestApp honest about the aid_* collections it hand-builds.
func TestAidTestFixtureFieldsAreDeclaredInMigrations(t *testing.T) {
	t.Parallel()
	app := newAidTestApp(t)
	files := map[string][]string{
		colAidSources:        {"1500000196_aid_sources.js", "1500000210_aid_grantors_and_grants.js"},
		colAidHouseholdLinks: {"1500000197_aid_household_links.js"},
		colAidPostings:       {"1500000198_aid_postings.js"},
		colAidOverrides:      {"1500000199_aid_overrides_and_dispositions.js"},
	}
	for name, list := range files {
		var raw strings.Builder
		for _, file := range list {
			b, err := os.ReadFile(filepath.Join("..", "pb_migrations", file))
			if err != nil {
				t.Fatalf("read %s: %v", file, err)
			}
			raw.Write(b)
		}
		col, err := app.FindCollectionByNameOrId(name)
		if err != nil {
			t.Fatalf("fixture collection %s: %v", name, err)
		}
		for _, field := range col.Fields {
			if field.GetName() == "id" {
				continue
			}
			if !strings.Contains(raw.String(), `name: "`+field.GetName()+`"`) {
				t.Errorf("fixture field %s.%s is not declared in %v", name, field.GetName(), list)
			}
		}
	}
}

// Review Focus 3.
func TestAidPostingsSyncKeepsPostingsWhenTheSeasonHasNoTransactions(t *testing.T) {
	t.Parallel()
	f := newAidFixture(t)
	seedAidSiblings(f, 2026)
	f.txn(9001, 2026, -750, aidCategoryFinancialAssistance, aidTestCampAid, 100, 1001, 0, false)
	f.run("", 2026)

	if _, err := f.app.DB().NewQuery("DELETE FROM financial_transactions").Execute(); err != nil {
		t.Fatal(err)
	}
	f.run("", 2026)

	if got := f.rows(colAidPostings, 2026); len(got) != 1 {
		t.Fatalf("an empty season must not sweep its postings, got %d", len(got))
	}
}

// Review Focus 2, plus staff links and the stale-auto sweep.
func TestAidPostingsSyncHouseholdLinks(t *testing.T) {
	t.Parallel()
	f := newAidFixture(t)
	f.session(11, "Session 2", "main", 2026)
	f.session(41, "Adult Weekend", "adult", 2026)
	for _, h := range []int{100, 200, 300, 400, 600} {
		f.household(h, 2026)
	}
	f.person(1001, 2026, 100, 100, 200) // camper: primary 100, alternate 200
	f.attend(1001, 11, 2, 2026)
	f.person(1005, 2026, 300, 400) // adult guest whose childhood home is 400
	f.attend(1005, 41, 2, 2026)
	f.person(1006, 2026, 400) // someone in the parents' household, enrolled in summer
	f.attend(1006, 11, 2, 2026)
	saveRecord(t, f.app, colAidHouseholdLinks, map[string]any{"year": 2026, "household_cm_id": 500,
		"family_key": "hh-500", "source": aidLinkSourceAuto}) // stale
	saveRecord(t, f.app, colAidHouseholdLinks, map[string]any{"year": 2026, "household_cm_id": 600,
		"family_key": "hh-100", "source": aidLinkSourceStaff}) // staff merge
	f.txn(9001, 2026, -500, aidCategoryFinancialAssistance, aidTestCampAid, 200, 0, 0, false) // other parent's home
	f.txn(9002, 2026, -300, aidCategoryFinancialAssistance, aidTestCampAid, 300, 0, 0, false) // the adult guest
	f.txn(9003, 2026, -100, aidCategoryFinancialAssistance, aidTestCampAid, 600, 0, 0, false) // staff-merged home
	// Fix round 1 probe: a posting on the parents' own household 400, with no
	// person, must reach sibling camper 1006 (summer session 11) and never the
	// adult guest 1005, even though 1005's childhood household is also 400.
	f.txn(9004, 2026, -200, aidCategoryFinancialAssistance, aidTestCampAid, 400, 0, 0, false)

	f.run("", 2026)

	type link struct {
		h      int
		key    string
		source string
	}
	linkRows := f.rows(colAidHouseholdLinks, 2026)
	got := make([]link, 0, len(linkRows))
	for _, r := range linkRows {
		got = append(got, link{r.GetInt("household_cm_id"), r.GetString("family_key"), r.GetString("source")})
	}
	slices.SortFunc(got, func(a, b link) int { return a.h - b.h })
	want := []link{{100, "hh-100", "auto"}, {200, "hh-100", "auto"}, {600, "hh-100", "staff"}}
	if !slices.Equal(got, want) {
		t.Errorf("links = %v, want %v (no 300/400 link; stale 500 swept; staff 600 kept)", got, want)
	}
	if p := f.posting(9001); p.GetInt("attributed_person_cm_id") != 1001 {
		t.Errorf("the other parent's posting must reach the camper through the link: %v", p.FieldsData())
	}
	if p := f.posting(9002); p.GetInt("attributed_person_cm_id") != 1005 ||
		p.GetString("program_family") != programFamilyAdultWeekend {
		t.Errorf("the adult guest's posting must not reach the parents' household: %v", p.FieldsData())
	}
	if p := f.posting(9003); p.GetInt("attributed_person_cm_id") != 1001 {
		t.Errorf("a staff link must join household 600 to the family: %v", p.FieldsData())
	}
	if p := f.posting(9004); p.GetInt("attributed_person_cm_id") != 1006 ||
		p.GetString("attribution_level") != aidLevelSession || p.GetString("program_family") != programFamilySummer {
		t.Errorf("a posting on the parents' household must reach the sibling camper, "+
			"not the adult guest whose childhood home is the same household: %v", p.FieldsData())
	}
}

func TestAidPostingsSyncAppliesAnOverride(t *testing.T) {
	t.Parallel()
	f := newAidFixture(t)
	seedAidSiblings(f, 2026)
	f.txn(9001, 2026, -750, aidCategoryFinancialAssistance, aidTestCampAid, 100, 0, 0, false)
	saveRecord(t, f.app, colAidOverrides, map[string]any{"year": 2026, "transaction_cm_id": 9001,
		"attributed_person_cm_id": 1001, "attributed_session_cm_id": 12, "source": aidOverrideSourceStaff})

	f.run("", 2026)

	p := f.posting(9001)
	if p.GetString("attribution_level") != aidLevelOverride ||
		p.GetString("attribution_method") != aidMethodOverrideStaff ||
		p.GetInt("attributed_session_cm_id") != 12 || p.GetString("program_family") != programFamilySummer {
		t.Errorf("override not applied: %v", p.FieldsData())
	}
}

func TestAidPostingsSyncDryRunWritesNothing(t *testing.T) {
	t.Parallel()
	f := newAidFixture(t)
	seedAidSiblings(f, 2026)
	f.txn(9001, 2026, -750, aidCategoryFinancialAssistance, aidTestCampAid, 100, 1001, 0, false)
	s := f.service()
	s.Year, s.DryRun = 2026, true
	if err := s.Sync(t.Context()); err != nil {
		t.Fatal(err)
	}
	if len(f.rows(colAidPostings, 0)) != 0 || len(f.rows(colAidSources, 0)) != 0 ||
		len(f.rows(colAidHouseholdLinks, 0)) != 0 {
		t.Fatal("dry run wrote rows")
	}
	if s.GetStats().Created != 1 {
		t.Errorf("dry run must report the would-be posting, got %+v", s.GetStats())
	}
}

func TestAidPostingsSyncDailyRunCoversTheSeasonWindow(t *testing.T) {
	t.Parallel()
	f := newAidFixture(t) // its service() pins Season 2026, the window's middle year
	for _, y := range []int{2024, 2025, 2027} {
		f.household(100+y, y)
		f.txn(9000+y, y, -100, aidCategoryFinancialAssistance, aidTestCampAid, 100+y, 0, 0, false)
	}
	f.run("", 0)
	for y, want := range map[int]int{2024: 0, 2025: 1, 2027: 1} {
		if got := len(f.rows(colAidPostings, y)); got != want {
			t.Errorf("season %d: %d postings, want %d", y, got, want)
		}
	}
}

// TestDailyQueueRunsAidPostingsOverTheSeasonWindow drives aid_postings through
// runSyncAndWait, the path every current-season queue (the 3am daily, a current-year
// full run) takes. runSyncAndWait resets a YearSetter to the live season before Sync,
// and for aid_postings that is not neutral: a non-zero Year pins ONE season, while 0
// is the N-1..N+1 window the design gives the daily run. Pinned, the ledger stopped
// refreshing N-1 and N+1 even though financial_transactions still re-syncs them daily,
// which matters most right after the season switch, when N-1 is the season whose tail
// staff still work.
//
// Registered in serialGroups: CAMPMINDER_SEASON_ID is t.Setenv.
func TestDailyQueueRunsAidPostingsOverTheSeasonWindow(t *testing.T) {
	t.Setenv("CAMPMINDER_SEASON_ID", "2026")
	f := newAidFixture(t)
	for _, y := range []int{2025, 2026, 2027} {
		f.household(100+y, y)
		f.txn(9000+y, y, -100, aidCategoryFinancialAssistance, aidTestCampAid, 100+y, 0, 0, false)
	}
	o := NewOrchestrator(nil)
	o.RegisterService("aid_postings", f.service())

	origin := newBatch(triggerDaily)
	o.registerBatch(origin.batchID)
	if err := o.runSyncAndWait(t.Context(), "aid_postings", origin); err != nil {
		t.Fatalf("runSyncAndWait: %v", err)
	}
	for _, y := range []int{2025, 2026, 2027} {
		if got := len(f.rows(colAidPostings, y)); got != 1 {
			t.Errorf("season %d: %d postings, want 1 (the daily run covers N-1..N+1)", y, got)
		}
	}

	// A named season still pins: a historical replay or an explicit ?year= run covers
	// that season alone.
	historical := newBatch(triggerHistorical).forYear(2027)
	o.registerBatch(historical.batchID)
	if err := o.runSyncAndWait(t.Context(), "aid_postings", historical); err != nil {
		t.Fatalf("runSyncAndWait (historical): %v", err)
	}
	if got := o.GetService("aid_postings").(*AidPostingsSync).Year; got != 2027 {
		t.Errorf("a historical origin must pin the season: Year = %d, want 2027", got)
	}
}

// Review Focus (item 2): a sweep-guard refusal on one season in the N-1..N+1
// window must not stop the others -- SP1's financial_transactions.go pattern
// (log, continue, join the errors) is what aid_postings.go must copy.
func TestAidPostingsSyncASeasonGuardRefusalDoesNotStopTheOthers(t *testing.T) {
	t.Parallel()
	f := newAidFixture(t) // its service() pins Season 2026, the window's middle year

	// Season 2025 (N-1): one aid posting exists from an earlier run.
	f.household(1100, 2025)
	f.txn(9101, 2025, -100, aidCategoryFinancialAssistance, aidTestLegacy, 1100, 0, 0, false)
	f.run("", 2025)
	if got := len(f.rows(colAidPostings, 2025)); got != 1 {
		t.Fatalf("setup: expected one 2025 posting, got %d", got)
	}

	// Staff reclassify its source as not aid, so a rerun computes zero drafts
	// for 2025 while financial_transactions for 2025 still has rows -- exactly
	// the collapse OrphanSweepGuard exists to refuse.
	rec, err := f.app.FindFirstRecordByFilter(colAidSources, "description_key = {:k}",
		dbx.Params{"k": normalizeAidLabel(aidTestLegacy)})
	if err != nil {
		t.Fatal(err)
	}
	rec.Set("counts_as_aid", false)
	rec.Set("classified_by", aidClassifiedStaff)
	if err = f.app.Save(rec); err != nil {
		t.Fatal(err)
	}

	// Season 2026 (N, live): an ordinary aid posting.
	f.household(1200, 2026)
	f.txn(9102, 2026, -200, aidCategoryFinancialAssistance, aidTestCampAid, 1200, 0, 0, false)

	s := f.service()
	s.Year = 0
	err = s.Sync(f.t.Context())
	if err == nil {
		t.Fatal("expected Sync to return the joined refusal error")
	}
	if !strings.Contains(err.Error(), "2025") {
		t.Errorf("error should name the refused season: %v", err)
	}

	if got := len(f.rows(colAidPostings, 2026)); got != 1 {
		t.Errorf("season 2026 (the live season) must still be written despite 2025's refusal, got %d postings", got)
	}
	if got := len(f.rows(colAidPostings, 2025)); got != 1 {
		t.Errorf("season 2025's stale posting must be left alone (a refused sweep deletes nothing), got %d", got)
	}
}

// ---------------------------------------------------------------------------
// F1/P1: a missing classification file, or a heavily-unclassified season, must
// be loud (prod ran a whole season silently unclassified and nothing warned).
// ---------------------------------------------------------------------------

// TestAidPostingsSyncLogsMissingClassificationFileWithSearchedPaths pins the log line itself,
// not just the counter: F1's failure was specifically that nothing named the searched paths,
// so an operator had nothing to go check. captureSweepLogs swaps the process-global slog
// default -- registered in pocketbase/main_test_parallelism_test.go's serial list.
func TestAidPostingsSyncLogsMissingClassificationFileWithSearchedPaths(t *testing.T) {
	f := newAidFixture(t)
	seedAidSiblings(f, 2026)
	f.txn(9001, 2026, -750, aidCategoryFinancialAssistance, aidTestCampAid, 100, 1001, 0, false)

	logs := captureSweepLogs(t)
	f.run("", 2026)

	for _, want := range []string{
		filepath.Join(f.configRoots[0], aidSourcesConfigFileName),
		filepath.Join(f.configBase, "config", aidSourcesConfigFileName),
		filepath.Join(f.configBase, "..", "config", aidSourcesConfigFileName),
	} {
		if !strings.Contains(logs.String(), want) {
			t.Errorf("log must name the searched path %q; got:\n%s", want, logs.String())
		}
	}
}

// TestAidPostingsSyncCountsAWarningWhenNoClassificationFileIsFound: the run must still
// succeed (F1 -- this is a warning, never a failure), but must not be silent about it.
// Stats.AidLedgerWarnings is its own warn-only, non-fatal counter, reaching sync_runs via
// recordSyncRun -- NOT Stats.Rejected, which rejection_sites_test.go pins to per-record
// transform rejections and which also suppresses the collection's orphan sweep for the run.
func TestAidPostingsSyncCountsAWarningWhenNoClassificationFileIsFound(t *testing.T) {
	t.Parallel()
	f := newAidFixture(t)
	seedAidSiblings(f, 2026)
	f.txn(9001, 2026, -750, aidCategoryFinancialAssistance, aidTestCampAid, 100, 1001, 0, false)

	s := f.run("", 2026)

	if got := s.GetStats().AidLedgerWarnings; got < 1 {
		t.Errorf("a missing classification file must count as a warning, got AidLedgerWarnings=%d", got)
	}
}

// TestAidPostingsSyncNoWarningsOnAHealthyRun: a config file classifying every live source,
// with none of F1/F2's conditions true, must not warn at all -- the negative space the two
// tests above need to mean anything.
func TestAidPostingsSyncNoWarningsOnAHealthyRun(t *testing.T) {
	t.Parallel()
	f := newAidFixture(t)
	seedAidSiblings(f, 2026)
	f.txn(9001, 2026, -750, aidCategoryFinancialAssistance, aidTestCampAid, 100, 1001, 0, false)

	s := f.run(f.writeConfig(aidTestConfig), 2026)

	if got := s.GetStats().AidLedgerWarnings; got != 0 {
		t.Errorf("a healthy run (classified, no stale input) must not warn, got AidLedgerWarnings=%d", got)
	}
}

// TestAidPostingsSyncWarnsWhenMoreThanHalfOfLiveAidIsUnclassified: a config file is present
// (so the missing-file warning above cannot be why this fires) but most of the season's
// aid descriptions are not in it -- the data-quality signal F1 also asked for.
func TestAidPostingsSyncWarnsWhenMoreThanHalfOfLiveAidIsUnclassified(t *testing.T) {
	t.Parallel()
	f := newAidFixture(t)
	seedAidSiblings(f, 2026)
	f.txn(9001, 2026, -750, aidCategoryFinancialAssistance, aidTestCampAid, 100, 1001, 0, false) // classified
	f.txn(9002, 2026, -100, aidCategoryFinancialAssistance, "Mystery Grant A", 100, 1002, 0, false)
	f.txn(9003, 2026, -200, aidCategoryFinancialAssistance, "Mystery Grant B", 100, 1002, 0, false)
	f.txn(9004, 2026, -300, aidCategoryFinancialAssistance, "Mystery Grant C", 100, 1002, 0, false)

	s := f.run(f.writeConfig(aidTestConfig), 2026)

	if s.GetStats().AidLedgerWarnings < 1 {
		t.Errorf("3 of 4 live postings unclassified must warn, got AidLedgerWarnings=%d", s.GetStats().AidLedgerWarnings)
	}
}

// TestAidPostingsSyncDoesNotWarnAtExactlyHalfUnclassified: the threshold is MORE than half,
// so an even split must stay quiet.
func TestAidPostingsSyncDoesNotWarnAtExactlyHalfUnclassified(t *testing.T) {
	t.Parallel()
	f := newAidFixture(t)
	seedAidSiblings(f, 2026)
	f.txn(9001, 2026, -750, aidCategoryFinancialAssistance, aidTestCampAid, 100, 1001, 0, false) // classified
	f.txn(9002, 2026, -750, aidCategoryFinancialAssistance, aidTestCampAid, 100, 1002, 0, false) // classified
	f.txn(9003, 2026, -100, aidCategoryFinancialAssistance, "Mystery Grant A", 100, 1002, 0, false)
	f.txn(9004, 2026, -200, aidCategoryFinancialAssistance, "Mystery Grant B", 100, 1002, 0, false)

	s := f.run(f.writeConfig(aidTestConfig), 2026)

	if got := s.GetStats().AidLedgerWarnings; got != 0 {
		t.Errorf("exactly half unclassified must not warn, got AidLedgerWarnings=%d", got)
	}
}

// ---------------------------------------------------------------------------
// F2/P2(b): financial_transactions failing earlier in the same run must not let
// aid_postings report clean success off yesterday's data.
// ---------------------------------------------------------------------------

// TestAidPostingsSyncWarnsWhenTransactionsLastRunFailed: financial_transactions' most recent
// sync_runs row failed. aid_postings must still run (from the last good data) but must not be
// silent about it.
func TestAidPostingsSyncWarnsWhenTransactionsLastRunFailed(t *testing.T) {
	f := newAidFixture(t)
	seedAidSiblings(f, 2026)
	f.txn(9001, 2026, -750, aidCategoryFinancialAssistance, aidTestCampAid, 100, 1001, 0, false)
	f.recordSyncRun(serviceNameFinancialTransactions, statusSuccess,
		"2026-09-25T10:00:00.000Z", "2026-09-25T10:02:00.000Z")
	f.recordSyncRun(serviceNameFinancialTransactions, statusFailed,
		"2026-09-27T10:00:00.000Z", "2026-09-27T10:05:00.000Z")

	logs := captureSweepLogs(t)
	s := f.run(f.writeConfig(aidTestConfig), 2026)

	// Exactly one: the fixture wires no ledger tick trigger, so the skipped-tick warning stays silent.
	if s.GetStats().AidLedgerWarnings != 1 {
		t.Errorf("financial_transactions' last run failing must count as one warning, got AidLedgerWarnings=%d",
			s.GetStats().AidLedgerWarnings)
	}
	// The as-of time is the last SUCCESSFUL run's end, not the failed run's.
	if !strings.Contains(logs.String(), "2026-09-25 10:02:00") {
		t.Errorf("log must name the last successful run's as-of time, got:\n%s", logs.String())
	}
}

// TestAidPostingsSyncNoStaleWarningWhenTransactionsLastRunSucceeded: the common case -- last
// night's transactions sync was clean, so aid_postings must not warn about staleness at all.
func TestAidPostingsSyncNoStaleWarningWhenTransactionsLastRunSucceeded(t *testing.T) {
	t.Parallel()
	f := newAidFixture(t)
	seedAidSiblings(f, 2026)
	f.txn(9001, 2026, -750, aidCategoryFinancialAssistance, aidTestCampAid, 100, 1001, 0, false)
	f.recordSyncRun(serviceNameFinancialTransactions, statusSuccess,
		"2026-09-27T10:00:00.000Z", "2026-09-27T10:02:00.000Z")

	s := f.run(f.writeConfig(aidTestConfig), 2026)

	if got := s.GetStats().AidLedgerWarnings; got != 0 {
		t.Errorf("a successful last transactions run must not warn about staleness, got AidLedgerWarnings=%d", got)
	}
}

// Ruling 2026-10-01 (plan review): the sweep deletes stale automatic links by
// record id from a read it took earlier. A person who turns one of them into a
// staff exclusion meanwhile (FastAPI's create_link updates the row in place:
// source "staff", excluded) must keep it: the sweep deletes only a row that is
// STILL automatic when it deletes.
func TestAidPostingsSweepKeepsALinkStaffExcludedDuringTheSync(t *testing.T) {
	t.Parallel()
	f := newAidFixture(t)
	f.session(11, "Session 2", "main", 2026)
	for _, h := range []int{100, 200} {
		f.household(h, 2026)
	}
	f.person(1001, 2026, 100, 100, 200) // camper: primary 100, alternate 200 -> auto links 100 and 200
	f.attend(1001, 11, 2, 2026)
	f.txn(9001, 2026, -500, aidCategoryFinancialAssistance, aidTestCampAid, 200, 0, 0, false)
	for _, h := range []int{500, 700} { // two stale automatic links: the sweep deletes both
		saveRecord(t, f.app, colAidHouseholdLinks, map[string]any{"year": 2026, "household_cm_id": h,
			"family_key": fmt.Sprintf("hh-%d", h), "source": aidLinkSourceAuto})
	}

	// When the sweep deletes the first stale row, a person excludes the OTHER one,
	// which the sweep read as automatic and has not deleted yet.
	excluded := 0
	f.app.OnRecordDelete(colAidHouseholdLinks).BindFunc(func(e *core.RecordEvent) error {
		if excluded != 0 {
			return e.Next()
		}
		excluded = 500
		if e.Record.GetInt("household_cm_id") == 500 {
			excluded = 700
		}
		other, err := e.App.FindFirstRecordByFilter(colAidHouseholdLinks,
			"year = 2026 && household_cm_id = {:h}", map[string]any{"h": excluded})
		if err != nil {
			return fmt.Errorf("finding the link to exclude: %w", err)
		}
		other.Set("source", aidLinkSourceStaff)
		other.Set("excluded", true)
		if err := e.App.Save(other); err != nil {
			return fmt.Errorf("excluding: %w", err)
		}
		return e.Next()
	})

	f.run("", 2026)

	if excluded == 0 {
		t.Fatal("the hook never fired, so this test exercised nothing")
	}
	var kept []string
	for _, r := range f.rows(colAidHouseholdLinks, 2026) {
		if h := r.GetInt("household_cm_id"); h == 500 || h == 700 {
			kept = append(kept, fmt.Sprintf("%d %s excluded=%v", h, r.GetString("source"), r.GetBool("excluded")))
		}
	}
	want := []string{fmt.Sprintf("%d staff excluded=true", excluded)}
	if !slices.Equal(kept, want) {
		t.Errorf("stale links after the sweep = %v, want %v: the staff exclusion was deleted", kept, want)
	}
}
