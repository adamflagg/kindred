package sync

import (
	"log/slog"
	"slices"
	"strings"
	"unicode/utf8"
)

// Free-text collapse for family_camp_registrations (kindred#2274, kindred#2276).
//
// Six registration columns used to keep whichever household member's answer the
// query returned first and silently drop the rest: 810 answers over the six,
// measured against the production snapshot, 428 of them on Family Camp-Trans
// ETA -- the live one, which staff read to plan arrivals.
//
// The rule here is the one already reviewed and shipped for household request
// text in CollapseToHouseholdGrain (lodging_requests.go): dedup on normalised
// text, join the survivors with "; ". Two children carrying one parent's answer
// collapse to one -- which is most of the traffic, since sparsity outruns
// conflict about 5:1 -- while two genuinely different answers both survive.
//
// ONE DELIBERATE DIFFERENCE from that site, and it is the reason this is a type
// rather than a copied loop. CollapseToHouseholdGrain joins in input order.
// Input order here is record-id order, and PocketBase ids are random, so it
// correlates with nothing and is not stable across a delete/recreate of a source
// row. kindred#2274's acceptance asks for an ORDER-INDEPENDENCE probe -- permute
// the input, get identical output -- and input-order joining fails it for the
// only case that matters, two distinct answers. So the survivors are sorted into
// a canonical order, and a dedup collision keeps the lexicographically smaller
// spelling rather than the first-loaded one. lodging_requests.go is deliberately
// NOT changed to match: it is a different column with its own reviewed policy.

// answerJoinSeparator matches CollapseToHouseholdGrain and processMedical, so
// every joined family-camp text column reads the same way.
const answerJoinSeparator = "; "

// Column caps on family_camp_registrations, mirroring migration
// 1500000035_family_camp_derived_tables.js, which is the source of truth.
//
// These exist because PocketBase REJECTS an over-cap text write instead of
// truncating it -- the same hazard sync_runs.go's maxSyncRunErrorLen guards
// against. A join that outgrows its column would fail the entire row's Save, so
// the household would keep the PREVIOUS run's value and the failure would show
// up only as a bumped error count. Joining is what makes this reachable at all:
// no single stored answer exceeds its column today.
//
// Measured against the production snapshot, only one is close: dedup-joining
// Family Camp-Trans ETA takes 3 household-years across 2017-2026 past 200 (max
// 246). The other five have wide headroom (largest join: notes 1392 of 5000,
// modes 341 of 500, occasions 304 of 1000, goals 289 of 2000, share 267 of 500).
const (
	maxShareCabinPreferenceLen = 500
	maxSharedCabinModesRawLen  = 500
	maxArrivalETALen           = 200
	maxSpecialOccasionsLen     = 1000
	maxGoalsLen                = 2000
	maxNotesLen                = 5000
)

// answerSet holds the distinct answers several household members gave to one
// question. The zero value is ready to use.
type answerSet struct {
	// byKey maps normalised text to the spelling that will be stored. Keying on
	// the normalisation is what collapses one parent's answer fanned onto
	// several children's forms.
	byKey map[string]string
}

// add records one answer, ignoring blanks and repeats.
func (a *answerSet) add(value string) {
	value = strings.TrimSpace(value)
	if value == "" {
		return
	}
	if a.byKey == nil {
		a.byKey = make(map[string]string, 2)
	}

	key := strings.ToLower(value)
	// Two members typing the same answer with different capitalisation is a
	// dedup collision, and SOMETHING has to be stored. Taking the smaller
	// spelling is arbitrary but total: taking the first-loaded one would make
	// the column depend on record-id order again, in the one place a reader
	// would never think to look.
	if existing, ok := a.byKey[key]; ok && existing <= value {
		return
	}
	a.byKey[key] = value
}

// values returns the surviving answers in canonical order.
func (a *answerSet) values() []string {
	out := make([]string, 0, len(a.byKey))
	for _, v := range a.byKey {
		out = append(out, v)
	}
	slices.Sort(out)
	return out
}

// empty reports whether nothing was collected.
func (a *answerSet) empty() bool { return len(a.byKey) == 0 }

// joinAnswers concatenates parts until the column's cap is reached.
//
// It drops WHOLE answers rather than cutting one in half: half a sentence read
// by staff is worse than a missing one, and the count of what was dropped is
// returned so the caller can log it. That log is the first counted loss anywhere
// on this path -- every collapse site in this file discards silently today.
//
// truncated covers the one case where a whole answer cannot be kept: a single
// answer longer than the entire column. It does not happen in the current data
// and would previously have failed the row's save outright.
func joinAnswers(parts []string, limit int) (joined string, dropped int, truncated bool) {
	for _, part := range parts {
		candidate := part
		if joined != "" {
			candidate = joined + answerJoinSeparator + part
		}

		if utf8.RuneCountInString(candidate) <= limit {
			joined = candidate
			continue
		}
		if joined == "" {
			joined = truncateRunes(part, limit)
			truncated = true
			continue
		}
		dropped++
	}

	return joined, dropped, truncated
}

