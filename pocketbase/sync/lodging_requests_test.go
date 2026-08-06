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
// gate spec 4.3 defines. CampMinder stores each option in full, so the leading
// token is what decides the answer -- but a leading token alone is not enough,
// which is what the "No requests" case below exists to prove.
//
// The check order does NOT matter: the four prefixes are mutually exclusive on
// a trimmed string, so at most one arm can ever match. What matters is the
// sharing-sentence guard, because that is the only thing separating a gate
// answer from a mode option that happens to start with "No".
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
		// The modes field's own "no requests" option -- 269 rows in 2025. It
		// starts with "No " and is NOT a gate answer: it says the household
		// named no specific family, not that it refuses to share.
		"No requests": "",
	}
	for raw, want := range cases {
		if got := NormalizeShareGate(raw); got != want {
			t.Errorf("NormalizeShareGate(%.40q) = %q, want %q", raw, got, want)
		}
	}
}

// TestCollapseNoRequestsDoesNotVetoTheGate is the integration half of the case
// above, and the one that actually cost data: the modes field wins a timestamp
// tie and is normally edited later than the registration gate, so a bare "No
// requests" on it overwrote a genuine "Yes, I would like to share" with a hard
// decline. 269 of 2025's rows carry that exact value.
func TestCollapseNoRequestsDoesNotVetoTheGate(t *testing.T) {
	const yesShare = "Yes, I would like to share a large camper cabin with a family that I " +
		"request or with a family with similarly aged kid(s) that I can meet at Camp."
	registration := time.Date(2025, 1, 10, 0, 0, 0, 0, time.UTC)
	laterForm := time.Date(2025, 6, 2, 0, 0, 0, 0, time.UTC)

	for _, tc := range []struct {
		name   string
		formAt time.Time
	}{
		{"form is newer", laterForm},
		{"exact timestamp tie", registration},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := CollapseToHouseholdGrain([]PersonRequestValue{
				{HouseholdKey: hhA, FieldName: fieldShareCabinsRegistration,
					Value: yesShare, LastUpdated: registration},
				{HouseholdKey: hhA, FieldName: fieldSharedCabinForm,
					Value: "No requests", LastUpdated: tc.formAt},
			})
			if got[hhA].Gate != gateYesShare {
				t.Errorf("Gate = %q, want %q -- \"No requests\" is not a decline",
					got[hhA].Gate, gateYesShare)
			}
			if got[hhA].SourceField != fieldShareCabinsRegistration {
				t.Errorf("SourceField = %q, want the registration gate", got[hhA].SourceField)
			}
			if got[hhA].WantsNear || got[hhA].WantsWith {
				t.Error(`"No requests" must not set a mode either`)
			}
		})
	}
}

// TestCollapseSiblingDisagreementSurvivesANoRequestsSibling pins spec 4.2's
// household-grain collapse against silently losing a real request. The Family
// Camp information form is answered per child, and siblings sometimes
// disagree -- 11 households in 2025, 5 in 2026. One child's genuine "Share a
// cabin WITH" request must survive a sibling's "No requests": ORing the modes
// together, rather than last-wins or requiring agreement, is what makes most
// observed "No requests + real request" combinations exist at all (design
// doc §10).
func TestCollapseSiblingDisagreementSurvivesANoRequestsSibling(t *testing.T) {
	ts := time.Date(2025, 4, 21, 17, 51, 0, 0, time.UTC)
	const withNamed = "Share a cabin WITH a specific family that I know (please include names " +
		"below and ensure that the request is mutual)."

	// Emma Garcia named a family on her own form answer; her sibling Liam's
	// record carries the modes field's own no-preference option -- silence,
	// not a decline.
	got := CollapseToHouseholdGrain([]PersonRequestValue{
		{HouseholdKey: hhA, FieldName: fieldSharedCabinForm, Value: withNamed, LastUpdated: ts},
		{HouseholdKey: hhA, FieldName: fieldSharedCabinForm, Value: "No requests", LastUpdated: ts},
	})

	if !got[hhA].WantsWith {
		t.Error("WantsWith = false; a sibling's real request must survive another sibling's \"No requests\"")
	}
	if got[hhA].ShareEligibility != shareEligibilityNamed {
		t.Errorf("ShareEligibility = %q, want %q -- the real request must still resolve to a verdict",
			got[hhA].ShareEligibility, shareEligibilityNamed)
	}
}

