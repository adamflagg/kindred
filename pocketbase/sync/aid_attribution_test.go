package sync

import (
	"os"
	"reflect"
	"strings"
	"testing"
)

type aidTestEnr struct{ person, session, status int }

// Fictional sessions. Names only matter for rule 7's answer matching.
var aidTestSessions = map[int]struct{ name, family string }{
	11: {"Session 2", programFamilySummer},
	12: {"Session 3", programFamilySummer},
	13: {"Quest North", programFamilyQuest},
	14: {"Teen Leadership", programFamilyTeen},
	21: {"Family Weekend 1", programFamilyFamilyCamp},
	31: {"Mitzvah Year 1", programFamilyBMitzvah},
	32: {"Mitzvah Year 2", programFamilyBMitzvah},
	41: {"Adult Weekend", programFamilyAdultWeekend},
}

func newAidTestContext(members map[int][]int, enrs []aidTestEnr) *aidAttributionContext {
	c := &aidAttributionContext{
		PersonsByHousehold:  members,
		EnrollmentsByPerson: map[int][]aidEnrollment{},
		SessionFamily:       map[int]string{},
		SessionByLabel:      map[string]int{},
		FAAnswersByPerson:   map[int][]string{},
		Overrides:           map[int]aidOverride{},
		Decisions:           noAidDecisionMatch{},
	}
	for id, s := range aidTestSessions {
		c.SessionFamily[id] = s.family
		c.SessionByLabel[normalizeAidLabel(s.name)] = id
	}
	for _, e := range enrs {
		c.EnrollmentsByPerson[e.person] = append(c.EnrollmentsByPerson[e.person], aidEnrollment{
			PersonCMID: e.person, SessionCMID: e.session, Family: c.SessionFamily[e.session], StatusID: e.status,
		})
	}
	return c
}

type fakeAidDecision struct{ match aidAttribution }

func (f *fakeAidDecision) MatchDecision(aidPostingInput) (aidAttribution, bool) { return f.match, true }

