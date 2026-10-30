package aidform

import (
	"slices"
	"testing"
)

// The fictional weekend pool. Session ids are generic.
const (
	weekendA = 1000101
	weekendB = 1000102
)

func pool() []Person {
	return []Person{
		{PersonCMID: 1000001, HouseholdCMID: 2000001, First: "Rachel", Last: "Garcia", Birthdate: "1971-04-02",
			Emails: []string{"rgarcia@example.com"}, Sessions: []int{weekendA}},
		{PersonCMID: 1000002, HouseholdCMID: 2000002, First: "Grace", Last: "Chen-Whitfield", Birthdate: "1980-06-15",
			Emails: []string{"grace@example.com", "gcw@example.com"}, Sessions: []int{weekendA}},
		{PersonCMID: 1000003, HouseholdCMID: 2000003, First: "Dana", Last: "Okafor", Birthdate: "1979-01-20",
			Emails: []string{"dana@example.com"}, Sessions: []int{weekendA}},
		{PersonCMID: 1000004, HouseholdCMID: 2000004, First: "Dana", Last: "Okafor", Birthdate: "1990-11-03",
			Emails: []string{"dokafor@example.com"}, Sessions: []int{weekendA}},
		{PersonCMID: 1000005, HouseholdCMID: 2000005, First: "Olivia", Preferred: "Liv", Last: "Chen",
			Birthdate: "1985-03-09", Emails: []string{"olivia@example.com"}, Sessions: []int{weekendA}},
	}
}

func TestMatchOutcomes(t *testing.T) {
	t.Parallel()
	elsewhere := []Person{
		{PersonCMID: 1000020, HouseholdCMID: 2000020, First: "Emma", Last: "Johnson", Birthdate: "1975-07-07",
			Emails: []string{"emma@example.com"}, Sessions: []int{weekendB}},
	}
	cases := []struct {
		name       string
		id         Identity
		wantStatus string
		wantPerson int
		wantSigs   int
		wantCands  []int
	}{
		{"all three signals", Identity{Name: "Rachel Garcia", Birthdate: "1971-04-02", Email: "rgarcia@example.com"},
			StatusAuto, 1000001, 3, []int{1000001}},
		{"name and birthdate, partner's email",
			Identity{Name: "Rachel Garcia", Birthdate: "1971-04-02", Email: "partner@example.com"},
			StatusAuto, 1000001, 2, []int{1000001}},
		{"case, accents and spacing fold",
			Identity{Name: "  RACHEL   García ", Birthdate: "1971-04-02", Email: ""}, StatusAuto, 1000001, 2, []int{1000001}},
		{"one token of a hyphenated surname, plus birthdate and email",
			Identity{Name: "Grace Whitfield", Birthdate: "1980-06-15", Email: "GCW@example.com"},
			StatusAuto, 1000002, 3, []int{1000002}},
		{"the hyphenated surname typed with a space",
			Identity{Name: "Grace Chen Whitfield", Birthdate: "1980-06-15", Email: ""}, StatusAuto, 1000002, 2, []int{1000002}},
		{"preferred name counts as the first name",
			Identity{Name: "Liv Chen", Birthdate: "1985-03-09", Email: ""}, StatusAuto, 1000005, 2, []int{1000005}},
		{"birthdate and email without the name",
			Identity{Name: "R. G.", Birthdate: "1971-04-02", Email: "rgarcia@example.com"},
			StatusAuto, 1000001, 2, []int{1000001}},
		{"name only, two namesakes: suggested with both",
			Identity{Name: "Dana Okafor", Birthdate: "1960-01-01", Email: "partner@example.com"},
			StatusSuggested, 0, 1, []int{1000003, 1000004}},
		{"one signal: suggested",
			Identity{Name: "Gracie Chen", Birthdate: "1980-06-15", Email: "other@example.com"},
			StatusSuggested, 0, 1, []int{1000002}},
		{"a day/month swap is not a birthdate hit",
			Identity{Name: "Rachel Garcia", Birthdate: "1971-02-04", Email: "other@example.com"},
			StatusSuggested, 0, 1, []int{1000001}},
		{"registered for another weekend",
			Identity{Name: "Emma Johnson", Birthdate: "1975-07-07", Email: "emma@example.com"},
			StatusRegisteredElsewhere, 0, 3, []int{1000020}},
		{"no 2027 registration at all",
			Identity{Name: "Liam Garcia", Birthdate: "1999-09-09", Email: "liam@example.com"}, StatusNotRegistered, 0, 0, nil},
		{"the surname token must be the TYPED part, never the reverse",
			Identity{Name: "Grace Chen-Whitfield-Lee", Birthdate: "", Email: ""}, StatusNotRegistered, 0, 0, nil},
		{"nothing typed", Identity{}, StatusUnmatched, 0, 0, nil},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got := Match(tc.id, pool(), elsewhere)
			if got.Status != tc.wantStatus || got.PersonCMID != tc.wantPerson || got.Signals != tc.wantSigs {
				t.Errorf("Match = {%s person=%d signals=%d}, want {%s person=%d signals=%d}",
					got.Status, got.PersonCMID, got.Signals, tc.wantStatus, tc.wantPerson, tc.wantSigs)
			}
			var ids []int
			for _, c := range got.Candidates {
				ids = append(ids, c.PersonCMID)
			}
			if !slices.Equal(ids, tc.wantCands) {
				t.Errorf("candidates = %v, want %v", ids, tc.wantCands)
			}
		})
	}
}

