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
	const enrolled, waitlisted, cancelled = 2, 8, 32
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
			name: "rule 3: no enrollment at all", members: siblings, in: household,
			want: aidAttribution{Level: aidLevelNone, Method: aidMethodNoEnrollment},
		},
		{
			name: "rule 3: a cancelled enrollment marks the candidate", members: siblings,
			enrs: []aidTestEnr{{1001, 11, cancelled}}, in: household,
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
			name: "rule 7: one applicant's answer names their own session", members: siblings,
			enrs:  []aidTestEnr{{1001, 11, enrolled}, {1002, 12, enrolled}},
			setup: func(c *aidAttributionContext) { c.FAAnswersByPerson[1001] = []string{"Session 2"} },
			in:    household,
			want: aidAttribution{Level: aidLevelSession, Method: aidMethodFAApplication,
				PersonCMID: 1001, SessionCMID: 11, Family: programFamilySummer},
		},
		{
			name: "rule 7: the answer resolves to a family the applicant is enrolled in", members: siblings,
			enrs:  []aidTestEnr{{1001, 12, enrolled}, {1002, 31, enrolled}},
			setup: func(c *aidAttributionContext) { c.FAAnswersByPerson[1001] = []string{"session  2"} },
			in:    household,
			want: aidAttribution{Level: aidLevelProgramFamily, Method: aidMethodFAApplication,
				PersonCMID: 1001, Family: programFamilySummer},
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
