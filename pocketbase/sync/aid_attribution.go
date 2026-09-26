package sync

import "sort"

// Attribution levels and methods (spec §6.3, analysis §8.4). The
// aid_postings selects carry exactly these; TestAidVocabularyMatchesMigration
// pins them.
const (
	aidLevelOverride      = "override"
	aidLevelDecision      = "decision"
	aidLevelSession       = "session"
	aidLevelPerson        = "person"
	aidLevelProgramFamily = "program_family"
	aidLevelAmbiguous     = "ambiguous"
	aidLevelNone          = "none"

	aidMethodOverrideSheet         = "override_sheet_2026_match"
	aidMethodOverrideStaff         = "override_staff"
	aidMethodDecision              = "decision"
	aidMethodPostedPersonSingle    = "posted_person_single_enrollment"
	aidMethodHouseholdSingleCamper = "household_single_camper"
	aidMethodSinglePersonMulti     = "single_person_multi_enrollment"
	aidMethodSourceImplied         = "source_implied"
	aidMethodFAApplication         = "fa_application_program"
	aidMethodHouseholdSingleFamily = "household_single_family"
	aidMethodNoEnrollment          = "no_enrollment"
	aidMethodAmbiguous             = "ambiguous"

	aidOverrideSourceSheet = "sheet_2026_match"
	aidOverrideSourceStaff = "staff"

	// aidActiveStatusID is CampMinder's "enrolled" (attendees.go's status map).
	aidActiveStatusID = 2
)

// aidCancelledStatusIDs are the attendee statuses that mean the family left:
// 32 cancelled, 256 withdrawn. They feed the live-aid-on-cancelled flag only.
var aidCancelledStatusIDs = map[int]bool{32: true, 256: true}

type aidEnrollment struct {
	PersonCMID  int
	SessionCMID int
	Family      string
	StatusID    int
}

// aidOverride is one aid_attribution_overrides row. SourceKey is its
// source_key_override: a reclassification the transform applies to the
// posting's classification (aid_postings.go), not a placement.
type aidOverride struct {
	PersonCMID  int
	SessionCMID int
	Family      string
	Source      string
	SourceKey   string
}

// places reports whether the override puts the posting somewhere. A
// reclassify-only override (outside money booked as camp aid) does not, and must not produce an
// override-level row with nothing placed.
func (o aidOverride) places() bool {
	return o.PersonCMID > 0 || o.SessionCMID > 0 || o.Family != ""
}

type aidPostingInput struct {
	TransactionCMID int
	HouseholdCMID   int
	PersonCMID      int
	ImpliedFamilies []string
}

// aidAttribution is where a posting landed and how. CandidateFamilies is set
// for the person and ambiguous levels only. CandidateCancelled is set on the
// none level when a candidate has a cancelled or withdrawn attendee row.
type aidAttribution struct {
	Level              string
	Method             string
	PersonCMID         int
	SessionCMID        int
	Family             string
	CandidateFamilies  []string
	RequestID          string
	CandidateCancelled bool
}

// aidDecisionMatcher is sub-project 11's hook: placing a posting on a Kindred
// aid request (spec §11 "Placement": a posting on a person who has one request
// in that program this season belongs to that request, at level decision).
// Reconciliation itself compares net live totals and never matches line by
// line or by amount, so this hook only places. Until decisions exist,
// noAidDecisionMatch is wired in and nothing matches.
type aidDecisionMatcher interface {
	MatchDecision(p aidPostingInput) (aidAttribution, bool)
}

type noAidDecisionMatch struct{}

func (noAidDecisionMatch) MatchDecision(aidPostingInput) (aidAttribution, bool) {
	return aidAttribution{}, false
}