func TestAidAttributionRules(t *testing.T) {
	t.Parallel()
	const enrolled, waitlisted, cancelled, withdrawn = 2, 8, 32, 256
	siblings := map[int][]int{100: {1001, 1002}}
	three := map[int][]int{100: {1001, 1002, 1003}}
	household := aidPostingInput{TransactionCMID: 9001, HouseholdCMID: 100}

	tests := []struct {
		name    string
		members map[int][]int
		enrs    []aidTestEnr
		setup   func(c *aidAttributionContext)
		in      aidPostingInput
		want    aidAttribution
	}{
		{
			name: "override wins and derives its family from the session", members: siblings,
			enrs: []aidTestEnr{{1001, 11, enrolled}},
			setup: func(c *aidAttributionContext) {
				c.Overrides[9001] = aidOverride{PersonCMID: 1001, SessionCMID: 12, Source: aidOverrideSourceSheet}
			},
			in: household,
			want: aidAttribution{Level: aidLevelOverride, Method: aidMethodOverrideSheet,
				PersonCMID: 1001, SessionCMID: 12, Family: programFamilySummer},
		},
		{
			name: "staff override keeps its explicit family", members: siblings,
			setup: func(c *aidAttributionContext) {
				c.Overrides[9001] = aidOverride{Family: programFamilyBMitzvah, Source: aidOverrideSourceStaff}
			},
			in:   household,
			want: aidAttribution{Level: aidLevelOverride, Method: aidMethodOverrideStaff, Family: programFamilyBMitzvah},
		},
		{
			name: "a matched decision outranks inference", members: siblings,
			enrs: []aidTestEnr{{1001, 11, enrolled}, {1002, 31, enrolled}},
			setup: func(c *aidAttributionContext) {
				c.Decisions = &fakeAidDecision{match: aidAttribution{PersonCMID: 1002, SessionCMID: 31,
					Family: programFamilyBMitzvah, RequestID: "req0000000001"}}
			},
			in: household,
			want: aidAttribution{Level: aidLevelDecision, Method: aidMethodDecision, PersonCMID: 1002,
				SessionCMID: 31, Family: programFamilyBMitzvah, RequestID: "req0000000001"},
		},
		{
			name: "an override outranks a matched decision", members: siblings,
			setup: func(c *aidAttributionContext) {
				c.Overrides[9001] = aidOverride{SessionCMID: 21, Source: aidOverrideSourceStaff}
				c.Decisions = &fakeAidDecision{match: aidAttribution{SessionCMID: 11}}
			},
			in: household,
			want: aidAttribution{Level: aidLevelOverride, Method: aidMethodOverrideStaff, SessionCMID: 21,
				Family: programFamilyFamilyCamp},
		},
		{
			// Review Focus 7: outside money booked as camp aid is reclassified, not placed.
			name: "an override that only reclassifies the source leaves placement to inference", members: siblings,
			enrs: []aidTestEnr{{1001, 11, enrolled}},
			setup: func(c *aidAttributionContext) {
				c.Overrides[9001] = aidOverride{Source: aidOverrideSourceStaff, SourceKey: "outside program award"}
			},
			in: household,
			want: aidAttribution{Level: aidLevelSession, Method: aidMethodHouseholdSingleCamper,
				PersonCMID: 1001, SessionCMID: 11, Family: programFamilySummer},
		},
		{
			// Item 4 (final review, controller ruling): a placing override that
			// names a person but no session and no family used to get an empty
			// family, which the Python program_bucket reports as "ambiguous"
			// even though the named person's own enrollments settle it.
			name:    "an override naming only a person with no active enrollment leaves the family empty",
			members: siblings, in: household,
			setup: func(c *aidAttributionContext) {
				c.Overrides[9001] = aidOverride{PersonCMID: 1001, Source: aidOverrideSourceStaff}
			},
			want: aidAttribution{Level: aidLevelOverride, Method: aidMethodOverrideStaff, PersonCMID: 1001},
		},
		{
			name:    "an override naming only a person takes that person's single-family enrollment",
			members: siblings,
			enrs:    []aidTestEnr{{1001, 11, enrolled}},
			setup: func(c *aidAttributionContext) {
				c.Overrides[9001] = aidOverride{PersonCMID: 1001, Source: aidOverrideSourceStaff}
			},
			in: household,
			want: aidAttribution{Level: aidLevelOverride, Method: aidMethodOverrideStaff, PersonCMID: 1001,
				Family: programFamilySummer},
		},
		{
			name:    "an override naming only a person leaves the family empty across two families",
			members: siblings,
			enrs:    []aidTestEnr{{1001, 11, enrolled}, {1001, 31, enrolled}},
			setup: func(c *aidAttributionContext) {
				c.Overrides[9001] = aidOverride{PersonCMID: 1001, Source: aidOverrideSourceStaff}
			},
			in:   household,
			want: aidAttribution{Level: aidLevelOverride, Method: aidMethodOverrideStaff, PersonCMID: 1001},
		},
		{
			name: "rule 3: no enrollment at all", members: siblings, in: household,
			want: aidAttribution{Level: aidLevelNone, Method: aidMethodNoEnrollment},
		},
		{
			name: "rule 3: a cancelled enrollment marks the candidate", members: siblings,
			enrs: []aidTestEnr{{1001, 11, cancelled}}, in: household,
			want: aidAttribution{Level: aidLevelNone, Method: aidMethodNoEnrollment, CandidateCancelled: true},
		},
		{
			// Item 9 (final review, tests only): 256 (withdrawn) is the other
			// aidCancelledStatusIDs member beside 32 (cancelled) -- both mark
			// CandidateCancelled the same way.
			name: "rule 3: a withdrawn enrollment marks the candidate", members: siblings,
			enrs: []aidTestEnr{{1001, 11, withdrawn}}, in: household,
			want: aidAttribution{Level: aidLevelNone, Method: aidMethodNoEnrollment, CandidateCancelled: true},
		},
		{
			name: "rule 3: waitlisted is not enrolled and not cancelled", members: siblings,
			enrs: []aidTestEnr{{1001, 11, waitlisted}}, in: household,
			want: aidAttribution{Level: aidLevelNone, Method: aidMethodNoEnrollment},
		},
		{
			name: "rules 1 and 4: a posted person narrows the candidates to that person", members: siblings,
			enrs: []aidTestEnr{{1001, 11, enrolled}, {1002, 21, enrolled}},
			in:   aidPostingInput{TransactionCMID: 9001, HouseholdCMID: 100, PersonCMID: 1001},
			want: aidAttribution{Level: aidLevelSession, Method: aidMethodPostedPersonSingle,
				PersonCMID: 1001, SessionCMID: 11, Family: programFamilySummer},
		},
		{
			name: "rule 4: one enrolled camper in the household", members: siblings,
			enrs: []aidTestEnr{{1001, 11, enrolled}}, in: household,
			want: aidAttribution{Level: aidLevelSession, Method: aidMethodHouseholdSingleCamper,
				PersonCMID: 1001, SessionCMID: 11, Family: programFamilySummer},
		},
		{
			name: "rule 1: a linked second household contributes its camper", members: map[int][]int{200: {1003}},
			enrs: []aidTestEnr{{1003, 13, enrolled}},
			setup: func(c *aidAttributionContext) {
				c.Families = newAidFamilyIndex([]aidHouseholdLink{
					{HouseholdCMID: 100, FamilyKey: "hh-100", Source: aidLinkSourceAuto},
					{HouseholdCMID: 200, FamilyKey: "hh-100", Source: aidLinkSourceAuto},
				})
			},
			in: household,
			want: aidAttribution{Level: aidLevelSession, Method: aidMethodHouseholdSingleCamper,
				PersonCMID: 1003, SessionCMID: 13, Family: programFamilyQuest},
		},
		{
			name: "rule 4: duplicate attendee rows collapse to one enrollment", members: siblings,
			enrs: []aidTestEnr{{1001, 11, enrolled}, {1001, 11, enrolled}}, in: household,
			want: aidAttribution{Level: aidLevelSession, Method: aidMethodHouseholdSingleCamper,
				PersonCMID: 1001, SessionCMID: 11, Family: programFamilySummer},
		},
		{
			name: "rule 5: one camper in two sessions of one family", members: siblings,
			enrs: []aidTestEnr{{1001, 11, enrolled}, {1001, 12, enrolled}}, in: household,
			want: aidAttribution{Level: aidLevelPerson, Method: aidMethodSinglePersonMulti, PersonCMID: 1001,
				Family: programFamilySummer, CandidateFamilies: []string{programFamilySummer}},
		},
		{
			name: "rule 5: one camper across two families", members: siblings,
			enrs: []aidTestEnr{{1001, 11, enrolled}, {1001, 21, enrolled}}, in: household,
			want: aidAttribution{Level: aidLevelPerson, Method: aidMethodSinglePersonMulti, PersonCMID: 1001,
				CandidateFamilies: []string{programFamilyFamilyCamp, programFamilySummer}},
		},
		{
			// Impact §2.2 Task 4: a 2027 per-program description names one family.
			name: "rule 5: a single-family source places one camper enrolled in two programs", members: siblings,
			enrs: []aidTestEnr{{1001, 11, enrolled}, {1001, 21, enrolled}},
			in: aidPostingInput{TransactionCMID: 9001, HouseholdCMID: 100, PersonCMID: 1001,
				ImpliedFamilies: []string{programFamilyFamilyCamp}},
			want: aidAttribution{Level: aidLevelSession, Method: aidMethodSourceImplied,
				PersonCMID: 1001, SessionCMID: 21, Family: programFamilyFamilyCamp},
		},
		{
			name: "rule 5: a single-family source with two sessions in that family stays at the person", members: siblings,
			enrs: []aidTestEnr{{1001, 11, enrolled}, {1001, 12, enrolled}, {1001, 21, enrolled}},
			in: aidPostingInput{TransactionCMID: 9001, HouseholdCMID: 100, PersonCMID: 1001,
				ImpliedFamilies: []string{programFamilySummer}},
			want: aidAttribution{Level: aidLevelPerson, Method: aidMethodSourceImplied, PersonCMID: 1001,
				Family: programFamilySummer, CandidateFamilies: []string{programFamilySummer}},
		},
		{
			name: "rule 5: a source naming a family the camper is not in changes nothing", members: siblings,
			enrs: []aidTestEnr{{1001, 11, enrolled}, {1001, 21, enrolled}},
			in: aidPostingInput{TransactionCMID: 9001, HouseholdCMID: 100, PersonCMID: 1001,
				ImpliedFamilies: []string{programFamilyBMitzvah}},
			want: aidAttribution{Level: aidLevelPerson, Method: aidMethodSinglePersonMulti, PersonCMID: 1001,
				CandidateFamilies: []string{programFamilyFamilyCamp, programFamilySummer}},
		},
		{
			name: "rule 6: a single-family source on a household enrolled in several programs", members: three,
			enrs: []aidTestEnr{{1001, 11, enrolled}, {1002, 21, enrolled}, {1003, 31, enrolled}},
			in: aidPostingInput{TransactionCMID: 9001, HouseholdCMID: 100,
				ImpliedFamilies: []string{programFamilyBMitzvah}},
			want: aidAttribution{Level: aidLevelSession, Method: aidMethodSourceImplied,
				PersonCMID: 1003, SessionCMID: 31, Family: programFamilyBMitzvah},
		},
		{
			name: "rule 6: the implied family picks the one matching enrollment", members: siblings,
			enrs: []aidTestEnr{{1001, 11, enrolled}, {1002, 21, enrolled}},
			in: aidPostingInput{TransactionCMID: 9001, HouseholdCMID: 100,
				ImpliedFamilies: []string{programFamilyFamilyCamp}},
			want: aidAttribution{Level: aidLevelSession, Method: aidMethodSourceImplied,
				PersonCMID: 1002, SessionCMID: 21, Family: programFamilyFamilyCamp},
		},
		{
			name: "rule 6: several implied enrollments in one family", members: three,
			enrs: []aidTestEnr{{1001, 21, enrolled}, {1002, 21, enrolled}, {1003, 11, enrolled}},
			in: aidPostingInput{TransactionCMID: 9001, HouseholdCMID: 100,
				ImpliedFamilies: []string{programFamilyFamilyCamp}},
			want: aidAttribution{Level: aidLevelProgramFamily, Method: aidMethodSourceImplied,
				Family: programFamilyFamilyCamp},
		},
		{
			name: "rule 6: implied families narrow what the later rules see", members: three,
			enrs: []aidTestEnr{{1001, 11, enrolled}, {1002, 14, enrolled}, {1003, 21, enrolled}},
			in: aidPostingInput{TransactionCMID: 9001, HouseholdCMID: 100,
				ImpliedFamilies: []string{programFamilySummer, programFamilyQuest, programFamilyTeen}},
			want: aidAttribution{Level: aidLevelAmbiguous, Method: aidMethodAmbiguous,
				CandidateFamilies: []string{programFamilySummer, programFamilyTeen}},
		},
		{
			// Item 10 (final review, controller ruling): the applicant's answer names
			// their own session, but the sibling never answered at all -- a sibling
			// with no resolving answer blocks rule 7's session branch; see the SP4
			// rule-7 sibling ruling. Only the family is placed.
			name:    "rule 7: own-session answer, but a silent sibling means only the family is placed",
			members: siblings,
			enrs:    []aidTestEnr{{1001, 11, enrolled}, {1002, 12, enrolled}},
			setup:   func(c *aidAttributionContext) { c.FAAnswersByPerson[1001] = []string{"Session 2"} },
			in:      household,
			want: aidAttribution{Level: aidLevelProgramFamily, Method: aidMethodFAApplication,
				PersonCMID: 1001, Family: programFamilySummer},
		},
		{
			// Item 10 (final review, controller ruling): the applicant's answer
			// resolves to a family they're enrolled in, but the sibling never
			// answered and is enrolled in a wholly different family -- a sibling
			// with no resolving answer blocks rule 7's family branch too, since
			// their own enrollment lies outside the answered family; see the SP4
			// rule-7 sibling ruling. Falls through rules 8-9 to ambiguous.
			name:    "rule 7: family-only answer, but a silent sibling in a different family leaves it ambiguous",
			members: siblings,
			enrs:    []aidTestEnr{{1001, 12, enrolled}, {1002, 31, enrolled}},
			setup:   func(c *aidAttributionContext) { c.FAAnswersByPerson[1001] = []string{"session  2"} },
			in:      household,
			want: aidAttribution{Level: aidLevelAmbiguous, Method: aidMethodAmbiguous,
				CandidateFamilies: []string{programFamilyBMitzvah, programFamilySummer}},
		},
		{
			name: "rule 7: two applicants each resolve, so only the family is placed", members: siblings,
			enrs: []aidTestEnr{{1001, 11, enrolled}, {1002, 12, enrolled}},
			setup: func(c *aidAttributionContext) {
				c.FAAnswersByPerson[1001] = []string{"Session 2"}
				c.FAAnswersByPerson[1002] = []string{"Session 3"}
			},
			in:   household,
			want: aidAttribution{Level: aidLevelProgramFamily, Method: aidMethodFAApplication, Family: programFamilySummer},
		},
		{
			name: "rule 7: an answer naming no known session is ignored", members: siblings,
			enrs:  []aidTestEnr{{1001, 11, enrolled}, {1002, 31, enrolled}},
			setup: func(c *aidAttributionContext) { c.FAAnswersByPerson[1001] = []string{"Session 9"} },
			in:    household,
			want: aidAttribution{Level: aidLevelAmbiguous, Method: aidMethodAmbiguous,
				CandidateFamilies: []string{programFamilyBMitzvah, programFamilySummer}},
		},
		{
			// Fix round 1 (task review): a sibling's answer that resolves to a family they
			// have zero enrollments in is noise, same as an answer naming no known session at
			// all -- it must not block the single-session winner.
			name:    "rule 7: a sibling's answer naming a family they are not enrolled in does not block the winner",
			members: siblings,
			enrs:    []aidTestEnr{{1001, 11, enrolled}, {1002, 21, enrolled}},
			setup: func(c *aidAttributionContext) {
				c.FAAnswersByPerson[1001] = []string{"Session 2"}
				c.FAAnswersByPerson[1002] = []string{"Mitzvah Year 1"}
			},
			in: household,
			want: aidAttribution{Level: aidLevelSession, Method: aidMethodFAApplication,
				PersonCMID: 1001, SessionCMID: 11, Family: programFamilySummer},
		},
		{
			// Fix round 1 (task review + controller ruling): a sibling's answer names a
			// session in the SAME family they are actually enrolled in, just a different
			// session of it (moved from Mitzvah Year 1 to Mitzvah Year 2). That is a real
			// second family in play, so the single-session winner must not be picked; falls
			// through the family branch (two families, not one) and rule 8 (families differ)
			// to rule 9, ambiguous.
			name:    "rule 7: a sibling's answer naming a session they moved from, in the same family, blocks the winner",
			members: siblings,
			enrs:    []aidTestEnr{{1001, 11, enrolled}, {1002, 32, enrolled}},
			setup: func(c *aidAttributionContext) {
				c.FAAnswersByPerson[1001] = []string{"Session 2"}
				c.FAAnswersByPerson[1002] = []string{"Mitzvah Year 1"}
			},
			in: household,
			want: aidAttribution{Level: aidLevelAmbiguous, Method: aidMethodAmbiguous,
				CandidateFamilies: []string{programFamilyBMitzvah, programFamilySummer}},
		},
		{
			// Item 10 (final review, controller ruling): two siblings share the
			// EXACT session an FA answer names, and the other one never answered
			// at all. That silence does not rule the silent sibling out -- they
			// occupy the very session in question just as much as the answering
			// one -- so rule 7 must not pin a person, and must not even claim
			// the family branch produced it: it steps back to rule 8's
			// person-blind, session-blind family conclusion.
			name:    "rule 7: a silent sibling in the SAME named session blocks both the session and the family branch",
			members: siblings,
			enrs:    []aidTestEnr{{1001, 11, enrolled}, {1002, 11, enrolled}},
			setup:   func(c *aidAttributionContext) { c.FAAnswersByPerson[1001] = []string{"Session 2"} },
			in:      household,
			want: aidAttribution{Level: aidLevelProgramFamily, Method: aidMethodHouseholdSingleFamily,
				Family: programFamilySummer},
		},
		{
			// Item 10 (final review, controller ruling): the silent sibling is
			// enrolled in a DIFFERENT session of the SAME family the answer
			// named (moved on from Mitzvah Year 1 to Mitzvah Year 2, never
			// applied themselves). Unlike the same-session case above, the
			// silent sibling is not a competing claimant for the exact named
			// session, so rule 7's own family branch may still credit the
			// applicant.
			name:    "rule 7: a silent sibling in a different same-family session still lets the family place the applicant",
			members: siblings,
			enrs:    []aidTestEnr{{1001, 31, enrolled}, {1002, 32, enrolled}},
			setup:   func(c *aidAttributionContext) { c.FAAnswersByPerson[1001] = []string{"Mitzvah Year 1"} },
			in:      household,
			want: aidAttribution{Level: aidLevelProgramFamily, Method: aidMethodFAApplication,
				PersonCMID: 1001, Family: programFamilyBMitzvah},
		},
		{
			// Item 10 (final review, controller ruling): the applicant's answer
			// names their own summer session, but the silent sibling is enrolled
			// in a wholly different program family (B*Mitzvah). That is a real
			// second family in play with no signal ruling it out, so rule 7 does
			// not apply at all -- falls through rule 8 (families differ) to
			// rule 9, ambiguous.
			name:    "rule 7: a silent sibling in a wholly different family leaves the row ambiguous",
			members: siblings,
			enrs:    []aidTestEnr{{1001, 11, enrolled}, {1002, 31, enrolled}},
			setup:   func(c *aidAttributionContext) { c.FAAnswersByPerson[1001] = []string{"Session 2"} },
			in:      household,
			want: aidAttribution{Level: aidLevelAmbiguous, Method: aidMethodAmbiguous,
				CandidateFamilies: []string{programFamilyBMitzvah, programFamilySummer}},
		},
		{
			name: "rule 8: every enrollment in one family", members: siblings,
			enrs: []aidTestEnr{{1001, 11, enrolled}, {1002, 12, enrolled}}, in: household,
			want: aidAttribution{Level: aidLevelProgramFamily, Method: aidMethodHouseholdSingleFamily,
				Family: programFamilySummer},
		},
		{
			name: "rule 9: families differ, so the row stays ambiguous", members: siblings,
			enrs: []aidTestEnr{{1001, 11, enrolled}, {1002, 31, enrolled}}, in: household,
			want: aidAttribution{Level: aidLevelAmbiguous, Method: aidMethodAmbiguous,
				CandidateFamilies: []string{programFamilyBMitzvah, programFamilySummer}},
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			c := newAidTestContext(tc.members, tc.enrs)
			if tc.setup != nil {
				tc.setup(c)
			}
			if got := c.attribute(tc.in); !reflect.DeepEqual(got, tc.want) {
				t.Errorf("got  %+v\nwant %+v", got, tc.want)
			}
		})
	}
}