// TestCollapseDoesNotStampUnrelatedFields: request_last_updated is the column
// spec 4.1 designates for resolving a form-vs-registration conflict, so it has
// to mean "when the request was last touched". applyHouseholdRequests feeds
// every person value in unfiltered, so a household that only answered an
// unrelated question was getting a fresh-looking request timestamp beside an
// empty gate and empty text.
func TestCollapseDoesNotStampUnrelatedFields(t *testing.T) {
	ts := time.Date(2025, 6, 2, 11, 0, 0, 0, time.UTC)

	got := CollapseToHouseholdGrain([]PersonRequestValue{
		{HouseholdKey: hhA, FieldName: "Family Camp-Trans ETA", Value: "3pm", LastUpdated: ts},
	})
	if req, ok := got[hhA]; ok && !req.LastUpdated.IsZero() {
		t.Errorf("LastUpdated = %v for a household with no request at all", req.LastUpdated)
	}

	// A real request in the same household still carries its own timestamp,
	// and an unrelated newer value must not advance it.
	requestAt := time.Date(2025, 4, 21, 0, 0, 0, 0, time.UTC)
	later := time.Date(2025, 9, 1, 0, 0, 0, 0, time.UTC)
	got = CollapseToHouseholdGrain([]PersonRequestValue{
		{HouseholdKey: hhB, FieldName: fieldSharedRequest,
			Value: "we bunk with them every year", LastUpdated: requestAt},
		{HouseholdKey: hhB, FieldName: "Family Camp-Trans ETA", Value: "3pm", LastUpdated: later},
	})
	if !got[hhB].LastUpdated.Equal(requestAt) {
		t.Errorf("LastUpdated = %v, want %v -- an unrelated field advanced the request stamp",
			got[hhB].LastUpdated, requestAt)
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
		raw                             string
		wantNear, wantWith, wantSimilar bool
	}{
		{near, true, false, false},
		{with, false, true, false},
		// The similarly-aged option is a REFINEMENT of WITH, not a third axis:
		// its sentence literally begins "Share a cabin WITH", so it is a
		// co-housing request whose partner is simply unnamed. It therefore sets
		// both -- anything consuming wants_with must still see this household.
		{withOpen, false, true, true},
		{none, false, false, false},
		{with + "|" + near, true, true, false},
		{near + "|" + none, true, false, false},
		{"", false, false, false},
		// One option naming both edge types. No observed 2025 option does this,
		// so it is a guard rather than a live case -- but the two needs are
		// independent for the same reason classifyCPAPAnswer's are, and an
		// ordered switch silently drops whichever loses.
		{"Share a cabin WITH or house my family NEAR a specific family", true, true, false},
		// CampMinder's live text is unhyphenated ("similarly aged kid(s)"), but
		// staff edit these sentences. Both spellings are accepted so a hyphen
		// added in CampMinder does not silently zero the flag.
		{"Share a cabin WITH a family with similarly-aged kids", false, true, true},
		// The invariant, isolated: no literal WITH anywhere in the sentence.
		// Every other similarly-aged case above also contains "WITH", so they
		// pass through the WITH substring match and prove nothing about
		// similarAges implying with. A staff rewrite to "w/" is all it takes
		// to reach this shape, and wants_similar_ages without wants_with is a
		// state five comments in this codebase declare impossible.
		{"Share a cabin w/ a family whose kids are similarly aged", false, true, true},
		// All three at once, across the pipe.
		{withOpen + "|" + near, true, true, true},
	}
	for _, tc := range cases {
		gotNear, gotWith, gotSimilar := ParseSharedCabinModes(tc.raw)
		if gotNear != tc.wantNear || gotWith != tc.wantWith || gotSimilar != tc.wantSimilar {
			t.Errorf("ParseSharedCabinModes(%.50q) = (%v, %v, %v), want (%v, %v, %v)",
				tc.raw, gotNear, gotWith, gotSimilar, tc.wantNear, tc.wantWith, tc.wantSimilar)
		}
	}
}

