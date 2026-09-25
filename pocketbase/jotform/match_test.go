package jotform

import "testing"

func guests() []Guest {
	return []Guest{
		{PersonCMID: 1000004, First: "Olivia", Last: "Chen", Emails: []string{"olivia@example.com"}},
		{PersonCMID: 1000005, First: "Emma", Last: "Johnson"},
		{PersonCMID: 1000006, First: "Samuel", Preferred: "Sam", Last: "Johnson"},
		{PersonCMID: 1000007, First: "Riley", Last: "Sam"},
		{PersonCMID: 1000008, First: "Liv", Last: "Garcia"},
		{PersonCMID: 1000009, First: "Emma", Last: "Johnson-Kim"},
	}
}

func TestMatchTiers(t *testing.T) {
	cases := []struct {
		name string
		id   Identity
		want Result
	}{
		{"tier 1 exact, case and accents folded", Identity{First: "OLIVIA", Last: "Chén"}, Result{1000004, 1}},
		{"tier 2 via CampMinder preferred name", Identity{First: "Sam", Last: "Johnson"}, Result{1000006, 2}},
		{"tier 2 via the nametag", Identity{First: "Olivia", Last: "Garcia", Nametag: "Liv"}, Result{1000008, 2}},
		{"tier 3 two-part surname, submitted side longer", Identity{First: "Riley", Last: "Patel Sam"}, Result{1000007, 3}},
		{"tier 3 hyphenated submitted surname", Identity{First: "Olivia", Last: "Kim-Chen"}, Result{1000004, 3}},
		// NEVER the reverse direction: CM "Johnson-Kim" containing a submitted "Kim"
		// produced the only wrong match in the 4,301-adult stress test.
		{"reverse two-part is never matched", Identity{First: "Emma", Last: "Kim"}, Result{}},
		{"last name alone is never enough", Identity{First: "Samantha", Last: "Chen"}, Result{}},
		{"fuzzy names are never auto-matched", Identity{First: "Olivia", Last: "Chenn"}, Result{}},
		{"blank identity matches nothing", Identity{}, Result{}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := Match(tc.id, guests()); got != tc.want {
				t.Errorf("Match(%+v) = %+v, want %+v", tc.id, got, tc.want)
			}
		})
	}
}

func TestTierThreeRefusesWhenTheLeftoverWordIsAnotherGuestsSurname(t *testing.T) {
	enrolled := append(guests(), Guest{PersonCMID: 1000010, First: "Riley", Last: "Patel"})
	// "Riley Patel Sam" could be Riley Sam OR Riley Patel: staff decide.
	if got := Match(Identity{First: "Riley", Last: "Patel Sam"}, enrolled); got != (Result{}) {
		t.Errorf("got %+v, want unmatched", got)
	}
}

func TestAmbiguityIsBrokenOnlyByTheRespondentEmail(t *testing.T) {
	twins := []Guest{
		{PersonCMID: 1000011, First: "Emma", Last: "Johnson", Emails: []string{"emma.one@example.com"}},
		{PersonCMID: 1000012, First: "Emma", Last: "Johnson", Emails: []string{"Emma.Two@Example.com"}},
	}
	if got := Match(Identity{First: "Emma", Last: "Johnson"}, twins); got != (Result{}) {
		t.Errorf("two exact candidates and no email must go to staff, got %+v", got)
	}
	tiebroken := Identity{First: "Emma", Last: "Johnson", Email: "emma.two@example.com"}
	if got := Match(tiebroken, twins); got != (Result{1000012, 1}) {
		t.Errorf("email tiebreak = %+v", got)
	}
}

func TestTheEmailAloneNeverMatches(t *testing.T) {
	// The respondent email is a tiebreak only, never a tier of its own.
	if got := Match(Identity{First: "Pat", Last: "Kim", Email: "olivia@example.com"}, guests()); got != (Result{}) {
		t.Errorf("got %+v, want unmatched", got)
	}
}

// kindred#2759 follow-up: a filer who matches no ENROLLED guest is tried
// against the weekend's other registrations (cancelled, incomplete, ...).
func TestMatchRegistrationFallsBackToNonEnrolledRegistrations(t *testing.T) {
	others := []Guest{
		{PersonCMID: 1000020, First: "Noah", Last: "Patel"},
		{PersonCMID: 1000021, First: "Ava", Last: "Kim"},
		{PersonCMID: 1000022, First: "Ava", Last: "Kim"},
	}
	cases := []struct {
		name      string
		id        Identity
		want      Result
		cancelled bool
	}{
		{"an enrolled match wins first", Identity{First: "Olivia", Last: "Chen"}, Result{1000004, 1}, false},
		{"a unique non-enrolled hit", Identity{First: "Noah", Last: "Patel"}, Result{1000020, 1}, true},
		{"an ambiguous non-enrolled hit stays unmatched", Identity{First: "Ava", Last: "Kim"}, Result{}, false},
		{"no hit anywhere", Identity{First: "Pat", Last: "Nguyen"}, Result{}, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, cancelled := MatchRegistration(tc.id, guests(), others)
			if got != tc.want || cancelled != tc.cancelled {
				t.Errorf("MatchRegistration(%+v) = %+v, %v; want %+v, %v", tc.id, got, cancelled, tc.want, tc.cancelled)
			}
		})
	}
}

// An enrolled AMBIGUITY is a decision for staff, not a reason to look at
// cancelled registrations: two enrolled Emma Johnsons and a cancelled one
// must not resolve to the cancelled one.
func TestMatchRegistrationNeverFallsBackPastAnEnrolledAmbiguity(t *testing.T) {
	twins := []Guest{
		{PersonCMID: 1000011, First: "Emma", Last: "Johnson"},
		{PersonCMID: 1000012, First: "Emma", Last: "Johnson"},
	}
	others := []Guest{{PersonCMID: 1000013, First: "Emma", Last: "Johnson"}}
	if got, cancelled := MatchRegistration(Identity{First: "Emma", Last: "Johnson"}, twins, others); got != (Result{}) || cancelled {
		t.Errorf("got %+v, %v; want unmatched", got, cancelled)
	}
}
