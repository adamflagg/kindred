package sync

import (
	"testing"
	"time"
)

// Two fictional household keys. In production these are households PB record
// ids; the collapse only needs them stable and unique per household.
const (
	hhA = "hh_garcia"
	hhB = "hh_johnson"
)

// TestNormalizeShareGate pins the four real option sentences onto the 3-state
// gate spec 4.3 defines. The sentences are stored in full by CampMinder, so
// substring anchoring is the only workable approach -- but "No, we would prefer
// not to share" and "Maybe, I am open to sharing" both contain "shar", so the
// order of the checks matters.
func TestNormalizeShareGate(t *testing.T) {
	cases := map[string]string{
		"No, we would prefer not to share a camper cabin.": gateNoShare,
		"Maybe, I am open to sharing a large camper cabin if a specific family that I know " +
			"wants to share a cabin with my family.": gateMaybeMutual,
		"Yes, I would like to share a large camper cabin with a family that I request or with " +
			"a family with similarly aged kid(s) that I can meet at Camp.": gateYesShare,
		"Yes, I would like to share a large camper cabin (you will have an opportunity to " +
			"request specific families closer to the start of the program).": gateYesShare,
		"":         "",
		"  ":       "",
		"Anything": "",
	}
	for raw, want := range cases {
		if got := NormalizeShareGate(raw); got != want {
			t.Errorf("NormalizeShareGate(%.40q) = %q, want %q", raw, got, want)
		}
	}
}

// TestParseSharedCabinModes: the field is pipe-delimited multi-select and NEAR
// and WITH are different edge types. Note the sixth case: "No requests"
// co-occurs with a real request in six rows, so it must not veto.
func TestParseSharedCabinModes(t *testing.T) {
	const near = "House my family NEAR a specific family that I know (please include names below)"
	const with = "Share a cabin WITH a specific family that I know (please include names below " +
		"and ensure that the request is mutual)."
	const withOpen = "Share a cabin WITH a family with similarly aged kid(s) that I can meet at " +
		"Camp (we will make this happen if we have others interested as well)."
	const none = "No requests"

	cases := []struct {
		raw                string
		wantNear, wantWith bool
	}{
		{near, true, false},
		{with, false, true},
		{withOpen, false, true},
		{none, false, false},
		{with + "|" + near, true, true},
		{near + "|" + none, true, false},
		{"", false, false},
	}
	for _, tc := range cases {
		gotNear, gotWith := ParseSharedCabinModes(tc.raw)
		if gotNear != tc.wantNear || gotWith != tc.wantWith {
			t.Errorf("ParseSharedCabinModes(%.50q) = (%v, %v), want (%v, %v)",
				tc.raw, gotNear, gotWith, tc.wantNear, tc.wantWith)
		}
	}
}

// TestCollapseToHouseholdGrainDedupes is spec 4.2, the mandatory one: request
// fields are person-partition, so a household with two enrolled children stores
// the SAME text twice. Without collapsing first, every request is
// double-counted.
func TestCollapseToHouseholdGrainDedupes(t *testing.T) {
	ts := time.Date(2025, 4, 21, 17, 51, 0, 0, time.UTC)
	// Emma and Liam Garcia are siblings; the parent answered once and CampMinder
	// wrote the answer onto both children's records.
	values := []PersonRequestValue{
		{HouseholdKey: hhA, FieldName: "Shared-request", Value: "the Johnson family", LastUpdated: ts},
		{HouseholdKey: hhA, FieldName: "Shared-request", Value: "the Johnson family", LastUpdated: ts},
	}

	got := CollapseToHouseholdGrain(values)
	if len(got) != 1 {
		t.Fatalf("collapsed to %d households, want 1", len(got))
	}
	if got[hhA].RequestText != "the Johnson family" {
		t.Errorf("RequestText = %q; the duplicate was concatenated instead of deduped",
			got[hhA].RequestText)
	}
}

// TestCollapseToHouseholdGrainThreeChildren: observed at n=3 too.
func TestCollapseToHouseholdGrainThreeChildren(t *testing.T) {
	ts := time.Date(2025, 4, 21, 17, 51, 0, 0, time.UTC)
	var values []PersonRequestValue
	for i := 0; i < 3; i++ {
		values = append(values, PersonRequestValue{
			HouseholdKey: hhA, FieldName: "Shared-request",
			Value: "the Smith family", LastUpdated: ts,
		})
	}
	got := CollapseToHouseholdGrain(values)
	if len(got) != 1 || got[hhA].RequestText != "the Smith family" {
		t.Errorf("n=3 collapse produced %d households with text %q",
			len(got), got[hhA].RequestText)
	}
}