// The auto match records the household and the evidence, CampMinder ids only.
func TestMatchAutoCarriesHouseholdAndEvidence(t *testing.T) {
	t.Parallel()
	got := Match(Identity{Name: "Rachel Garcia", Birthdate: "1971-04-02", Email: "x@example.com"}, pool(), nil)
	if got.HouseholdCMID != 2000001 {
		t.Errorf("household = %d, want 2000001", got.HouseholdCMID)
	}
	if len(got.Candidates) != 1 || !slices.Equal(got.Candidates[0].Signals, []string{SignalName, SignalBirthdate}) ||
		!slices.Equal(got.Candidates[0].SessionCMIDs, []int{weekendA}) {
		t.Errorf("evidence = %+v", got.Candidates)
	}
}

// GF-1 = A is "exactly one person with 2 of 3". Two people with two signals
// each (a mother and daughter sharing a name and an email) are never auto.
func TestMatchTwoStrongCandidatesAreSuggested(t *testing.T) {
	t.Parallel()
	p := []Person{
		{PersonCMID: 1000030, HouseholdCMID: 2000030, First: "Riley", Last: "Sam", Birthdate: "1970-05-05",
			Emails: []string{"sam@example.com"}, Sessions: []int{weekendA}},
		{PersonCMID: 1000031, HouseholdCMID: 2000030, First: "Riley", Last: "Sam", Birthdate: "2001-05-05",
			Emails: []string{"sam@example.com"}, Sessions: []int{weekendA}},
	}
	got := Match(Identity{Name: "Riley Sam", Birthdate: "1970-05-05", Email: "sam@example.com"}, p, nil)
	if got.Status != StatusSuggested || got.PersonCMID != 0 {
		t.Errorf("Match = %+v, want suggested with no person", got)
	}
	if len(got.Candidates) != 2 {
		t.Errorf("candidates = %+v, want both", got.Candidates)
	}
}

// Q1 = strict: namesakes sharing a birthdate in two households each match
// two signals, and stay suggested whoever's household holds the typed email.
// (This once asserted a household-email tie-break auto-link.)
func TestMatchNamesakesInTwoHouseholdsAreSuggested(t *testing.T) {
	t.Parallel()
	p := []Person{
		{PersonCMID: 1000040, HouseholdCMID: 2000040, First: "Emma", Last: "Johnson", Birthdate: "1975-07-07",
			Sessions: []int{weekendA}},
		{PersonCMID: 1000041, HouseholdCMID: 2000041, First: "Emma", Last: "Johnson", Birthdate: "1975-07-07",
			Sessions: []int{weekendA}},
	}
	id := Identity{Name: "Emma Johnson", Birthdate: "1975-07-07", Email: "spouse@example.com"}
	got := Match(id, p, nil)
	if got.Status != StatusSuggested || got.PersonCMID != 0 || got.Signals != 2 || len(got.Candidates) != 2 {
		t.Errorf("Match = %+v, want suggested with both on 2 signals", got)
	}
}

