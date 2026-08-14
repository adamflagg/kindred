package sync

import (
	"context"
	"strings"
	"testing"
)

// ============================================================================
// kindred#2274 -- six free-text registration columns kept one household
// member's answer and dropped the rest, and kindred#2276's live routing gap.
//
// A note on what is NOT tested here, because the issue bodies invite it and it
// would chase a ghost: the discarded winner is NOT random. loadPersonCustomValues
// sorts by id, so first-wins is deterministic against a given database --
// arbitrary, uncorrelated with recency or completeness, but not a coin flip. A
// flakiness test would pass for the wrong reason. The correct probe is
// order-independence, which TestProcessRegistrationsFreeTextIsOrderIndependent
// below runs over every permutation of a fixture.
// ============================================================================

// permutations returns every ordering of vals. The fixtures below are small on
// purpose -- 6 entries is 720 orderings, which runs in milliseconds and covers
// the input space exhaustively rather than sampling it.
func permutations(vals []customValueEntry) [][]customValueEntry {
	if len(vals) <= 1 {
		return [][]customValueEntry{append([]customValueEntry(nil), vals...)}
	}

	var out [][]customValueEntry
	for i := range vals {
		rest := make([]customValueEntry, 0, len(vals)-1)
		rest = append(rest, vals[:i]...)
		rest = append(rest, vals[i+1:]...)
		for _, p := range permutations(rest) {
			out = append(out, append([]customValueEntry{vals[i]}, p...))
		}
	}
	return out
}

// oneRegistration runs the production transform and returns the single
// household's row, failing if the fixture produced anything else.
func oneRegistration(t *testing.T, values []customValueEntry) *registrationData {
	t.Helper()

	s := NewFamilyCampDerivedSync(nil)
	regs := s.processRegistrations(nil, values)
	if len(regs) != 1 {
		t.Fatalf("registrations = %d, want 1", len(regs))
	}
	return regs[0]
}

// TestProcessRegistrationsJoinsDistinctFreeTextAnswers is kindred#2274 itself.
// Measured against the production snapshot: 810 answers over these six fields
// are discarded, 428 of them on Family Camp-Trans ETA -- the live one, which
// staff read to plan arrivals.
func TestProcessRegistrationsJoinsDistinctFreeTextAnswers(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name  string
		field string
		get   func(*registrationData) string
	}{
		{"share cabin preference", fieldShareCabinsRegistration,
			func(r *registrationData) string { return r.shareCabinPreference }},
		{"shared cabin modes", fieldSharedCabinForm,
			func(r *registrationData) string { return r.sharedCabinModesRaw }},
		{"arrival eta", "Family Camp-Trans ETA",
			func(r *registrationData) string { return r.arrivalETA }},
		{"special occasions", "Family Camp-Special occasions",
			func(r *registrationData) string { return r.specialOccasions }},
		{"goals", "Family Camp-Goals Attending",
			func(r *registrationData) string { return r.goals }},
		{"notes", "Family Camp-Anything else",
			func(r *registrationData) string { return r.notes }},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			reg := oneRegistration(t, []customValueEntry{
				{householdPBID: "hh_johnson", personPBID: "p_one",
					fieldName: tc.field, value: "answer alpha"},
				{householdPBID: "hh_johnson", personPBID: "p_two",
					fieldName: tc.field, value: "answer beta"},
			})

			got := tc.get(reg)
			if !strings.Contains(got, "answer alpha") || !strings.Contains(got, "answer beta") {
				t.Errorf("%s = %q; both household members' answers must survive", tc.field, got)
			}
		})
	}
}

// TestProcessRegistrationsDedupsRepeatedAnswers is the other half, and the
// reason a plain concatenation would be wrong. Sparsity outruns conflict about
// 5:1 on this path: most of the flatten is one parent's answer copied onto
// several children's forms, and joining those would double-count every request.
func TestProcessRegistrationsDedupsRepeatedAnswers(t *testing.T) {
	t.Parallel()

	reg := oneRegistration(t, []customValueEntry{
		{householdPBID: "hh_johnson", personPBID: "p_one",
			fieldName: "Family Camp-Trans ETA", value: "Friday around 4pm"},
		{householdPBID: "hh_johnson", personPBID: "p_two",
			fieldName: "Family Camp-Trans ETA", value: "  friday around 4PM "},
	})

	if reg.arrivalETA != "Friday around 4pm" {
		t.Errorf("arrivalETA = %q; one parent's answer fanned onto two children is ONE answer",
			reg.arrivalETA)
	}
}