// aidAttributionContext holds one season's indexes. Built once per year by
// AidPostingsSync; pure from here on.
type aidAttributionContext struct {
	Families            aidFamilyIndex
	PersonsByHousehold  map[int][]int
	EnrollmentsByPerson map[int][]aidEnrollment
	SessionFamily       map[int]string
	SessionByLabel      map[string]int
	FAAnswersByPerson   map[int][]string
	Overrides           map[int]aidOverride
	Decisions           aidDecisionMatcher
}

func (c *aidAttributionContext) attribute(p aidPostingInput) aidAttribution {
	if o, ok := c.Overrides[p.TransactionCMID]; ok && o.places() {
		return c.fromOverride(o)
	}
	if c.Decisions != nil {
		if d, ok := c.Decisions.MatchDecision(p); ok {
			d.Level, d.Method = aidLevelDecision, aidMethodDecision
			return d
		}
	}
	return c.infer(p)
}

func (c *aidAttributionContext) fromOverride(o aidOverride) aidAttribution {
	family := o.Family
	switch {
	case family == "" && o.SessionCMID > 0:
		family = c.SessionFamily[o.SessionCMID]
	case family == "" && o.PersonCMID > 0:
		// The override names a person but neither a session nor a family.
		// Take the program family from that person's own active (status_id =
		// 2) enrollments in this attribution context when they all agree --
		// Python's program_bucket otherwise reports a real placement as
		// "ambiguous" for no reason but a data gap (final review item 4).
		// Enrolled across two families leaves it exactly as it was: empty.
		family = aidSingleFamily(aidActiveEnrollments(c.EnrollmentsByPerson[o.PersonCMID]))
	}
	method := aidMethodOverrideStaff
	if o.Source == aidOverrideSourceSheet {
		method = aidMethodOverrideSheet
	}
	return aidAttribution{Level: aidLevelOverride, Method: method,
		PersonCMID: o.PersonCMID, SessionCMID: o.SessionCMID, Family: family}
}

func (c *aidAttributionContext) infer(p aidPostingInput) aidAttribution {
	active, cancelled := c.enrollmentsOf(c.candidates(p))
	switch len(active) {
	case 0: // rule 3
		return aidAttribution{Level: aidLevelNone, Method: aidMethodNoEnrollment, CandidateCancelled: cancelled}
	case 1: // rule 4
		method := aidMethodHouseholdSingleCamper
		if p.PersonCMID > 0 {
			method = aidMethodPostedPersonSingle
		}
		return aidSessionAttribution(active[0], method)
	}
	if persons := aidDistinctPersons(active); len(persons) == 1 { // rule 5
		// A source that names its program (the 2027 per-program descriptions)
		// chooses among this one person's enrollments first (spec §6.3).
		switch implied := aidEnrollmentsInFamilies(active, p.ImpliedFamilies); {
		case len(implied) == 1:
			return aidSessionAttribution(implied[0], aidMethodSourceImplied)
		case len(implied) > 1:
			return aidAttribution{Level: aidLevelPerson, Method: aidMethodSourceImplied, PersonCMID: persons[0],
				Family: aidSingleFamily(implied), CandidateFamilies: aidFamiliesOf(implied)}
		}
		return aidAttribution{Level: aidLevelPerson, Method: aidMethodSinglePersonMulti, PersonCMID: persons[0],
			Family: aidSingleFamily(active), CandidateFamilies: aidFamiliesOf(active)}
	}
	working := active
	if implied := aidEnrollmentsInFamilies(active, p.ImpliedFamilies); len(implied) > 0 { // rule 6
		if len(implied) == 1 {
			return aidSessionAttribution(implied[0], aidMethodSourceImplied)
		}
		if family := aidSingleFamily(implied); family != "" {
			a := aidAttribution{Level: aidLevelProgramFamily, Method: aidMethodSourceImplied, Family: family}
			if persons := aidDistinctPersons(implied); len(persons) == 1 {
				a.PersonCMID = persons[0]
			}
			return a
		}
		working = implied
	}
	if a, ok := c.byFAApplication(working); ok { // rule 7
		return a
	}
	if family := aidSingleFamily(working); family != "" { // rule 8
		return aidAttribution{Level: aidLevelProgramFamily, Method: aidMethodHouseholdSingleFamily, Family: family}
	}
	return aidAttribution{Level: aidLevelAmbiguous, Method: aidMethodAmbiguous, // rule 9
		CandidateFamilies: aidFamiliesOf(working)}
}

