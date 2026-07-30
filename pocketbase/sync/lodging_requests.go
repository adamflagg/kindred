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

// NormalizeShareGate maps a raw gate answer onto the 3-state vocabulary.
//
// Order matters. Every option sentence contains "shar", and "No, we would prefer
// not to share" and "Maybe, I am open to sharing" both start with a word that
// decides the answer, so the leading token is what is tested -- not a substring
// search for "yes"/"no".
func NormalizeShareGate(raw string) string {
	lower := strings.ToLower(strings.TrimSpace(raw))
	switch {
	case lower == "":
		return ""
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
func ParseSharedCabinModes(raw string) (near, with bool) {
	for _, option := range strings.Split(raw, "|") {
		upper := strings.ToUpper(option)
		switch {
		case strings.Contains(upper, "NEAR"):
			near = true
		case strings.Contains(upper, "WITH"):
			with = true
		}
	}
	return near, with
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
	RequestText  string
	SourceField  string
	LastUpdated  time.Time
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
				near, with := ParseSharedCabinModes(value)
				a.req.WantsNear = a.req.WantsNear || near
				a.req.WantsWith = a.req.WantsWith || with
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
