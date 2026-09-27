package sync

import (
	"slices"
	"testing"
)

func TestComputeAidFlags(t *testing.T) {
	t.Parallel()
	session := func(p, s int) aidAttribution {
		return aidAttribution{Level: aidLevelSession, PersonCMID: p, SessionCMID: s, Family: programFamilySummer}
	}
	ps := func(p, s int) aidPersonSession { return aidPersonSession{Person: p, Session: s} }
	draft := func(txn int, amount float64, key string, a aidAttribution) *aidPostingDraft {
		family := "other_outside"
		if key == "camp aid" {
			family = aidSourceFamilyCampFA
		}
		return &aidPostingDraft{Year: 2026, TransactionCMID: txn, HouseholdCMID: 100, Amount: amount,
			SourceKey: key, EffectiveSourceKey: key, SourceFamily: family, Attribution: a}
	}
	reversed := func(d *aidPostingDraft) *aidPostingDraft { d.IsReversed = true; return d }
	implied := func(d *aidPostingDraft, families ...string) *aidPostingDraft { d.ImpliedFamilies = families; return d }
	// withPerson sets the RAW posted person (the top-level field a real financial_transactions
	// row carries), distinct from Attribution.PersonCMID -- the attributed person computeAidFlags
	// used exclusively before the sibling-duplicate fix (kindred aid-ledger hardening).
	withPerson := func(d *aidPostingDraft, p int) *aidPostingDraft { d.PersonCMID = p; return d }

	tests := []struct {
		name       string
		drafts     []*aidPostingDraft
		fees       map[aidPersonSession]float64
		statuses   map[aidPersonSession]int
		enrollment map[int]int
		want       [][]string
	}{
		{
			name:     "a session posting under the fee is clean",
			drafts:   []*aidPostingDraft{draft(9001, -500, "camp aid", session(1001, 11))},
			fees:     map[aidPersonSession]float64{ps(1001, 11): 2000},
			statuses: map[aidPersonSession]int{ps(1001, 11): 2},
			want:     [][]string{{}},
		},
		{
			name: "unclassified source and a positive amount",
			drafts: []*aidPostingDraft{{TransactionCMID: 9001, HouseholdCMID: 100, Amount: 40, SourceKey: "x",
				SourceUnclassified: true, Attribution: aidAttribution{Level: aidLevelAmbiguous}}},
			want: [][]string{{aidFlagPositiveAmount, aidFlagUnclassifiedSource}},
		},
		{
			name: "no enrollment, but a candidate cancelled",
			drafts: []*aidPostingDraft{draft(9001, -500, "camp aid",
				aidAttribution{Level: aidLevelNone, CandidateCancelled: true})},
			want: [][]string{{aidFlagCancelledEnrollment}},
		},
		{
			name: "an override placed on a cancelled enrollment",
			drafts: []*aidPostingDraft{draft(9001, -500, "camp aid",
				aidAttribution{Level: aidLevelOverride, PersonCMID: 1001, SessionCMID: 11})},
			fees:     map[aidPersonSession]float64{ps(1001, 11): 2000},
			statuses: map[aidPersonSession]int{ps(1001, 11): 32},
			want:     [][]string{{aidFlagCancelledEnrollment}},
		},
		{
			name: "camp aid plus an outside grant above the fee flags both",
			drafts: []*aidPostingDraft{
				draft(9001, -1500, "camp aid", session(1001, 11)),
				draft(9002, -800, "regional grant - north", session(1001, 11)),
			},
			fees: map[aidPersonSession]float64{ps(1001, 11): 2000},
			want: [][]string{{aidFlagExceedsFee}, {aidFlagExceedsFee}},
		},
		{
			name:   "aid exactly equal to the fee is not above it",
			drafts: []*aidPostingDraft{draft(9001, -2000, "camp aid", session(1001, 11))},
			fees:   map[aidPersonSession]float64{ps(1001, 11): 2000},
			want:   [][]string{{}},
		},
		{
			name:   "no billed fee is unknown, not zero",
			drafts: []*aidPostingDraft{draft(9001, -500, "camp aid", session(1001, 11))},
			want:   [][]string{{aidFlagFeeUnknown}},
		},
		{
			name: "the same award posted twice",
			drafts: []*aidPostingDraft{
				draft(9001, -500, "camp aid", aidAttribution{Level: aidLevelProgramFamily, Family: programFamilySummer}),
				draft(9002, -500, "camp aid", aidAttribution{Level: aidLevelProgramFamily, Family: programFamilySummer}),
			},
			want: [][]string{{aidFlagDuplicatePosting}, {aidFlagDuplicatePosting}},
		},
		{
			name: "equal awards to two siblings are not duplicates",
			drafts: []*aidPostingDraft{
				draft(9001, -500, "camp aid", session(1001, 11)),
				draft(9002, -500, "camp aid", session(1002, 12)),
			},
			fees: map[aidPersonSession]float64{ps(1001, 11): 5000, ps(1002, 12): 5000},
			want: [][]string{{}, {}},
		},
		{
			// Tracker C1's shape, fictional amounts: a stale minimum left live beside a later award.
			name: "a stale minimum beside a later camp award on one placement",
			drafts: []*aidPostingDraft{
				draft(9001, -100, "camp aid", session(1001, 11)),
				draft(9002, -900, "camp aid", session(1001, 11)),
			},
			fees: map[aidPersonSession]float64{ps(1001, 11): 5000},
			want: [][]string{{aidFlagSeveralLivePostings}, {aidFlagSeveralLivePostings}},
		},
		{
			name: "camp aid and an outside grant on one placement are not several camp postings",
			drafts: []*aidPostingDraft{
				draft(9001, -100, "camp aid", session(1001, 11)),
				draft(9002, -900, "regional grant - north", session(1001, 11)),
			},
			fees: map[aidPersonSession]float64{ps(1001, 11): 5000},
			want: [][]string{{}, {}},
		},
		{
			name: "a reversed history row carries no flags and joins no group",
			drafts: []*aidPostingDraft{
				reversed(draft(9001, -100, "camp aid", session(1001, 11))),
				draft(9002, -900, "camp aid", session(1001, 11)),
				reversed(draft(9003, 50, "x", aidAttribution{Level: aidLevelNone, CandidateCancelled: true})),
			},
			fees: map[aidPersonSession]float64{ps(1001, 11): 800},
			want: [][]string{{}, {aidFlagExceedsFee}, {}},
		},
		{
			name: "a source naming family camp placed by inference in summer",
			drafts: []*aidPostingDraft{
				implied(draft(9001, -200, "family incentive grant", session(1001, 11)), programFamilyFamilyCamp),
			},
			fees: map[aidPersonSession]float64{ps(1001, 11): 5000},
			want: [][]string{{aidFlagImpliedProgramMismatch}},
		},
		{
			name: "an override may place against the implied family without a flag",
			drafts: []*aidPostingDraft{implied(draft(9001, -200, "family incentive grant",
				aidAttribution{Level: aidLevelOverride, Family: programFamilySummer}), programFamilyFamilyCamp)},
			want: [][]string{{}},
		},
		{
			// F3 fix: a household-grain grant posted once per enrolled sibling must not be
			// flagged. Both rows carry no raw person (household-grain), so the group is sized
			// against the household's enrolled campers rather than distinct transaction count.
			name: "siblings: 2 enrolled children, 2 identical household rows is not a duplicate",
			drafts: []*aidPostingDraft{
				draft(9001, -500, "camp aid", aidAttribution{Level: aidLevelProgramFamily, Family: programFamilySummer}),
				draft(9002, -500, "camp aid", aidAttribution{Level: aidLevelProgramFamily, Family: programFamilySummer}),
			},
			enrollment: map[int]int{100: 2},
			want:       [][]string{{}, {}},
		},
		{
			// The real-duplicate case: only 1 enrolled camper in the household, so 2 identical
			// rows is more rows than enrolled campers and must still be flagged.
			name: "1 enrolled child, 2 identical household rows is a real duplicate",
			drafts: []*aidPostingDraft{
				draft(9001, -500, "camp aid", aidAttribution{Level: aidLevelProgramFamily, Family: programFamilySummer}),
				draft(9002, -500, "camp aid", aidAttribution{Level: aidLevelProgramFamily, Family: programFamilySummer}),
			},
			enrollment: map[int]int{100: 1},
			want:       [][]string{{aidFlagDuplicatePosting}, {aidFlagDuplicatePosting}},
		},
		{
			// A real posted person (raw, not just attributed) still uses the distinct-transaction
			// rule, unaffected by household enrollment (deliberately generous here at 5).
			name: "person-level duplicates are still flagged regardless of household enrollment",
			drafts: []*aidPostingDraft{
				withPerson(draft(9001, -500, "camp aid", session(1001, 11)), 1001),
				withPerson(draft(9002, -500, "camp aid", session(1001, 11)), 1001),
			},
			fees:       map[aidPersonSession]float64{ps(1001, 11): 5000},
			enrollment: map[int]int{100: 5},
			want:       [][]string{{aidFlagDuplicatePosting}, {aidFlagDuplicatePosting}},
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			computeAidFlags(tc.drafts, tc.fees, tc.statuses, tc.enrollment)
			for i, d := range tc.drafts {
				if d.Flags == nil {
					t.Fatalf("draft %d: Flags must never be nil (it is written as a JSON array)", i)
				}
				if !slices.Equal(d.Flags, tc.want[i]) {
					t.Errorf("draft %d flags = %v, want %v", i, d.Flags, tc.want[i])
				}
			}
		})
	}
}

func TestAidCentsRoundsHalfAwayFromZero(t *testing.T) {
	t.Parallel()
	cases := map[float64]int64{-500: -50000, 0.005: 1, -0.005: -1, 12.344: 1234}
	for in, want := range cases {
		if got := aidCents(in); got != want {
			t.Errorf("aidCents(%v) = %d, want %d", in, got, want)
		}
	}
}