// candidates is rule 1.
func (c *aidAttributionContext) candidates(p aidPostingInput) []int {
	if p.PersonCMID > 0 {
		return []int{p.PersonCMID}
	}
	seen := map[int]bool{}
	for _, h := range c.Families.HouseholdSet(p.HouseholdCMID) {
		for _, id := range c.PersonsByHousehold[h] {
			seen[id] = true
		}
	}
	out := make([]int, 0, len(seen))
	for id := range seen {
		out = append(out, id)
	}
	sort.Ints(out)
	return out
}

// enrollmentsOf is rule 2: active enrollments, one per (person, session),
// sorted; plus whether any candidate has a cancelled or withdrawn row.
func (c *aidAttributionContext) enrollmentsOf(persons []int) (active []aidEnrollment, cancelled bool) {
	type key struct{ person, session int }
	seen := map[key]bool{}
	for _, id := range persons {
		for _, e := range c.EnrollmentsByPerson[id] {
			if aidCancelledStatusIDs[e.StatusID] {
				cancelled = true
			}
			k := key{e.PersonCMID, e.SessionCMID}
			if e.StatusID != aidActiveStatusID || seen[k] {
				continue
			}
			seen[k] = true
			active = append(active, e)
		}
	}
	sort.Slice(active, func(i, j int) bool {
		if active[i].PersonCMID != active[j].PersonCMID {
			return active[i].PersonCMID < active[j].PersonCMID
		}
		return active[i].SessionCMID < active[j].SessionCMID
	})
	return active, cancelled
}

// byFAApplication is rule 7. An FA application's program answers (summer,
// family camp, B*Mitzvah fields) name sessions; they are matched to the year's
// camp_sessions by normalized name.
//
// Controller ruling (final review, item 10): a sibling who submitted no FA
// answer at all is not ruled out as the true subject of this posting just
// because they stayed silent -- a household's aid can land on either camper,
// and silence carries no information about which. So neither branch below
// may treat a silent sibling as settled: the session winner requires every
// candidate to have answered (fix round 1's existing family-count guard
// still stands beside it, for siblings who DID answer but pointed elsewhere).
// The family conclusion tolerates a silent sibling only when their own
// working enrollments stay inside that one family AND don't also occupy the
// exact session an answer named -- sharing that literal session means the
// two campers are indistinguishable, so rule 7 steps back entirely and lets
// rule 8/9 decide, same as if no FA answer existed at all.
func (c *aidAttributionContext) byFAApplication(working []aidEnrollment) (aidAttribution, bool) {
	byPerson := map[int][]aidEnrollment{}
	for _, e := range working {
		byPerson[e.PersonCMID] = append(byPerson[e.PersonCMID], e)
	}
	var sessionWinners []aidEnrollment
	familyHits := map[string]bool{}
	familyPersons := map[int]bool{}
	namedSessions := map[int]bool{}
	var silent []int
	for _, person := range aidDistinctPersons(working) {
		resolved := c.resolvedSessions(person)
		if len(resolved) == 0 {
			silent = append(silent, person)
			continue
		}
		for session := range resolved {
			namedSessions[session] = true
		}
		var hits []aidEnrollment
		for _, e := range byPerson[person] {
			if resolved[e.SessionCMID] {
				hits = append(hits, e)
			}
		}
		if len(hits) == 1 {
			sessionWinners = append(sessionWinners, hits[0])
		}
		for session := range resolved {
			family := c.SessionFamily[session]
			if family != "" && aidSingleFamily(aidEnrollmentsInFamilies(byPerson[person], []string{family})) == family {
				familyHits[family] = true
				familyPersons[person] = true
			}
		}
	}
	// A single-session winner is only trustworthy when no other candidate's
	// resolved answer points at a second family they are actually enrolled in
	// (fix round 1, task review) and no candidate stayed silent (item 10):
	// either way, the household has (or may have) a second real claimant, and
	// picking one camper would be a guess.
	if len(sessionWinners) == 1 && len(familyHits) <= 1 && len(silent) == 0 {
		return aidSessionAttribution(sessionWinners[0], aidMethodFAApplication), true
	}
	family := aidSoleFamily(familyHits)
	familySafe := family != ""
	for _, person := range silent {
		for _, e := range byPerson[person] {
			if e.Family != family || namedSessions[e.SessionCMID] {
				familySafe = false
			}
		}
	}
	if familySafe {
		a := aidAttribution{Level: aidLevelProgramFamily, Method: aidMethodFAApplication, Family: family}
		// Item 10 follow-up (controller ruling): a person is only credited when
		// EVERY candidate answered -- net totals group by attributed_person_cm_id
		// (financial_aid_ledger_service.py's net_totals), so naming a person here
		// while a sibling stayed silent would still pin that sibling's award on
		// the one who answered, the exact thing the ruling removes.
		if len(familyPersons) == 1 && len(silent) == 0 {
			for person := range familyPersons {
				a.PersonCMID = person
			}
		}
		return a, true
	}
	return aidAttribution{}, false
}

