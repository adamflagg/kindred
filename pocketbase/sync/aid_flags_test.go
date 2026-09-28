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

	tests := []struct {
		name     string
		drafts   []*aidPostingDraft
		statuses map[aidPersonSession]int
		want     [][]string
	}{
		{
			name:     "a session posting is clean",
			drafts:   []*aidPostingDraft{draft(9001, -500, "camp aid", session(1001, 11))},
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
			statuses: map[aidPersonSession]int{ps(1001, 11): 32},
			want:     [][]string{{aidFlagCancelledEnrollment}},
		},
		{
			name: "equal awards to two siblings in different sessions produce no flags",
			drafts: []*aidPostingDraft{
				draft(9001, -500, "camp aid", session(1001, 11)),
				draft(9002, -500, "camp aid", session(1002, 12)),
			},
			want: [][]string{{}, {}},
		},
		{
			name: "a Family Camp household grant well above one member's own session fee produces no flag",
			drafts: []*aidPostingDraft{
				draft(9001, -5000, "camp aid", aidAttribution{Level: aidLevelProgramFamily, Family: programFamilyFamilyCamp}),
			},
			want: [][]string{{}},
		},
		{
			name: "a reversed history row carries no flags even where a live one would",
			drafts: []*aidPostingDraft{
				reversed(draft(9001, 100, "camp aid", session(1001, 11))),
				draft(9002, 100, "camp aid", session(1002, 12)),
				reversed(draft(9003, 50, "x", aidAttribution{Level: aidLevelNone, CandidateCancelled: true})),
			},
			want: [][]string{{}, {aidFlagPositiveAmount}, {}},
		},
		{
			name: "a source naming family camp placed by inference in summer",
			drafts: []*aidPostingDraft{
				implied(draft(9001, -200, "family incentive grant", session(1001, 11)), programFamilyFamilyCamp),
			},
			want: [][]string{{aidFlagImpliedProgramMismatch}},
		},
		{
			name: "an override may place against the implied family without a flag",
			drafts: []*aidPostingDraft{implied(draft(9001, -200, "family incentive grant",
				aidAttribution{Level: aidLevelOverride, Family: programFamilySummer}), programFamilyFamilyCamp)},
			want: [][]string{{}},
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			computeAidFlags(tc.drafts, tc.statuses)
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
