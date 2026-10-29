package aidform

import (
	"cmp"
	"slices"
	"strings"

	"github.com/camp/kindred/pocketbase/jotform"
)

// Match outcomes (design §5, GF-1 = A). The job adds three more of its own:
// staff and ignored (set by staff, never re-matched) and superseded.
const (
	StatusAuto                = "auto"
	StatusSuggested           = "suggested"
	StatusRegisteredElsewhere = "registered_elsewhere"
	StatusNotRegistered       = "not_registered"
	StatusUnmatched           = "unmatched"
)

// The three signals.
const (
	SignalName      = "name"
	SignalBirthdate = "birthdate"
	SignalEmail     = "email"
)

// Identity is what a response says about who filed it.
type Identity struct {
	Name      string // the one "First and Last" text answer
	Birthdate string // the Forms date answer, "YYYY-MM-DD"
	Email     string // the responder email
}

// Person is one 2027 registration's person: a CampMinder person and the
// sessions (CampMinder ids) of their registrations in scope.
type Person struct {
	PersonCMID    int
	HouseholdCMID int
	First         string
	Preferred     string
	Last          string
	Birthdate     string
	Emails        []string
	Sessions      []int
}

// Member is a household's person, for the email tie-break.
type Member struct {
	PersonCMID int
	Emails     []string
}

// Candidate is one person a response could be, with the evidence. CampMinder
// ids only: it is stored as match_candidates and never carries a name.
type Candidate struct {
	PersonCMID     int      `json:"person_cm_id"`
	HouseholdCMID  int      `json:"household_cm_id"`
	Signals        []string `json:"signals"`
	HouseholdEmail bool     `json:"household_email,omitempty"`
	SessionCMIDs   []int    `json:"session_cm_ids"`
	Elsewhere      bool     `json:"elsewhere,omitempty"`
}

// Decision is a response's match.
type Decision struct {
	Status        string
	PersonCMID    int // set only for StatusAuto
	HouseholdCMID int // set only for StatusAuto
	// Signals is the best candidate's signal count (the stored match_tier).
	Signals    int
	Candidates []Candidate
}

// maxCandidates bounds the evidence stored on one row.
const maxCandidates = 10

// Match decides whose response this is (design §5, GF-1 = A).
//
//   - auto: exactly one person in the chosen weekend's pool has 2 or more of
//     the 3 signals. Several such people are broken only by the respondent
//     email on a household's OTHER persons (a spouse's address); that email is
//     a tie-break, never a signal of its own.
//   - registered_elsewhere: nobody in the pool has 2 signals, and someone
//     registered for another 2027 adult or family weekend does. It outranks a
//     1-signal coincidence in the pool (a shared birthdate with a stranger).
//   - suggested: anyone in the pool with at least 1 signal, or several strong
//     candidates no tie-break separates.
//   - not_registered: no signal anywhere.
//   - unmatched: the response carries no identity at all.
func Match(id Identity, pool, elsewhere []Person, households map[int][]Member) Decision {
	if strings.TrimSpace(id.Name) == "" && NormalizeDate(id.Birthdate) == "" && !usableEmail(id.Email) {
		return Decision{Status: StatusUnmatched}
	}
	inPool := score(id, pool, false)
	strong := withAtLeast(inPool, 2)

	if len(strong) == 1 {
		return auto(strong[0])
	}
	if len(strong) > 1 {
		if winner, ok := householdTieBreak(id, strong, households); ok {
			return auto(winner)
		}
		return suggest(StatusSuggested, inPool)
	}
	if away := withAtLeast(score(id, elsewhere, true), 2); len(away) > 0 {
		return suggest(StatusRegisteredElsewhere, append(away, withAtLeast(inPool, 1)...))
	}
	if weak := withAtLeast(inPool, 1); len(weak) > 0 {
		return suggest(StatusSuggested, weak)
	}
	return Decision{Status: StatusNotRegistered}
}

func auto(c Candidate) Decision {
	return Decision{
		Status: StatusAuto, PersonCMID: c.PersonCMID, HouseholdCMID: c.HouseholdCMID,
		Signals: len(c.Signals), Candidates: []Candidate{c},
	}
}

// suggest keeps the order given (elsewhere first for registered_elsewhere),
// each group best first, and stores the top few.
func suggest(status string, cands []Candidate) Decision {
	cands = withAtLeast(cands, 1)
	if len(cands) > maxCandidates {
		cands = cands[:maxCandidates]
	}
	best := 0
	for _, c := range cands {
		best = max(best, len(c.Signals))
	}
	if status == StatusRegisteredElsewhere && len(cands) > 0 {
		best = len(cands[0].Signals)
	}
	return Decision{Status: status, Signals: best, Candidates: cands}
}