// TestProcessRegistrationsFreeTextIsOrderIndependent is the probe kindred#2274's
// acceptance actually asks for. Permuting the input must not change the output
// at all -- not which answer wins, not the order they are joined in, not the
// casing that survives a dedup.
func TestProcessRegistrationsFreeTextIsOrderIndependent(t *testing.T) {
	t.Parallel()

	fixture := []customValueEntry{
		{householdPBID: "hh_garcia", personPBID: "p_one",
			fieldName: "Family Camp-Trans ETA", value: "Saturday morning"},
		{householdPBID: "hh_garcia", personPBID: "p_two",
			fieldName: "Family Camp-Trans ETA", value: "Friday night"},
		{householdPBID: "hh_garcia", personPBID: "p_two",
			fieldName: "Family Camp-Anything else", value: "We are driving up together"},
		{householdPBID: "hh_garcia", personPBID: "p_one",
			fieldName: "Family Camp-Special occasions", value: "Yes"},
		{householdPBID: "hh_garcia", personPBID: "p_one",
			fieldName: "Family Camp-describe special occasion", value: "A big birthday"},
		{householdPBID: "hh_garcia", personPBID: "p_two",
			fieldName: fieldSharedCabinForm, value: "Share a cabin with a specific family"},
	}

	orderings := permutations(fixture)
	if len(orderings) != 720 {
		t.Fatalf("permutations = %d, want 720", len(orderings))
	}

	want := *oneRegistration(t, orderings[0])
	for i, ordering := range orderings[1:] {
		got := *oneRegistration(t, ordering)
		if got != want {
			t.Fatalf("ordering %d produced a different row:\n got %+v\nwant %+v", i+1, got, want)
		}
	}
}

// TestProcessRegistrationsRoutesTheSpecialOccasionDescription is kindred#2276's
// one live gap: 343 values, 69 since 2025, 28 in 2026, synced and read by
// nothing. The gate it explains (Family Camp-Special occasions) IS consumed --
// and it is a bare Yes/No, so today the column stores "Yes" and throws away the
// sentence saying what the occasion was.
func TestProcessRegistrationsRoutesTheSpecialOccasionDescription(t *testing.T) {
	t.Parallel()

	reg := oneRegistration(t, []customValueEntry{
		{householdPBID: "hh_martinez", personPBID: "p_one",
			fieldName: "Family Camp-Special occasions", value: "Yes"},
		{householdPBID: "hh_martinez", personPBID: "p_one",
			fieldName: "Family Camp-describe special occasion", value: "Our tenth anniversary"},
	})

	if !strings.Contains(reg.specialOccasions, "Our tenth anniversary") {
		t.Errorf("specialOccasions = %q; the description is unrouted", reg.specialOccasions)
	}
	if !strings.Contains(reg.specialOccasions, "Yes") {
		t.Errorf("specialOccasions = %q; routing the description must not displace the gate",
			reg.specialOccasions)
	}
}

// TestProcessRegistrationsKeepsTheOccasionGateBoundToItsDescription pins the
// design rule in docs/reference/family-camp-field-provenance.md §4: a gate and
// its explain must stay bound to the SAME person through any transform, because
// otherwise the explanation staff read does not describe the need that raised
// the flag. Collapsing the two fields independently is what that rule forbids.
func TestProcessRegistrationsKeepsTheOccasionGateBoundToItsDescription(t *testing.T) {
	t.Parallel()

	reg := oneRegistration(t, []customValueEntry{
		// Two people, each answering the pair for themselves.
		{householdPBID: "hh_wilson", personPBID: "p_one",
			fieldName: "Family Camp-Special occasions", value: "Yes"},
		{householdPBID: "hh_wilson", personPBID: "p_one",
			fieldName: "Family Camp-describe special occasion", value: "A big birthday"},
		{householdPBID: "hh_wilson", personPBID: "p_two",
			fieldName: "Family Camp-Special occasions", value: "Yes"},
		{householdPBID: "hh_wilson", personPBID: "p_two",
			fieldName: "Family Camp-describe special occasion", value: "First trip since a loss"},
		// A third member answered only the gate, with the opposite answer.
		{householdPBID: "hh_wilson", personPBID: "p_three",
			fieldName: "Family Camp-Special occasions", value: "No"},
	})

	got := reg.specialOccasions
	for _, want := range []string{"A big birthday", "First trip since a loss", "No"} {
		if !strings.Contains(got, want) {
			t.Errorf("specialOccasions = %q; lost %q", got, want)
		}
	}
	// Each description must be preceded by the gate the same person gave, not
	// by whichever gate happened to be collapsed first.
	if !strings.Contains(got, "Yes; A big birthday") {
		t.Errorf("specialOccasions = %q; the first member's gate is not bound to their description", got)
	}
	if !strings.Contains(got, "Yes; First trip since a loss") {
		t.Errorf("specialOccasions = %q; the second member's gate is not bound to their description", got)
	}
}

