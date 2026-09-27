package sync

import (
	"fmt"
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
	aidFlagExceedsFee             = "aid_exceeds_fee"
	aidFlagFeeUnknown             = "fee_unknown"
	aidFlagDuplicatePosting       = "duplicate_posting"
	aidFlagSeveralLivePostings    = "several_live_postings"
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

// computeAidFlags sets Flags on every draft. fees is the billed fee per
// (person, session); statuses is the attendee status per (person, session),
// holding 2 when any row for that pair is enrolled. householdEnrollment is the
// count of distinct enrolled (status 2) campers per household CampMinder id,
// used only to size the sibling-duplicate exception below (F3).
func computeAidFlags(
	drafts []*aidPostingDraft, fees map[aidPersonSession]float64, statuses map[aidPersonSession]int,
	householdEnrollment map[int]int,
) {
	flags := make([]map[string]bool, len(drafts))
	add := func(i int, f string) {
		if flags[i] == nil {
			flags[i] = map[string]bool{}
		}
		flags[i][f] = true
	}
	aidTotals := map[aidPersonSession]int64{}
	feeMembers := map[aidPersonSession][]int{}
	dupTxns := map[string]map[int]bool{}
	dupMembers := map[string][]int{}
	campPlaced := map[aidPersonSession][]int{}

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
			if fees[key] <= 0 {
				add(i, aidFlagFeeUnknown)
			} else {
				aidTotals[key] += -aidCents(d.Amount)
				feeMembers[key] = append(feeMembers[key], i)
			}
			if d.SourceFamily == aidSourceFamilyCampFA {
				campPlaced[key] = append(campPlaced[key], i)
			}
		}
		// The RAW posted person (d.PersonCMID), not the attributed one (a.PersonCMID): a
		// household-grain posting attributes to a synthesized person per sibling
		// (e.g. household_single_camper), which used to give each sibling's identical
		// grant a distinct key and defeat this exact check. Grouping on the raw person
		// (0 when CampMinder posted no person at all) is what lets the household-grain
		// branch below compare row count against the household's enrollment instead.
		rawPerson := 0
		if d.PersonCMID > 0 {
			rawPerson = d.PersonCMID
		}
		dup := fmt.Sprintf("%d|%s|%d|%d|%d", d.HouseholdCMID, d.SourceKey, aidCents(d.Amount), rawPerson, a.SessionCMID)
		if dupTxns[dup] == nil {
			dupTxns[dup] = map[int]bool{}
		}
		dupTxns[dup][d.TransactionCMID] = true
		dupMembers[dup] = append(dupMembers[dup], i)
	}
	for key, total := range aidTotals {
		if total > aidCents(fees[key]) {
			for _, i := range feeMembers[key] {
				add(i, aidFlagExceedsFee)
			}
		}
	}
	for dup, txns := range dupTxns {
		members := dupMembers[dup]
		if len(members) == 0 {
			continue
		}
		// A real posted person: unchanged rule, >1 distinct transaction sharing the key.
		// No posted person (household-grain): one grant per enrolled sibling is expected,
		// so the group is a duplicate only once it has MORE rows than enrolled campers
		// (F3) -- not merely >1 distinct transaction, which every sibling pair already is.
		var flagged bool
		if drafts[members[0]].PersonCMID > 0 {
			flagged = len(txns) > 1
		} else {
			// len(members) > 1 first: a lone posting is never a duplicate no matter how the
			// household's enrollment count reads (0 enrolled is a data gap, not evidence).
			flagged = len(members) > 1 && len(members) > householdEnrollment[drafts[members[0]].HouseholdCMID]
		}
		if flagged {
			for _, i := range members {
				add(i, aidFlagDuplicatePosting)
			}
		}
	}
	for _, members := range campPlaced {
		txns, amounts := map[int]bool{}, map[int64]bool{}
		for _, i := range members {
			txns[drafts[i].TransactionCMID] = true
			amounts[aidCents(drafts[i].Amount)] = true
		}
		if len(txns) > 1 && len(amounts) > 1 {
			for _, i := range members {
				add(i, aidFlagSeveralLivePostings)
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
