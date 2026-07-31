package sync

import (
	"strings"
	"time"
)

// The normalised 3-state share gate (spec 4.3). CampMinder stores the full
// option sentence; these are what the four observed sentences collapse onto.
//
//	no_share     -> hard no-share
//	maybe_mutual -> honor ONLY a mutual match
//	yes_share    -> eligible for staff pairing
const (
	gateNoShare     = "no_share"
	gateMaybeMutual = "maybe_mutual"
	gateYesShare    = "yes_share"
)

// Source field display names, used for precedence and provenance. Matching is on
// cm_id upstream (spec 4.4); these labels only travel with the values.
const (
	fieldShareCabinsRegistration = "FAM CAMP-Share Cabins"   // registration gate
	fieldSharedCabinForm         = "FAM CAMP-Shared Cabin"   // form modes -- wins on a tie
	fieldSharedRequest           = "Shared-request"          // free text
	fieldShareComments           = "FAM CAMP-Share Comments" // free text, still live
	fieldCovidBunkingRequests    = "COVID-19 Bunking Requests"
)

// Housing and accessibility source fields, paired with their cm_ids in
// lodgingRequestFields. Constants rather than literals because the registry and
// family_camp_derived.go's switch must compare against the SAME string: the
// registry resolves a renamed field back to this name, and a switch case that
// drifted from it would silently stop matching.
const (
	fieldFamCampBathroom  = "FAM CAMP-bathroom"
	fieldAdultBathroom    = "Adult-Bathroom"
	fieldFamCampCPAP      = "FAM CAMP-CPAP"
	fieldFamilyCampCPAP   = "Family Camp-CPAP"
	fieldAdultCPAP        = "Adult-CPAP"
	fieldAdultInfant      = "Adult-Infant"
	fieldFamCampOptOutVIP = "FAM CAMP-Opt Out VIP"
	fieldAdultOptOut      = "Adult-Opt Out"
)

// NormalizeShareGate maps a raw gate answer onto the 3-state vocabulary.
//
// Two things decide the answer, and BOTH are required.
//
// The leading token carries the polarity: CampMinder stores each option
// sentence in full, and every one of them contains "shar", so a substring search
// for "yes"/"no" would match the wrong half of "No, we would prefer not to
// share". (The four prefix arms are mutually exclusive on a trimmed string, so
// their order is not load-bearing -- an earlier version of this comment claimed
// it was.)
//
// The sentence must also be ABOUT sharing a cabin, which is what the "shar"
// guard below tests. Without it "No requests" -- the modes field's own
// no-preference option, 269 rows in 2025 -- matches the "no " prefix and reads
// as a hard decline. Because that field wins a timestamp tie and is normally
// edited later than the registration gate, it then overwrote a genuine "Yes, I
// would like to share" with no_share, and the household lost its eligibility for
// staff pairing without anybody touching the gate question.
//
// Every real gate option says "share"/"sharing"; no NEAR/WITH mode option that
// begins with a polarity token does. That asymmetry is the discriminator.
func NormalizeShareGate(raw string) string {
	lower := strings.ToLower(strings.TrimSpace(raw))
	if lower == "" || !strings.Contains(lower, "shar") {
		return ""
	}
	switch {
	case strings.HasPrefix(lower, "no,"), strings.HasPrefix(lower, "no "):
		return gateNoShare
	case strings.HasPrefix(lower, "maybe"):
		return gateMaybeMutual
	case strings.HasPrefix(lower, "yes,"), strings.HasPrefix(lower, "yes "):
		return gateYesShare
	}
	return ""
}

// ParseSharedCabinModes reads the pipe-delimited multi-select "FAM CAMP-Shared
// Cabin" into the two edge types spec 4.3 distinguishes: NEAR is proximity,
// satisfied by map distance between assigned units; WITH is co-housing,
// satisfied by sharing a slot. 24 households ask for both.
//
// "No requests" is NOT a veto: it co-occurs with a real request in six observed
// rows, so each option is read independently and a real one wins.
// The three modes are tested INDEPENDENTLY, not as ordered switch arms, for the
// same reason classifyCPAPAnswer's power and bathroom needs are: an option
// naming more than one would otherwise set only whichever arm came first.
//
// similarAges is a REFINEMENT of with, not a third axis. Its option sentence
// begins "Share a cabin WITH", so it is a co-housing request too -- what differs
// is that the partner is unnamed, which makes these the households staff can
// pair with each other. It therefore sets BOTH flags, and anything reading
// wants_with alone still sees the household. Observed on 22 households across
// 2025-2026.
func ParseSharedCabinModes(raw string) (near, with, similarAges bool) {
	for _, option := range strings.Split(raw, "|") {
		upper := strings.ToUpper(option)
		near = near || strings.Contains(upper, "NEAR")
		with = with || strings.Contains(upper, "WITH")
		// CampMinder's live text is unhyphenated; the hyphenated spelling is
		// accepted so a staff edit in CampMinder cannot silently zero the flag.
		optionHasSimilarAges := strings.Contains(upper, "SIMILARLY AGED") ||
			strings.Contains(upper, "SIMILARLY-AGED")
		similarAges = similarAges || optionHasSimilarAges
		// Set explicitly rather than leaning on the WITH match above. The live
		// sentence does contain "WITH", so this is redundant today -- but the
		// hyphen guard on the line above exists precisely because staff edit
		// these sentences, and an edit to "w/" would otherwise produce
		// wants_similar_ages without wants_with: a state this function's
		// doc comment, HouseholdRequest, family_camp_derived.go, migration
		// 1500000127 and the Python schema all declare impossible.
		with = with || optionHasSimilarAges
	}
	return near, with, similarAges
}