// score lists everyone in people with their signals, best first (then by id).
func score(id Identity, people []Person, elsewhere bool) []Candidate {
	tokens := nameTokens(id.Name)
	birth := NormalizeDate(id.Birthdate)
	email := jotform.Fold(id.Email)
	out := make([]Candidate, 0, len(people))
	for i := range people {
		p := &people[i]
		var signals []string
		if nameHit(tokens, p) {
			signals = append(signals, SignalName)
		}
		if birth != "" && len(p.Birthdate) >= 10 && p.Birthdate[:10] == birth {
			signals = append(signals, SignalBirthdate)
		}
		if usableEmail(email) && hasEmail(p.Emails, email) {
			signals = append(signals, SignalEmail)
		}
		sessions := slices.Clone(p.Sessions)
		slices.Sort(sessions)
		out = append(out, Candidate{
			PersonCMID: p.PersonCMID, HouseholdCMID: p.HouseholdCMID, Signals: signals,
			SessionCMIDs: slices.Compact(sessions), Elsewhere: elsewhere,
		})
	}
	slices.SortStableFunc(out, func(a, b Candidate) int {
		if c := cmp.Compare(len(b.Signals), len(a.Signals)); c != 0 {
			return c
		}
		return cmp.Compare(a.PersonCMID, b.PersonCMID)
	})
	return out
}

func withAtLeast(cands []Candidate, n int) []Candidate {
	var out []Candidate
	for _, c := range cands {
		if len(c.Signals) >= n {
			out = append(out, c)
		}
	}
	return out
}

// householdTieBreak: among several strong candidates, the one whose household
// has ANOTHER person carrying the respondent email, when exactly one does.
func householdTieBreak(id Identity, strong []Candidate, households map[int][]Member) (Candidate, bool) {
	email := jotform.Fold(id.Email)
	if !usableEmail(email) {
		return Candidate{}, false
	}
	var found []Candidate
	for _, c := range strong {
		for _, m := range households[c.HouseholdCMID] {
			if m.PersonCMID != c.PersonCMID && hasEmail(m.Emails, email) {
				c.HouseholdEmail = true
				found = append(found, c)
				break
			}
		}
	}
	if len(found) == 1 {
		return found[0], true
	}
	return Candidate{}, false
}

func usableEmail(folded string) bool { return strings.Contains(folded, "@") }

func hasEmail(emails []string, folded string) bool {
	for _, e := range emails {
		if jotform.Fold(e) == folded {
			return true
		}
	}
	return false
}

// nameTokens splits the typed name into folded words. Hyphens stay inside a
// word; stray punctuation ("Grace Chen.", "R. G.") is dropped.
func nameTokens(name string) []string {
	cleaned := strings.Map(func(r rune) rune {
		switch r {
		case ',', '.', ';', ':', '(', ')', '"':
			return ' '
		}
		return r
	}, name)
	return strings.Fields(jotform.Fold(cleaned))
}

// surname folds a surname for comparison: hyphens read as spaces, so
// "Chen-Whitfield" and "Chen Whitfield" are the same surname.
func surname(s string) string {
	return strings.Join(strings.FieldsFunc(jotform.Fold(s), func(r rune) bool { return r == ' ' || r == '-' }), " ")
}

// nameHit tries every first/last boundary of the typed name. The last part
// must equal the person's surname, or be ONE word of a two-part or hyphenated
// surname (one direction only: the typed part is the shorter); the first part
// must equal the first or preferred name.
func nameHit(tokens []string, p *Person) bool {
	if len(tokens) < 2 {
		return false
	}
	want := surname(p.Last)
	if want == "" {
		return false
	}
	parts := strings.Fields(want)
	firsts := map[string]bool{}
	for _, f := range []string{p.First, p.Preferred} {
		if v := surname(f); v != "" {
			firsts[v] = true
		}
	}
	for k := 1; k < len(tokens); k++ {
		first := surname(strings.Join(tokens[:k], " "))
		last := surname(strings.Join(tokens[k:], " "))
		lastHit := last == want || (len(parts) > 1 && !strings.Contains(last, " ") && slices.Contains(parts, last))
		if lastHit && firsts[first] {
			return true
		}
	}
	return false
}