func TestNoAidDecisionMatchNeverMatches(t *testing.T) {
	t.Parallel()
	if _, ok := (noAidDecisionMatch{}).MatchDecision(aidPostingInput{TransactionCMID: 1}); ok {
		t.Fatal("the sub-project 11 hook must not match anything until decisions exist")
	}
}

// The select vocabularies in pb_migrations/1500000198_aid_postings.js must hold
// every value this package writes; a value missing there fails every save.
func TestAidVocabularyMatchesMigration(t *testing.T) {
	t.Parallel()
	raw, err := os.ReadFile("../pb_migrations/1500000198_aid_postings.js")
	if err != nil {
		t.Fatalf("read migration: %v", err)
	}
	body := string(raw)
	values := append([]string{}, aidProgramFamilies...)
	values = append(values,
		aidLevelOverride, aidLevelDecision, aidLevelSession, aidLevelPerson, aidLevelProgramFamily,
		aidLevelAmbiguous, aidLevelNone,
		aidMethodOverrideSheet, aidMethodOverrideStaff, aidMethodDecision, aidMethodPostedPersonSingle,
		aidMethodHouseholdSingleCamper, aidMethodSinglePersonMulti, aidMethodSourceImplied,
		aidMethodFAApplication, aidMethodHouseholdSingleFamily, aidMethodNoEnrollment, aidMethodAmbiguous)
	for _, v := range values {
		if !strings.Contains(body, `"`+v+`"`) {
			t.Errorf("aid_postings migration does not declare %q", v)
		}
	}
}
