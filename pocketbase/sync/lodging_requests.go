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

// Share ELIGIBILITY is the question the board actually asks -- "may these two
// parties be in one cabin" -- and it is NOT the gate above.
//
// The gate is the REGISTRATION answer. Staff treat the later Family Camp
// information form as authoritative (stated 2026-08-02), so the gate is a
// fallback consulted only when that form's share question has no answer. See
// DeriveShareEligibility.
const (
	shareEligibilityOpen     = "open"     // staff may match with any other open party
	shareEligibilityNamed    = "named"    // only with the named partner, if mutual
	shareEligibilityDeclined = "declined" // answered; do not share
	shareEligibilityUnknown  = "unknown"  // silent on BOTH forms; never consent

	shareSourceForm         = "form"         // the Family Camp information form answered
	shareSourceRegistration = "registration" // provisional: fell back to the gate
	shareSourceNone         = "none"         // nothing to read
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
// pair with each other. It therefore sets the with superset, and anything
// reading with alone still sees the household. Observed on 22 households
// across 2025-2026.
//
// withNamed records the named-family option SPECIFICALLY -- for the board's
// per-tick icons (owner ruling 2026-08-22: the checkbox ticks are stored as
// truly separate answers) -- and is NOT consulted by DeriveShareEligibility,
// which reads the with superset instead. The similarly-aged option does not
// set it: that option names no partner.
func ParseSharedCabinModes(raw string) (near, with, withNamed, similarAges bool) {
	for _, option := range strings.Split(raw, "|") {
		upper := strings.ToUpper(option)
		near = near || strings.Contains(upper, "NEAR")
		with = with || strings.Contains(upper, "WITH")
		// The named option is the only one carrying both words: NEAR has
		// "specific" without "WITH"; the similar option has "WITH" without
		// "specific".
		withNamed = withNamed || (strings.Contains(upper, "WITH") &&
			strings.Contains(upper, "SPECIFIC"))
		// CampMinder's live text is unhyphenated; the hyphenated spelling is
		// accepted so a staff edit in CampMinder cannot silently zero the flag.
		optionHasSimilarAges := strings.Contains(upper, "SIMILARLY AGED") ||
			strings.Contains(upper, "SIMILARLY-AGED")
		similarAges = similarAges || optionHasSimilarAges
		// Set explicitly rather than leaning on the WITH match above. The live
		// sentence does contain "WITH", so this is redundant today -- but the
		// hyphen guard on the line above exists precisely because staff edit
		// these sentences, and an edit to "w/" would otherwise produce
		// wants_similar_ages without the with superset: a state this
		// function's doc comment, HouseholdRequest, family_camp_derived.go,
		// migration 1500000127 and the Python schema all declare impossible.
		with = with || optionHasSimilarAges
	}
	return near, with, withNamed, similarAges
}

// DeriveShareEligibility resolves the two share questions into the one verdict
// the board places on, plus where it came from.
//
// PRECEDENCE, staff-stated 2026-08-02: the Family Camp information form wins.
// The registration gate is a coarse early filter -- it even told families so in
// 2024, in an option sentence reading "you will have an opportunity to request
// specific families closer to the start of the program" -- and it is consulted
// ONLY when the form's share question has no answer.
//
// formAnswered is the PRESENCE of a "FAM CAMP-Shared Cabin" value, not whether
// that value asked for anything. It is what separates "declined" from "never
// answered", and it matters: the form is returned by 88% of households but its
// share question is skipped by roughly half of them, so an absent answer is
// usually a skipped question rather than a missing form.
//
// Only WITH options make a party shareable. NEAR is a SEPARATE AXIS -- its
// option text is "House my family NEAR a specific family", explicitly not in my
// cabin -- and it reaches this function as wantsWith=false. 298 households
// across 2025-2026 selected NEAR alone, so reading it as consent would make the
// largest cohort on the board look shareable.
//
// anySiblingDeclined reports whether ANY of the household's person-partition
// gate answers normalised to no_share, regardless of which one winsGate
// picked as the recency winner -- a UNION signal across every sibling, not
// the single winning gate. It feeds the FALLBACK fail-safe below.
//
// This used to take a symmetric anySiblingYesShare parameter too, feeding an
// answers-disagree conflict flag this function computed and returned as a
// third value. That flag is retired (owner ruling 2026-08-23, "it is dead
// all the way down" -- eligibility never read it, only stored it), and the
// parameter went with it: CollapseToHouseholdGrain's matching sawYesGate
// tracking is gone too, rather than left computing a union nothing reads.
func DeriveShareEligibility(
	gate string, formAnswered, wantsWith, wantsSimilarAges, anySiblingDeclined bool,
) (eligibility, source string) {
	if formAnswered {
		switch {
		case wantsSimilarAges:
			// Open SUPERSETS named: a household that will take a staff match
			// is not narrowed by also having named someone.
			eligibility = shareEligibilityOpen
		case wantsWith:
			eligibility = shareEligibilityNamed
		default:
			eligibility = shareEligibilityDeclined
		}
		return eligibility, shareSourceForm
	}

	// FALLBACK.
	//
	// A recorded decline anywhere in the household outranks a later permissive
	// sibling answer. winsGate resolves the gate by newest-wins with no
	// fail-safe direction, which is right for a display column and wrong for a
	// consent verdict: measured on 2026, 4 households would otherwise fall back
	// to `open` off a sibling's recorded no_share. Same fail-safe shape as
	// accommodation_is_mandatory's blocker-wins OR in family_camp_derived.
	//
	// Deliberately NOT applied when the form answered -- the form is
	// authoritative, and letting an old sibling gate override it would invert
	// the whole precedence rule.
	if anySiblingDeclined {
		return shareEligibilityDeclined, shareSourceRegistration
	}

	switch gate {
	case gateYesShare:
		return shareEligibilityOpen, shareSourceRegistration
	case gateMaybeMutual:
		// "Maybe, I am open to sharing ... if a specific family that I know
		// wants to" is consent to a NAMED partner, never to a staff match. It
		// arrives with no names attached, so these are eligible in principle
		// and unmatchable in practice until somebody else names them.
		return shareEligibilityNamed, shareSourceRegistration
	case gateNoShare:
		return shareEligibilityDeclined, shareSourceRegistration
	}
	return shareEligibilityUnknown, shareSourceNone
}

// NormalizeShareEligibility gives an unwritten verdict its explicit spelling.
//
// A household with NO request-field values at all never gets a bucket in
// CollapseToHouseholdGrain, so its derived fields keep Go's zero value and the
// column would store "" rather than "unknown" -- two spellings of one state.
// Measured on 2026 after a real family_camp_derived run: 35 rows "" against 2
// rows "unknown", so `WHERE share_eligibility = 'unknown'` would silently miss
// 35 households.
//
// Every consumer already reads "" as unknown, which is precisely what makes
// this latent rather than visible: the column looks fine until somebody
// filters on it. Same shape as kindred#1921.
func NormalizeShareEligibility(eligibility, source string) (normalizedEligibility, normalizedSource string) {
	if eligibility == "" {
		return shareEligibilityUnknown, shareSourceNone
	}
	return eligibility, source
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
	// WantsWithNamed is the named-family tick ALONE, for the board's per-tick
	// icons -- owner ruling 2026-08-22 split the OR-collapsed wants_with
	// column into truly separate stored answers. The eligibility superset
	// (named OR similar-ages) is derived at the point DeriveShareEligibility
	// is called below, not stored here.
	WantsWithNamed bool
	// WantsSimilarAges does NOT imply WantsWithNamed -- see
	// ParseSharedCabinModes. It still implies the WITH superset.
	WantsSimilarAges bool
	RequestText      string
	SourceField      string
	LastUpdated      time.Time

	// The board's verdict and its provenance -- see DeriveShareEligibility.
	// ShareEligibility is what placement reads; Gate above stays the raw
	// registration answer, kept because it is what a staff member sees when
	// asked why a household is flagged.
	ShareEligibility       string
	ShareEligibilitySource string
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
		// Whether the Family Camp form's share question was answered AT ALL,
		// independent of what it asked for. "No requests" is an answer;
		// silence is not. This is the only thing separating declined from
		// unknown, so it tracks value PRESENCE, not parsed modes.
		formAnswered bool
		// Whether ANY sibling's gate answer normalised to no_share, regardless
		// of which one winsGate picked. DeriveShareEligibility's FALLBACK path
		// fails safe on this -- see that function.
		sawDeclineGate bool
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
			gate := NormalizeShareGate(value)
			// Recorded BEFORE winsGate picks a winner: a decline that loses
			// on recency is still an answer the household stated.
			if gate == gateNoShare {
				a.sawDeclineGate = true
			}
			if gate != "" && winsGate(a.gateAt, a.gateField, v) {
				a.req.Gate = gate
				a.gateAt = v.LastUpdated
				a.gateField = v.FieldName
				a.req.SourceField = v.FieldName
			}
			if v.FieldName == fieldSharedCabinForm {
				a.formAnswered = true
				near, _, withNamed, similarAges := ParseSharedCabinModes(value)
				// Only the un-ORed ticks are stored -- the with superset is
				// re-derived below, at the eligibility call, from
				// WantsWithNamed || WantsSimilarAges.
				a.req.WantsNear = a.req.WantsNear || near
				a.req.WantsWithNamed = a.req.WantsWithNamed || withNamed
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
		// Derived last, because it reads the collapsed modes: the form fields
		// are person-partition, and siblings DO disagree (11 households in
		// 2025, 5 in 2026). ParseSharedCabinModes ORs them, so one child's
		// real request survives another's "No requests" -- which is the
		// correct reading and the reason most such combinations exist.
		//
		// wants_with is no longer stored; the eligibility superset is
		// derived here from WantsWithNamed || WantsSimilarAges rather than
		// from ParseSharedCabinModes' own bare `with` return. On every
		// option sentence that exists in 2025/2026 data the two are equal,
		// so the truth table is unchanged in practice: similar -> open
		// before with is consulted, named -> named, neither -> declined.
		//
		// That equality is a fact about the live vocabulary, not a
		// structural guarantee -- it is an accepted narrowing. withNamed
		// requires BOTH "WITH" and "SPECIFIC" (see ParseSharedCabinModes
		// above); the bare `with` this replaced required only "WITH". A
		// hypothetically reworded named option that kept "WITH" but
		// dropped "specific" would have parsed to eligibility named before
		// this change, and parses to declined now. Same hazard class as
		// the hyphen guard on similarAges above and NormalizeShareGate's
		// "shar" guard -- staff reword these option sentences -- but this
		// one is accepted rather than defended against.
		// TestParseSharedCabinModesNamedWith pins the trade.
		a.req.ShareEligibility, a.req.ShareEligibilitySource =
			DeriveShareEligibility(
				a.req.Gate, a.formAnswered, a.req.WantsWithNamed || a.req.WantsSimilarAges,
				a.req.WantsSimilarAges, a.sawDeclineGate)
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