// occasionAnswers is ONE person's answer to the special-occasion pair: the
// Yes/No gate (Family Camp-Special occasions) and the sentence explaining it
// (Family Camp-describe special occasion, kindred#2276's one live gap -- 343
// values, 69 since 2025, synced and read by nothing until now).
//
// They are grouped by person because docs/reference/family-camp-field-provenance.md
// section 4 requires it: collapsing a gate and its explain independently lets the
// two halves arrive from different children, so the explanation staff read need
// not describe the need that raised the flag. Measured on the comparable pairs,
// that splice happens to 5-38% of households a year.
type occasionAnswers struct {
	gate     answerSet
	describe answerSet
}

// combined renders one person's pair as a single unit, gate first -- the same
// shape processMedical gives its gate/narrative pairs.
func (o *occasionAnswers) combined() string {
	parts := append(o.gate.values(), o.describe.values()...)
	return strings.Join(parts, answerJoinSeparator)
}

// registrationText accumulates one household's free-text registration answers
// while the person loop runs. It is separate from registrationData because that
// struct is the row that gets written; this is the working state behind six of
// its columns.
type registrationText struct {
	shareCabinPreference answerSet
	sharedCabinModesRaw  answerSet
	arrivalETA           answerSet
	goals                answerSet
	notes                answerSet
	// Keyed by person PB id. A household value would key under "" -- which is
	// why neither of these two fields is household-partition, and why nothing
	// here may treat "" as an identity.
	occasions map[string]*occasionAnswers
}

// occasionFor returns the pair accumulator for one answering person.
func (r *registrationText) occasionFor(personPBID string) *occasionAnswers {
	if r.occasions == nil {
		r.occasions = make(map[string]*occasionAnswers, 2)
	}
	if o, ok := r.occasions[personPBID]; ok {
		return o
	}
	o := &occasionAnswers{}
	r.occasions[personPBID] = o
	return o
}

// specialOccasions collapses the per-person pairs to one household value.
//
// The per-person units are deduplicated against each other, so the common case
// -- one parent's answer copied onto every child's form -- still collapses to a
// single "No", while two members who each answered and explained keep both
// explanations next to the gate that member gave.
func (r *registrationText) specialOccasions() answerSet {
	var set answerSet
	for _, o := range r.occasions {
		set.add(o.combined())
	}
	return set
}

// applyRegistrationText writes one household's collapsed free text onto the row
// that will be stored, capping each column and logging whatever did not fit.
//
// The log is deliberate. Every other collapse site on this path discards
// silently -- no Stats field, no warning, no conflict column, for any of the
// twenty lossy sites the family-camp audit counted -- and the point of this
// change is that a discarded answer stops being invisible.
func (s *FamilyCampDerivedSync) applyRegistrationText(reg *registrationData, txt *registrationText) {
	if reg == nil || txt == nil {
		return
	}

	occasions := txt.specialOccasions()
	for _, col := range []struct {
		name   string
		set    *answerSet
		limit  int
		assign func(string)
	}{
		{"share_cabin_preference", &txt.shareCabinPreference, maxShareCabinPreferenceLen,
			func(v string) { reg.shareCabinPreference = v }},
		{"shared_cabin_modes_raw", &txt.sharedCabinModesRaw, maxSharedCabinModesRawLen,
			func(v string) { reg.sharedCabinModesRaw = v }},
		{"arrival_eta", &txt.arrivalETA, maxArrivalETALen,
			func(v string) { reg.arrivalETA = v }},
		{"special_occasions", &occasions, maxSpecialOccasionsLen,
			func(v string) { reg.specialOccasions = v }},
		{"goals", &txt.goals, maxGoalsLen,
			func(v string) { reg.goals = v }},
		{"notes", &txt.notes, maxNotesLen,
			func(v string) { reg.notes = v }},
	} {
		if col.set.empty() {
			continue
		}

		joined, dropped, truncated := joinAnswers(col.set.values(), col.limit)
		col.assign(joined)

		// The values themselves are never logged: several of these columns carry
		// a family's own words about their circumstances.
		if dropped > 0 {
			slog.Warn("family_camp_derived: dropped household answers that do not fit the column",
				"household", reg.householdPBID,
				"column", col.name,
				"dropped", dropped,
				"limit", col.limit,
			)
		}
		if truncated {
			slog.Warn("family_camp_derived: a single answer exceeded the whole column and was cut",
				"household", reg.householdPBID,
				"column", col.name,
				"limit", col.limit,
			)
		}
	}
}