// A strong hit in another weekend outranks a weak coincidence in the chosen one:
// a shared birthdate with a stranger must not hide the real registration.
func TestMatchElsewhereOutranksAWeakPoolHit(t *testing.T) {
	t.Parallel()
	elsewhere := []Person{
		{PersonCMID: 1000020, HouseholdCMID: 2000020, First: "Emma", Last: "Johnson", Birthdate: "1971-04-02",
			Emails: []string{"emma@example.com"}, Sessions: []int{weekendB}},
	}
	got := Match(Identity{Name: "Emma Johnson", Birthdate: "1971-04-02", Email: "emma@example.com"},
		pool(), elsewhere)
	if got.Status != StatusRegisteredElsewhere {
		t.Fatalf("status = %s, want registered_elsewhere", got.Status)
	}
	if got.Candidates[0].PersonCMID != 1000020 || !got.Candidates[0].Elsewhere {
		t.Errorf("first candidate = %+v, want the elsewhere registration", got.Candidates[0])
	}
}

// The one name field is split on every boundary, so a two-word first name matches.
func TestMatchSplitNameTriesEveryBoundary(t *testing.T) {
	t.Parallel()
	p := []Person{{PersonCMID: 1000050, First: "Mary Ann", Last: "Garcia", Birthdate: "1966-02-02",
		Sessions: []int{weekendA}}}
	got := Match(Identity{Name: "Mary Ann Garcia", Birthdate: "1966-02-02"}, p, nil)
	if got.Status != StatusAuto || got.PersonCMID != 1000050 {
		t.Errorf("Match = %+v, want auto on the two-word first name", got)
	}
}

// Q1 = strict (owner ruling 2026-10-29): two people in different households
// each matching two signals are never auto-linked. Staff pick from both. Match
// takes no household at all; the sync job's test seeds a spouse holding the
// typed email.
func TestMatchStrongCandidatesInTwoHouseholdsAreSuggestedDespiteHouseholdEmail(t *testing.T) {
	t.Parallel()
	p := []Person{
		// name and email (the family's shared address)
		{PersonCMID: 1000060, HouseholdCMID: 2000060, First: "Rachel", Last: "Lee", Birthdate: "1982-03-04",
			Emails: []string{"lees@example.com"}, Sessions: []int{weekendA}},
		// name and birthdate, in another household
		{PersonCMID: 1000061, HouseholdCMID: 2000061, First: "Rachel", Last: "Lee", Birthdate: "1982-04-03",
			Emails: []string{"rlee@example.com"}, Sessions: []int{weekendA}},
	}
	got := Match(Identity{Name: "Rachel Lee", Birthdate: "1982-04-03", Email: "lees@example.com"}, p, nil)
	if got.Status != StatusSuggested || got.PersonCMID != 0 || got.HouseholdCMID != 0 || got.Signals != 2 {
		t.Errorf("Match = {%s person=%d household=%d signals=%d}, want suggested, no person, 2 signals",
			got.Status, got.PersonCMID, got.HouseholdCMID, got.Signals)
	}
	var ids []int
	for _, c := range got.Candidates {
		ids = append(ids, c.PersonCMID)
		if len(c.Signals) != 2 {
			t.Errorf("candidate %d signals = %v, want two", c.PersonCMID, c.Signals)
		}
	}
	if !slices.Equal(ids, []int{1000060, 1000061}) {
		t.Errorf("candidates = %v, want both", ids)
	}
}