// TestCollapseCarriesSimilarAgesToHouseholdGrain: the open-invitation flag has
// to survive the person-to-household collapse like the other two modes, or the
// staff-matchable pool is empty on the board no matter what families answered.
func TestCollapseCarriesSimilarAgesToHouseholdGrain(t *testing.T) {
	ts := time.Date(2025, 4, 21, 17, 51, 0, 0, time.UTC)
	const withOpen = "Share a cabin WITH a family with similarly aged kid(s) that I can meet at " +
		"Camp (we will make this happen if we have others interested as well)."

	values := []PersonRequestValue{
		{HouseholdKey: hhA, FieldName: fieldSharedCabinForm, Value: withOpen, LastUpdated: ts},
	}

	got := CollapseToHouseholdGrain(values)
	if len(got) != 1 {
		t.Fatalf("collapsed to %d households, want 1", len(got))
	}
	if !got[hhA].WantsSimilarAges {
		t.Error("WantsSimilarAges = false; the open-invitation option was dropped by the collapse")
	}
	if !got[hhA].WantsWith {
		t.Error("WantsWith = false; the similarly-aged option is still a WITH request")
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

// TestDeriveShareEligibility pins the precedence rule staff stated on
// 2026-08-02: the Family Camp information form is authoritative, and the
// registration gate is consulted ONLY when the form's share question has no
// answer.
//
// Both directions of override are load-bearing and both were wrong before this
// existed. Measured on 2026 family-camp attendees:
//
//   - registration no_share + form WITH   -> shareable. 3 households the old
//     gate-only flag reported as a violation, each having named a partner.
//   - registration yes_share + form NEAR  -> NOT shareable. 12 households the
//     old flag was silent about, plus 39 more from maybe_mutual.
//
// The second direction is the dangerous one: it reads as permissive, so the
// board hands staff a clean card for a household that declined.
//
// Not answering is never consent. A household silent on BOTH forms is
// unknown -- which places as no-share but is a different fact from declining,
// exactly as partyAttention separates "unverified" from "unmet".
func TestDeriveShareEligibility(t *testing.T) {
	cases := []struct {
		name         string
		gate         string
		formAnswered bool
		wantsWith    bool
		similarAges  bool
		eligibility  string
		source       string
		conflict     bool
	}{
		// --- Form answered: the gate is IGNORED for the verdict. ---
		{"form open, gate silent", "", true, true, true, shareEligibilityOpen, shareSourceForm, false},
		{"form named, gate silent", "", true, true, false, shareEligibilityNamed, shareSourceForm, false},
		{"form declined, gate silent", "", true, false, false, shareEligibilityDeclined, shareSourceForm, false},

		// The 3 households: said no at registration, then named a partner.
		{"gate no_share overridden by form WITH", gateNoShare, true, true, false,
			shareEligibilityNamed, shareSourceForm, true},
		// The 12 households: said yes at registration, then declined on the form.
		{"gate yes_share overridden by form decline", gateYesShare, true, false, false,
			shareEligibilityDeclined, shareSourceForm, true},

		// maybe_mutual resolving into anything is the answer ARRIVING, not a
		// conflict. Counting it as one puts a third of respondents in the
		// review queue instead of 7.5%.
		{"maybe_mutual to declined is a refinement", gateMaybeMutual, true, false, false,
			shareEligibilityDeclined, shareSourceForm, false},
		{"maybe_mutual to open is a refinement", gateMaybeMutual, true, true, true,
			shareEligibilityOpen, shareSourceForm, false},
		// Agreement is never a conflict.
		{"gate yes_share agreeing with form", gateYesShare, true, true, true,
			shareEligibilityOpen, shareSourceForm, false},
		{"gate no_share agreeing with form", gateNoShare, true, false, false,
			shareEligibilityDeclined, shareSourceForm, false},

		// --- Form NOT answered: fall back to registration. ---
		{"fallback yes_share", gateYesShare, false, false, false,
			shareEligibilityOpen, shareSourceRegistration, false},
		{"fallback maybe_mutual", gateMaybeMutual, false, false, false,
			shareEligibilityNamed, shareSourceRegistration, false},
		{"fallback no_share", gateNoShare, false, false, false,
			shareEligibilityDeclined, shareSourceRegistration, false},
		{"silent on both forms", "", false, false, false,
			shareEligibilityUnknown, shareSourceNone, false},

		// A fallback can never conflict: there is only one answer to read.
		{"fallback never conflicts", gateNoShare, false, false, false,
			shareEligibilityDeclined, shareSourceRegistration, false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			gotEligibility, gotSource, gotConflict := DeriveShareEligibility(
				tc.gate, tc.formAnswered, tc.wantsWith, tc.similarAges, false)
			if gotEligibility != tc.eligibility {
				t.Errorf("eligibility = %q, want %q", gotEligibility, tc.eligibility)
			}
			if gotSource != tc.source {
				t.Errorf("source = %q, want %q", gotSource, tc.source)
			}
			if gotConflict != tc.conflict {
				t.Errorf("conflict = %v, want %v", gotConflict, tc.conflict)
			}
		})
	}
}

// TestDeriveShareEligibilityIgnoresNearOnly is the single biggest cohort and
// the easiest to get wrong: NEAR is proximity, not sharing. Its option text is
// "House my family NEAR a specific family" -- explicitly not in my cabin.
// 298 households across 2025-2026 selected NEAR alone, and reading it as a
// share request would make the largest group on the board look shareable.
//
// NEAR is a SEPARATE AXIS, so it is expressible alongside a real share request
// and must not suppress one either -- 29 households selected both.
func TestDeriveShareEligibilityIgnoresNearOnly(t *testing.T) {
	// NEAR alone reaches this function as "form answered, wants_with false".
	got, source, conflict := DeriveShareEligibility(gateMaybeMutual, true, false, false, false)
	if got != shareEligibilityDeclined {
		t.Errorf("NEAR-only eligibility = %q, want %q", got, shareEligibilityDeclined)
	}
	if source != shareSourceForm {
		t.Errorf("NEAR-only source = %q, want %q", source, shareSourceForm)
	}
	if conflict {
		t.Error("NEAR-only after maybe_mutual is a refinement, not a conflict")
	}

	// WITH + NEAR together: the share request survives the proximity request.
	got, _, _ = DeriveShareEligibility("", true, true, false, false)
	if got != shareEligibilityNamed {
		t.Errorf("WITH+NEAR eligibility = %q, want %q", got, shareEligibilityNamed)
	}
}

// TestCollapseCarriesShareEligibility proves the derivation reaches the
// household-grain result the surfaces read, rather than being a loose helper
// nothing calls. formAnswered is the presence of the modes field, which is
// what separates "declined" from "never answered".
func TestCollapseCarriesShareEligibility(t *testing.T) {
	const withNamed = "Share a cabin WITH a specific family that I know (please include names " +
		"below and ensure that the request is mutual)."
	const noShare = "No, we would prefer not to share a camper cabin."
	now := time.Now()

	out := CollapseToHouseholdGrain([]PersonRequestValue{
		{HouseholdKey: hhA, FieldName: fieldShareCabinsRegistration, Value: noShare, LastUpdated: now},
		{HouseholdKey: hhA, FieldName: fieldSharedCabinForm, Value: withNamed, LastUpdated: now},
		// hhB answered registration only -- the fallback path.
		{HouseholdKey: hhB, FieldName: fieldShareCabinsRegistration, Value: noShare, LastUpdated: now},
	})

	a := out[hhA]
	if a == nil {
		t.Fatal("household A missing from collapse")
	}
	if a.ShareEligibility != shareEligibilityNamed {
		t.Errorf("A eligibility = %q, want %q", a.ShareEligibility, shareEligibilityNamed)
	}
	if a.ShareEligibilitySource != shareSourceForm {
		t.Errorf("A source = %q, want %q", a.ShareEligibilitySource, shareSourceForm)
	}
	if !a.ShareAnswersConflict {
		t.Error("A said no at registration then named a partner: that is a recorded conflict")
	}

	b := out[hhB]
	if b == nil {
		t.Fatal("household B missing from collapse")
	}
	if b.ShareEligibility != shareEligibilityDeclined {
		t.Errorf("B eligibility = %q, want %q", b.ShareEligibility, shareEligibilityDeclined)
	}
	if b.ShareEligibilitySource != shareSourceRegistration {
		t.Errorf("B source = %q, want %q", b.ShareEligibilitySource, shareSourceRegistration)
	}
	if b.ShareAnswersConflict {
		t.Error("B has only one answer, so it cannot conflict with anything")
	}
}

// TestNormalizeShareEligibilityGivesUnknownOneSpelling closes a latent filter
// bug found by running the real sync rather than by reading the code.
//
// A household with NO request-field values at all never gets a bucket in
// CollapseToHouseholdGrain, so its derived fields stay at Go's zero value and
// the column stores "" instead of "unknown" -- two spellings of one state.
// Measured on 2026 after a real family_camp_derived run: 35 rows "" against 2
// rows "unknown", so `WHERE share_eligibility = 'unknown'` would silently miss
// 35 households. Every consumer already reads "" as unknown, which is exactly
// what makes this latent rather than visible -- the same shape as kindred#1921.
func TestNormalizeShareEligibilityGivesUnknownOneSpelling(t *testing.T) {
	eligibility, source := NormalizeShareEligibility("", "")
	if eligibility != shareEligibilityUnknown || source != shareSourceNone {
		t.Errorf("unwritten verdict = (%q, %q), want (%q, %q)",
			eligibility, source, shareEligibilityUnknown, shareSourceNone)
	}

	// A real verdict passes through untouched, source included.
	for _, tc := range []struct{ eligibility, source string }{
		{shareEligibilityOpen, shareSourceForm},
		{shareEligibilityNamed, shareSourceRegistration},
		{shareEligibilityDeclined, shareSourceForm},
		{shareEligibilityUnknown, shareSourceNone},
	} {
		gotEligibility, gotSource := NormalizeShareEligibility(tc.eligibility, tc.source)
		if gotEligibility != tc.eligibility || gotSource != tc.source {
			t.Errorf("NormalizeShareEligibility(%q, %q) = (%q, %q), want unchanged",
				tc.eligibility, tc.source, gotEligibility, gotSource)
		}
	}
}

// TestDeriveShareEligibilityConflictTracksTheVerdict keys the conflict flag off
// the VERDICT rather than off wantsWith directly.
//
// Both spellings agree today, because ParseSharedCabinModes guarantees
// similarAges implies with. But DeriveShareEligibility is exported and takes
// the two booleans independently, so nothing here enforces that invariant --
// and the invariant lives in a different function whose own comment says it
// exists precisely because staff reword these option sentences.
//
// The failure mode if it ever broke is the PERMISSIVE one: a gate of no_share
// against a form answer of open would report conflict=false, hiding exactly
// the disagreement staff need to see.
func TestDeriveShareEligibilityConflictTracksTheVerdict(t *testing.T) {
	// similarAges WITHOUT with -- the state ParseSharedCabinModes prevents.
	// Reached directly, the verdict is open, so a no_share gate conflicts.
	_, _, conflict := DeriveShareEligibility(gateNoShare, true, false, true, false)
	if !conflict {
		t.Error("no_share gate against an open verdict is a conflict, whatever wantsWith says")
	}

	// And the mirror: a yes_share gate against an open verdict is agreement.
	_, _, conflict = DeriveShareEligibility(gateYesShare, true, false, true, false)
	if conflict {
		t.Error("yes_share gate against an open verdict agrees")
	}
}

// TestDeriveShareEligibilityFallbackFailsSafeOnASiblingDecline stops the
// registration fallback resolving to a MORE permissive verdict than one of the
// household's own answers.
//
// The request fields are person-partition, so siblings can disagree, and
// winsGate resolves the gate by newest-wins with no fail-safe direction.
// Measured on 2026: 30 households have disagreeing sibling gates, 6 have a
// newest yes_share over a sibling no_share, and 4 of those have no form answer
// -- so they would fall back to `open`, off a recorded no_share.
//
// Same fail-safe shape the household blocker uses for opt_out_vip: a decline
// anywhere in the household outranks a later permissive answer. Deliberately
// scoped to the FALLBACK only -- when the authoritative form answered, it wins,
// which is the whole precedence rule.
func TestDeriveShareEligibilityFallbackFailsSafeOnASiblingDecline(t *testing.T) {
	for _, gate := range []string{gateYesShare, gateMaybeMutual} {
		eligibility, source, conflict := DeriveShareEligibility(gate, false, false, false, true)
		if eligibility != shareEligibilityDeclined {
			t.Errorf("gate %q with a declining sibling = %q, want %q",
				gate, eligibility, shareEligibilityDeclined)
		}
		if source != shareSourceRegistration {
			t.Errorf("gate %q: source = %q, want %q", gate, source, shareSourceRegistration)
		}
		if conflict {
			t.Errorf("gate %q: a fallback reads one form, so it cannot conflict", gate)
		}
	}

	// The form still wins. A declining sibling does NOT override an answered
	// form -- that would invert the precedence rule.
	eligibility, source, _ := DeriveShareEligibility(gateNoShare, true, true, false, true)
	if eligibility != shareEligibilityNamed || source != shareSourceForm {
		t.Errorf("form answer = (%q, %q), want (%q, %q) -- the form outranks a sibling gate",
			eligibility, source, shareEligibilityNamed, shareSourceForm)
	}
}

// TestCollapseCarriesASiblingDeclineIntoTheFallback proves the signal above is
// actually computed from the household's values rather than being a parameter
// nothing supplies.
func TestCollapseCarriesASiblingDeclineIntoTheFallback(t *testing.T) {
	const noShare = "No, we would prefer not to share a camper cabin."
	const yesShare = "Yes, I would like to share a large camper cabin with a family that I " +
		"request or with a family with similarly aged kid(s) that I can meet at Camp."
	older := time.Now().Add(-time.Hour)
	newer := time.Now()

	// One child declined; a later sibling answer says yes. Newest wins the
	// GATE, but the verdict must not become shareable off that.
	out := CollapseToHouseholdGrain([]PersonRequestValue{
		{HouseholdKey: hhA, FieldName: fieldShareCabinsRegistration, Value: noShare, LastUpdated: older},
		{HouseholdKey: hhA, FieldName: fieldShareCabinsRegistration, Value: yesShare, LastUpdated: newer},
	})

	a := out[hhA]
	if a == nil {
		t.Fatal("household A missing from collapse")
	}
	if a.Gate != gateYesShare {
		t.Errorf("gate = %q, want %q -- winsGate is unchanged by this", a.Gate, gateYesShare)
	}
	if a.ShareEligibility != shareEligibilityDeclined {
		t.Errorf("eligibility = %q, want %q -- a recorded decline outranks a later yes in the fallback",
			a.ShareEligibility, shareEligibilityDeclined)
	}
}
