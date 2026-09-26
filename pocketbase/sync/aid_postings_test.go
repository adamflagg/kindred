package sync

import (
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/pocketbase/dbx"
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
	if got := aidJSON(t, p, "flags"); !slices.Equal(got, []string{aidFlagFeeUnknown, aidFlagUnclassifiedSource}) {
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
	// Fee now known (3000 > 750): only the unclassified flag remains.
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
   "funder_type": "outside", "counts_as_aid": true, "full_coverage": true}
]}`

func TestAidPostingsSyncAppliesTheConfigFile(t *testing.T) {
	t.Parallel()
	f := newAidFixture(t)
	seedAidSiblings(f, 2026)
	f.txn(9010, 2026, -200, aidCategoryJFAM, aidTestIncentive, 100, 0, 0, false)
	f.txn(9011, 2026, -300, aidCategoryAdjustments, aidTestLegacy, 100, 0, 0, false)

	f.run(f.writeConfig(aidTestConfig), 2026)

	for _, s := range f.rows(colAidSources, 0) {
		if s.GetString("classified_by") != aidClassifiedConfigFile {
			t.Errorf("%s classified_by = %s", s.GetString("description_key"), s.GetString("classified_by"))
		}
		// Full-ride is a per-source attribute (default false), carried for SP6 and SP11.
		if want := s.GetString("description_key") == "legacy regional grant"; s.GetBool("full_coverage") != want {
			t.Errorf("%s full_coverage = %v, want %v", s.GetString("description_key"), s.GetBool("full_coverage"), want)
		}
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

// Review Focus 4.
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

	second := f.run(f.writeConfig(aidTestConfig), 2026)

	if st := second.GetStats(); st.Created != 0 || st.Updated != 0 || st.Deleted != 0 || st.Skipped != 2 {
		t.Fatalf("a re-run with no change must write nothing (one live row, one reversed row), got %+v", st)
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
	files := map[string]string{
		colAidSources:        "1500000196_aid_sources.js",
		colAidHouseholdLinks: "1500000197_aid_household_links.js",
		colAidPostings:       "1500000198_aid_postings.js",
		colAidOverrides:      "1500000199_aid_overrides_and_dispositions.js",
	}
	for name, file := range files {
		raw, err := os.ReadFile(filepath.Join("..", "pb_migrations", file))
		if err != nil {
			t.Fatalf("read %s: %v", file, err)
		}
		col, err := app.FindCollectionByNameOrId(name)
		if err != nil {
			t.Fatalf("fixture collection %s: %v", name, err)
		}
		for _, field := range col.Fields {
			if field.GetName() == "id" {
				continue
			}
			if !strings.Contains(string(raw), `name: "`+field.GetName()+`"`) {
				t.Errorf("fixture field %s.%s is not declared in %s", name, field.GetName(), file)
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

func TestAidPostingsSyncFlagsAidAboveTheBilledFee(t *testing.T) {
	t.Parallel()
	f := newAidFixture(t)
	seedAidSiblings(f, 2026)
	f.txn(9020, 2026, 500, aidTestFeeCat, "Session 2 Tuition", 100, 1001, 11, false)
	f.txn(9021, 2026, 5000, aidTestFeeCat, "Session 2 Tuition", 100, 1001, 11, true) // reversed: not a fee
	f.txn(9001, 2026, -750, aidCategoryFinancialAssistance, aidTestCampAid, 100, 1001, 0, false)

	f.run("", 2026)

	if got := aidJSON(t, f.posting(9001), "flags"); !slices.Contains(got, aidFlagExceedsFee) {
		t.Errorf("750 of aid against a 500 fee must flag, got %v", got)
	}
}