// aidSoleFamily returns the one family in a hit-set, or "" when there are
// zero or several.
func aidSoleFamily(hits map[string]bool) string {
	if len(hits) != 1 {
		return ""
	}
	for family := range hits {
		return family
	}
	return ""
}

func (c *aidAttributionContext) resolvedSessions(person int) map[int]bool {
	out := map[int]bool{}
	for _, answer := range c.FAAnswersByPerson[person] {
		if id := c.SessionByLabel[normalizeAidLabel(answer)]; id > 0 {
			out[id] = true
		}
	}
	return out
}

func aidSessionAttribution(e aidEnrollment, method string) aidAttribution {
	return aidAttribution{Level: aidLevelSession, Method: method,
		PersonCMID: e.PersonCMID, SessionCMID: e.SessionCMID, Family: e.Family}
}

func aidDistinctPersons(es []aidEnrollment) []int {
	seen := map[int]bool{}
	var out []int
	for _, e := range es {
		if !seen[e.PersonCMID] {
			seen[e.PersonCMID] = true
			out = append(out, e.PersonCMID)
		}
	}
	sort.Ints(out)
	return out
}

// aidFamiliesOf is the sorted distinct families of es.
func aidFamiliesOf(es []aidEnrollment) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, e := range es {
		if e.Family != "" && !seen[e.Family] {
			seen[e.Family] = true
			out = append(out, e.Family)
		}
	}
	sort.Strings(out)
	return out
}

// aidSingleFamily is the one family every enrollment shares, or "".
func aidSingleFamily(es []aidEnrollment) string {
	if families := aidFamiliesOf(es); len(families) == 1 && len(es) > 0 {
		return families[0]
	}
	return ""
}

// aidActiveEnrollments filters to status_id = 2 (aidActiveStatusID) rows only.
func aidActiveEnrollments(es []aidEnrollment) []aidEnrollment {
	var out []aidEnrollment
	for _, e := range es {
		if e.StatusID == aidActiveStatusID {
			out = append(out, e)
		}
	}
	return out
}

func aidEnrollmentsInFamilies(es []aidEnrollment, families []string) []aidEnrollment {
	if len(families) == 0 {
		return nil
	}
	want := map[string]bool{}
	for _, f := range families {
		want[f] = true
	}
	var out []aidEnrollment
	for _, e := range es {
		if want[e.Family] {
			out = append(out, e)
		}
	}
	return out
}