// TestProcessRegistrationsCapsAJoinAtTheColumnLimit. arrival_eta is capped at
// 200 characters by migration 1500000035, and PocketBase REJECTS an over-cap
// text write rather than truncating it -- so an unbounded join would fail the
// whole row's save and leave the previous run's value in place. Measured
// against production: 3 household-years across 2017-2026 join past 200 (max
// 246). Whole answers are dropped, never half a sentence, and the loss is
// logged rather than silent.
func TestProcessRegistrationsCapsAJoinAtTheColumnLimit(t *testing.T) {
	t.Parallel()

	long := strings.Repeat("a", 90)
	reg := oneRegistration(t, []customValueEntry{
		{householdPBID: "hh_brown", personPBID: "p_one",
			fieldName: "Family Camp-Trans ETA", value: long},
		{householdPBID: "hh_brown", personPBID: "p_two",
			fieldName: "Family Camp-Trans ETA", value: strings.Repeat("b", 90)},
		{householdPBID: "hh_brown", personPBID: "p_three",
			fieldName: "Family Camp-Trans ETA", value: strings.Repeat("c", 90)},
	})

	if n := len([]rune(reg.arrivalETA)); n > maxArrivalETALen {
		t.Errorf("arrivalETA is %d runes, over the %d the column accepts -- the row's save would be rejected",
			n, maxArrivalETALen)
	}
	// Two whole answers fit (90 + 2 + 90 = 182); the third does not.
	if strings.Count(reg.arrivalETA, "; ") != 1 {
		t.Errorf("arrivalETA = %q; expected exactly two whole answers", reg.arrivalETA)
	}
	if strings.Contains(reg.arrivalETA, strings.Repeat("c", 90)[:5]) {
		t.Errorf("arrivalETA = %q; the third answer should have been dropped whole", reg.arrivalETA)
	}
}

// TestProcessRegistrationsIgnoresTheTwoRetiredQuestions. kindred#2276 names
// three unrouted fields and only one is live. Family Camp-Share Cabin With died
// after 2024 (867 lifetime values, 0 since) and Family Camp-Goals Other after
// 2018 (58, 0 since). Routing them is explicitly out of scope, and this pins
// that rather than leaving it to whoever reads the switch next.
func TestProcessRegistrationsIgnoresTheTwoRetiredQuestions(t *testing.T) {
	t.Parallel()

	s := NewFamilyCampDerivedSync(nil)
	regs := s.processRegistrations(nil, []customValueEntry{
		{householdPBID: "hh_lee", personPBID: "p_one",
			fieldName: "Family Camp-Share Cabin With", value: "the Johnson family"},
		{householdPBID: "hh_lee", personPBID: "p_one",
			fieldName: "Family Camp-Goals Other", value: "some retired answer"},
	})

	if len(regs) != 0 {
		t.Fatalf("registrations = %d, want 0 -- neither retired field is routed anywhere: %+v",
			len(regs), regs[0])
	}
}

// TestLoadPersonCustomValuesCarriesThePersonID is kindred#2257's step 0 in the
// small. customValueEntry discarded the person id at load, which is the root
// architectural cause of every first-wins site in this file: a transform that
// cannot see WHO answered cannot keep a gate bound to its explanation. Nothing
// downstream can be fixed properly until the id survives the load.
func TestLoadPersonCustomValuesCarriesThePersonID(t *testing.T) {
	t.Parallel()

	const year = 2026

	app := newFamilyCampReplayTestApp(t)
	seedDryRunFixture(t, app, year)

	s := NewFamilyCampDerivedSync(app)
	fieldNames, err := s.loadFieldDefinitions(context.Background())
	if err != nil {
		t.Fatalf("loadFieldDefinitions: %v", err)
	}
	personToHousehold, err := s.loadPersonHouseholdMapping(context.Background(), year)
	if err != nil {
		t.Fatalf("loadPersonHouseholdMapping: %v", err)
	}

	values, err := s.loadPersonCustomValues(context.Background(), year, fieldNames, personToHousehold)
	if err != nil {
		t.Fatalf("loadPersonCustomValues: %v", err)
	}
	if len(values) == 0 {
		t.Fatal("no person values loaded")
	}
	for _, v := range values {
		if v.personPBID == "" {
			t.Fatalf("entry %+v carries no person id", v)
		}
		if personToHousehold[v.personPBID] != v.householdPBID {
			t.Errorf("entry %+v: person id does not resolve back to its household", v)
		}
	}
}

// TestLoadHouseholdCustomValuesHasNoPersonID is the other side of the same
// contract. A household-partition value has no answering person, and inventing
// one -- or letting several fall into a shared empty-string bucket that reads
// as "one person" -- would silently merge distinct people's answers.
func TestLoadHouseholdCustomValuesHasNoPersonID(t *testing.T) {
	t.Parallel()

	const year = 2026

	app := newFamilyCampReplayTestApp(t)
	seedDryRunFixture(t, app, year)

	s := NewFamilyCampDerivedSync(app)
	fieldNames, err := s.loadFieldDefinitions(context.Background())
	if err != nil {
		t.Fatalf("loadFieldDefinitions: %v", err)
	}

	values, err := s.loadHouseholdCustomValues(context.Background(), year, fieldNames)
	if err != nil {
		t.Fatalf("loadHouseholdCustomValues: %v", err)
	}
	if len(values) == 0 {
		t.Fatal("no household values loaded")
	}
	for _, v := range values {
		if v.personPBID != "" {
			t.Errorf("household entry %+v claims a person id", v)
		}
	}
}