// PersonRequestValue is one person-partition request value, already carrying the
// household it belongs to.
type PersonRequestValue struct {
	// HouseholdKey identifies the household. Callers inside family_camp_derived
	// pass the households PB record id, since that is what its value rows carry;
	// callers working in CampMinder ids pass strconv.Itoa(householdCMID). The
	// collapse only needs the key to be stable and unique per household.
	HouseholdKey string
	FieldName    string
	Value        string
	LastUpdated  time.Time
}

// HouseholdRequest is the collapsed, household-grain result.
type HouseholdRequest struct {
	HouseholdKey string
	Gate         string
	WantsNear    bool
	WantsWith    bool
	// WantsSimilarAges implies WantsWith -- see ParseSharedCabinModes.
	WantsSimilarAges bool
	RequestText      string
	SourceField      string
	LastUpdated      time.Time
}

// CollapseToHouseholdGrain implements spec 4.2, which is mandatory: the request
// fields are person-partition, so a household with two enrolled children stores
// the SAME text twice (observed at n=2 and n=3). Collapsing before resolution is
// the only thing standing between the request layer and double-counting every
// request.
//
// Deduplication is on normalised text, so two children carrying one parent's
// answer collapse to one, while two genuinely different answers both survive --
// dropping one of those would lose a real request.
//
// The gate follows spec 4.1: the most recent answer wins by last_updated, with
// the form field breaking a tie. Comparing timestamps rather than trusting field
// precedence is explicit in the spec.
func CollapseToHouseholdGrain(values []PersonRequestValue) map[string]*HouseholdRequest {
	type accumulator struct {
		req       *HouseholdRequest
		seenText  map[string]bool
		textParts []string
		gateAt    time.Time
		gateField string
	}

	byHousehold := make(map[string]*accumulator)
	get := func(hh string) *accumulator {
		if a, ok := byHousehold[hh]; ok {
			return a
		}
		a := &accumulator{
			req:      &HouseholdRequest{HouseholdKey: hh},
			seenText: make(map[string]bool),
		}
		byHousehold[hh] = a
		return a
	}

	for _, v := range values {
		value := strings.TrimSpace(v.Value)
		if value == "" {
			continue
		}

		// The household bucket and the LastUpdated bump used to happen here,
		// before the switch below narrowed to request fields. Callers pass ALL
		// of a household's person values in, so an ETA or a bathroom answer
		// created a bucket and stamped request_last_updated -- leaving a
		// freshly-touched request timestamp beside an empty gate and empty text.
		// That column is what spec 4.1 resolves precedence with, so it has to
		// mean "when the request changed" and nothing else.
		if !isRequestField(v.FieldName) {
			continue
		}
		a := get(v.HouseholdKey)
		if v.LastUpdated.After(a.req.LastUpdated) {
			a.req.LastUpdated = v.LastUpdated
		}

		switch v.FieldName {
		case fieldShareCabinsRegistration, fieldSharedCabinForm:
			if gate := NormalizeShareGate(value); gate != "" && winsGate(a.gateAt, a.gateField, v) {
				a.req.Gate = gate
				a.gateAt = v.LastUpdated
				a.gateField = v.FieldName
				a.req.SourceField = v.FieldName
			}
			if v.FieldName == fieldSharedCabinForm {
				near, with, similarAges := ParseSharedCabinModes(value)
				a.req.WantsNear = a.req.WantsNear || near
				a.req.WantsWith = a.req.WantsWith || with
				a.req.WantsSimilarAges = a.req.WantsSimilarAges || similarAges
				if a.req.SourceField == "" {
					a.req.SourceField = v.FieldName
				}
			}
		case fieldSharedRequest, fieldShareComments, fieldCovidBunkingRequests:
			key := strings.ToLower(value)
			if a.seenText[key] {
				continue // the same parent answer written onto a second child
			}
			a.seenText[key] = true
			a.textParts = append(a.textParts, value)
		}
	}

	out := make(map[string]*HouseholdRequest, len(byHousehold))
	for hh, a := range byHousehold {
		a.req.RequestText = strings.Join(a.textParts, "; ")
		out[hh] = a.req
	}
	return out
}

// isRequestField reports whether a field name is one the collapse reads. It
// deliberately mirrors the switch in CollapseToHouseholdGrain: the two must
// agree, or a field is either stamped without being read or read without being
// stamped.
func isRequestField(name string) bool {
	switch name {
	case fieldShareCabinsRegistration, fieldSharedCabinForm,
		fieldSharedRequest, fieldShareComments, fieldCovidBunkingRequests:
		return true
	}
	return false
}

// winsGate decides whether an incoming gate answer replaces the stored one.
// Newer always wins; on an exact tie the form field does, which is the only
// place the field name matters at all (spec 4.1).
func winsGate(currentAt time.Time, currentField string, incoming PersonRequestValue) bool {
	if currentField == "" {
		return true
	}
	if incoming.LastUpdated.After(currentAt) {
		return true
	}
	if incoming.LastUpdated.Equal(currentAt) {
		return incoming.FieldName == fieldSharedCabinForm && currentField != fieldSharedCabinForm
	}
	return false
}
