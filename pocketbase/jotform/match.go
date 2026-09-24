package jotform

import (
	"regexp"
	"strings"
	"unicode"

	"golang.org/x/text/runes"
	"golang.org/x/text/transform"
	"golang.org/x/text/unicode/norm"
)

// Guest is one ENROLLED guest of the form's session (attendees.status_id = 2).
type Guest struct {
	PersonCMID int
	First      string
	Preferred  string
	Last       string
	Emails     []string
}

// Result is a match decision. PersonCMID 0 means "send it to staff".
type Result struct {
	PersonCMID int
	Tier       int
}

// Fold case-folds, strips accents and collapses whitespace.
func Fold(s string) string {
	t := transform.Chain(norm.NFKD, runes.Remove(runes.In(unicode.Mn)), norm.NFC)
	out, _, err := transform.String(t, s)
	if err != nil {
		out = s
	}
	return strings.Join(strings.Fields(strings.ToLower(out)), " ")
}

var justName = regexp.MustCompile(`just (\p{L}+)`)

// nametagFirst turns the nametag answer into a usable first name: its first
// word, or "" for "prefer not to say"-style answers (whose "just X" form still
// yields X). Measured on the 2026 forms.
func nametagFirst(nametag string) string {
	n := Fold(nametag)
	if n == "" {
		return ""
	}
	if strings.HasPrefix(n, "prefer") {
		if m := justName.FindStringSubmatch(n); m != nil {
			return m[1]
		}
		return ""
	}
	return strings.Fields(n)[0]
}

func guestFirsts(g *Guest) map[string]bool {
	out := map[string]bool{}
	for _, f := range []string{g.First, g.Preferred} {
		if v := Fold(f); v != "" {
			out[v] = true
		}
	}
	return out
}

func surnameTokens(s string) map[string]bool {
	out := map[string]bool{}
	for _, tok := range strings.FieldsFunc(Fold(s), func(r rune) bool { return r == ' ' || r == '-' }) {
		out[tok] = true
	}
	return out
}

func intersects(a, b map[string]bool) bool {
	for k := range a {
		if b[k] {
			return true
		}
	}
	return false
}

// Match decides whose submission this is. Tiers, in order -- the first tier
// with ANY candidate decides:
//  1. exact first + last;
//  2. nametag or CampMinder preferred name, + last;
//  3. two-part surname, ONE direction only: the submitted surname has 2+ words
//     and strictly contains the CampMinder surname, the first/preferred name
//     matches, and no other enrolled guest with that first name has the
//     leftover word as a surname.
//
// At the deciding tier exactly one candidate matches; several are broken only
// by the respondent email; otherwise the result is unmatched. Never emergency
// contacts, never last name alone, never fuzzy (kindred#2759).
func Match(id Identity, enrolled []Guest) Result {
	first, last := Fold(id.First), Fold(id.Last)
	if first == "" || last == "" {
		return Result{}
	}
	subFirsts := map[string]bool{first: true}
	if nt := nametagFirst(id.Nametag); nt != "" {
		subFirsts[nt] = true
	}
	tiers := []func(Guest) bool{
		func(g Guest) bool { return Fold(g.Last) == last && Fold(g.First) == first },
		func(g Guest) bool { return Fold(g.Last) == last && intersects(subFirsts, guestFirsts(&g)) },
		func(g Guest) bool { return twoPartSurname(id.Last, subFirsts, &g, enrolled) },
	}
	for i, pred := range tiers {
		hits := map[int]Guest{}
		for _, g := range enrolled {
			if pred(g) {
				hits[g.PersonCMID] = g
			}
		}
		if len(hits) == 0 {
			continue
		}
		if len(hits) == 1 {
			for cmID := range hits {
				return Result{PersonCMID: cmID, Tier: i + 1}
			}
		}
		if g, ok := emailTiebreak(hits, id.Email); ok {
			return Result{PersonCMID: g.PersonCMID, Tier: i + 1}
		}
		return Result{}
	}
	return Result{}
}

func twoPartSurname(submittedLast string, subFirsts map[string]bool, g *Guest, enrolled []Guest) bool {
	s, gt := surnameTokens(submittedLast), surnameTokens(g.Last)
	if len(s) < 2 || len(gt) == 0 || len(s) <= len(gt) {
		return false
	}
	for tok := range gt {
		if !s[tok] {
			return false
		}
	}
	if !intersects(subFirsts, guestFirsts(g)) {
		return false
	}
	leftover := map[string]bool{}
	for tok := range s {
		if !gt[tok] {
			leftover[tok] = true
		}
	}
	for i := range enrolled {
		other := &enrolled[i]
		if other.PersonCMID == g.PersonCMID {
			continue
		}
		if intersects(subFirsts, guestFirsts(other)) && intersects(leftover, surnameTokens(other.Last)) {
			return false
		}
	}
	return true
}

func emailTiebreak(hits map[int]Guest, email string) (Guest, bool) {
	want := Fold(email)
	if !strings.Contains(want, "@") {
		return Guest{}, false
	}
	var found []Guest
	for _, g := range hits {
		for _, e := range g.Emails {
			if Fold(e) == want {
				found = append(found, g)
				break
			}
		}
	}
	if len(found) == 1 {
		return found[0], true
	}
	return Guest{}, false
}
