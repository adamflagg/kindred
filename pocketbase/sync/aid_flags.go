package sync

import (
	"math"
	"slices"
	"sort"

	"github.com/pocketbase/pocketbase/tools/types"
)

// Posting flags computable from synced data (spec §6.6), on live rows only.
// Decision-related flags arrive with sub-project 11, grant flags with
// sub-project 6. These are not the calculator's quality_checks: they carry no
// hold/warn severity. Finance closes one with an aid_flag_dispositions row.
const (
	aidFlagUnclassifiedSource     = "unclassified_source"
	aidFlagPositiveAmount         = "positive_amount"
	aidFlagCancelledEnrollment    = "live_aid_on_cancelled_enrollment"
	aidFlagImpliedProgramMismatch = "implied_program_mismatch"

	// aidSourceFamilyCampFA is the camp's own aid (aid_sources.source_family).
	aidSourceFamilyCampFA = "camp_fa"
)

type aidPersonSession struct {
	Person  int
	Session int
}

// aidPostingDraft is one aid_postings row before it is written. IsReversed
// marks a reversed credit leg kept as history: it is attributed and classified
// like a live row (as-of reads need both) but carries no flags.
type aidPostingDraft struct {
	Year               int
	TransactionCMID    int
	CategoryCMID       int
	HouseholdCMID      int
	PersonCMID         int
	Amount             float64
	SourceKey          string
	SourceUnclassified bool
	ImpliedFamilies    []string
	EffectiveSourceKey string
	SourceFamily       string
	FunderType         string
	CountsTowardBudget bool
	IsReversed         bool
	PostDate           types.DateTime
	EffectiveDate      types.DateTime
	ReversalDate       types.DateTime
	TransactionNote    string
	Attribution        aidAttribution
	Flags              []string
}

// aidCents is an amount in whole cents, rounded half away from zero.
func aidCents(v float64) int64 {
	return int64(math.Round(v * 100))
}

// computeAidFlags sets Flags on every draft. statuses is the attendee status
// per (person, session), holding 2 when any row for that pair is enrolled.
func computeAidFlags(drafts []*aidPostingDraft, statuses map[aidPersonSession]int) {
	flags := make([]map[string]bool, len(drafts))
	add := func(i int, f string) {
		if flags[i] == nil {
			flags[i] = map[string]bool{}
		}
		flags[i][f] = true
	}

	for i, d := range drafts {
		if d.IsReversed {
			continue
		}
		a := d.Attribution
		if d.SourceUnclassified {
			add(i, aidFlagUnclassifiedSource)
		}
		if d.Amount > 0 {
			add(i, aidFlagPositiveAmount)
		}
		if a.Level == aidLevelNone && a.CandidateCancelled {
			add(i, aidFlagCancelledEnrollment)
		}
		if len(d.ImpliedFamilies) > 0 && a.Family != "" && a.Level != aidLevelOverride && a.Level != aidLevelDecision &&
			!slices.Contains(d.ImpliedFamilies, a.Family) {
			add(i, aidFlagImpliedProgramMismatch)
		}
		if a.PersonCMID > 0 && a.SessionCMID > 0 {
			key := aidPersonSession{Person: a.PersonCMID, Session: a.SessionCMID}
			if status, ok := statuses[key]; ok && aidCancelledStatusIDs[status] {
				add(i, aidFlagCancelledEnrollment)
			}
		}
	}
	for i, d := range drafts {
		out := make([]string, 0, len(flags[i]))
		for f := range flags[i] {
			out = append(out, f)
		}
		sort.Strings(out)
		d.Flags = out
	}
}