// TestCollapseKeepsDistinctTextFromDifferentChildren: two children with
// genuinely DIFFERENT answers is not a duplicate. Both survive, joined, because
// dropping one would lose a real request.
func TestCollapseKeepsDistinctTextFromDifferentChildren(t *testing.T) {
	ts := time.Date(2025, 4, 21, 17, 51, 0, 0, time.UTC)
	values := []PersonRequestValue{
		{HouseholdKey: hhA, FieldName: "Shared-request", Value: "the Johnson family", LastUpdated: ts},
		{HouseholdKey: hhA, FieldName: "Shared-request", Value: "the Garcia family", LastUpdated: ts},
	}
	got := CollapseToHouseholdGrain(values)
	if len(got) != 1 {
		t.Fatalf("households = %d, want 1", len(got))
	}
	text := got[hhA].RequestText
	if text != "the Johnson family; the Garcia family" && text != "the Garcia family; the Johnson family" {
		t.Errorf("RequestText = %q; both distinct answers must survive", text)
	}
}

// TestCollapsePrefersMoreRecentGate is spec 4.1: "Where the form and registration
// answers disagree, take the form's -- it is updated more often. Resolve by
// comparing last_updated, not by field name precedence alone."
func TestCollapsePrefersMoreRecentGate(t *testing.T) {
	older := time.Date(2025, 1, 10, 0, 0, 0, 0, time.UTC)
	newer := time.Date(2025, 6, 2, 0, 0, 0, 0, time.UTC)

	values := []PersonRequestValue{
		{HouseholdKey: hhA, FieldName: "FAM CAMP-Share Cabins",
			Value: "No, we would prefer not to share a camper cabin.", LastUpdated: newer},
		{HouseholdKey: hhA, FieldName: "FAM CAMP-Shared Cabin",
			Value: "Share a cabin WITH a specific family that I know (please include names " +
				"below and ensure that the request is mutual).", LastUpdated: older},
	}

	got := CollapseToHouseholdGrain(values)
	// The registration gate is NEWER here, so it wins despite the form field
	// normally taking precedence. Timestamps decide, not field names.
	if got[hhA].Gate != gateNoShare {
		t.Errorf("Gate = %q, want %q -- the newer answer must win", got[hhA].Gate, gateNoShare)
	}
	// The modes still come from the multi-select field; they are a different
	// question, not a competing answer to the same one.
	if !got[hhA].WantsWith {
		t.Error("WantsWith lost; the mode field is not in competition with the gate field")
	}
}

// TestCollapseFormWinsOnTimestampTie: with equal timestamps the form field wins,
// which is the only place the field NAME matters at all.
//
// Both values below are gate answers. In the 2025 data the form field happens to
// ask about NEAR/WITH rather than about sharing, so a real tie of this shape has
// not been observed -- but spec 4.1 states the rule for "where the form and
// registration answers disagree", and a rule with no test is a rule that breaks
// silently the first time the form is rewritten.
func TestCollapseFormWinsOnTimestampTie(t *testing.T) {
	ts := time.Date(2025, 6, 2, 0, 0, 0, 0, time.UTC)
	values := []PersonRequestValue{
		{HouseholdKey: hhA, FieldName: "FAM CAMP-Share Cabins",
			Value: "No, we would prefer not to share a camper cabin.", LastUpdated: ts},
		{HouseholdKey: hhA, FieldName: "FAM CAMP-Shared Cabin",
			Value:       "Yes, I would like to share a large camper cabin with a family that I request.",
			LastUpdated: ts},
	}
	got := CollapseToHouseholdGrain(values)
	if got[hhA].Gate != gateYesShare {
		t.Errorf("Gate = %q, want %q -- the form field wins an exact tie", got[hhA].Gate, gateYesShare)
	}
	if got[hhA].SourceField != "FAM CAMP-Shared Cabin" {
		t.Errorf("SourceField = %q, want the form field on a tie", got[hhA].SourceField)
	}
}

// TestCollapseKeepsShareCommentsActive: spec 4.4 flags FAM CAMP-Share Comments
// as the field auto-inferred retirement would have dropped -- 0 values in 2023,
// 112 in 2024, 171 in 2025, 0 in 2026, and still live.
func TestCollapseKeepsShareCommentsActive(t *testing.T) {
	ts := time.Date(2025, 4, 21, 0, 0, 0, 0, time.UTC)
	values := []PersonRequestValue{
		{HouseholdKey: hhA, FieldName: "FAM CAMP-Share Comments",
			Value: "we bunk with them every Memorial Day", LastUpdated: ts},
	}
	got := CollapseToHouseholdGrain(values)
	if got[hhA] == nil || got[hhA].RequestText == "" {
		t.Fatal("FAM CAMP-Share Comments was dropped; spec 4.4 keeps it active")
	}
}

// TestCollapseSeparatesHouseholds: no cross-household bleed.
func TestCollapseSeparatesHouseholds(t *testing.T) {
	ts := time.Date(2025, 4, 21, 0, 0, 0, 0, time.UTC)
	values := []PersonRequestValue{
		{HouseholdKey: hhA, FieldName: "Shared-request", Value: "the Johnson family", LastUpdated: ts},
		{HouseholdKey: hhB, FieldName: "Shared-request", Value: "the Garcia family", LastUpdated: ts},
	}
	got := CollapseToHouseholdGrain(values)
	if len(got) != 2 {
		t.Fatalf("households = %d, want 2", len(got))
	}
	if got[hhA].RequestText != "the Johnson family" || got[hhB].RequestText != "the Garcia family" {
		t.Error("request text bled across households")
	}
}
