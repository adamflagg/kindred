package sync

import (
	"slices"
	"sort"
	"strconv"
	"strings"
	"testing"
	"time"
)

// The fan-out guard for the family-camp field map (kindred#2569).
//
// WHY THIS TEST EXISTS. The registry reads many-sources-to-one-target on every
// row, which is the safe direction. The dangerous direction is one CampMinder
// answer reaching two stored columns, and it has produced a defect twice --
// `opt_out_vip` held the Yes pole of an answer whose No pole was already in
// `accommodation_is_mandatory` (migration 1500000169), and
// `share_answers_conflict` was computed and stored beside a verdict nothing
// read it with (1500000174). Both were found by hand, months apart, because
// `Target string` could not say a field wrote two columns and so a reader
// auditing the registry counted one per row and concluded there were none.
//
// `Targets []string` makes the fan-out sayable. This test makes it CHECKED:
// drive the real transform with a real option sentence and fail on any column
// it writes that the registry does not declare. A future arm that quietly
// starts writing a second column goes red here rather than surviving to a drop
// migration.
//
// The under-claim direction is the one asserted. A declared target a probe does
// not happen to reach is not a defect -- these fields are multi-option selects
// and no single sentence exercises every column -- but a column written under
// no declaration is exactly the shape both migrations dropped.

// requestFieldProbes is one or more REAL CampMinder option sentences per
// registered request field, keyed by the registry's canonical name.
//
// The sentences matter and paraphrase is not safe: every one of these fields is
// routed by option TEXT rather than by a boolean (`classifyCPAPAnswer` keys on
// "outlet" and "bathroom", `NormalizeShareGate` requires the sentence to mention
// sharing, `ParseSharedCabinModes` on NEAR/WITH/SPECIFIC), so an invented value
// would exercise a path the live data never takes.
//
// Several fields need MORE THAN ONE probe, because different options reach
// different columns -- the whole reason a single declared target was never
// enough. "FAM CAMP-Shared Cabin" is the clearest: its mode sentences write the
// NEAR/WITH ticks, and its gate-shaped sentences write share_cabin_gate, which
// it can win outright on a timestamp tie against the registration field whose
// primary target that column is.
var requestFieldProbes = map[string][]string{
	fieldShareCabinsRegistration: {
		"Yes, I would like to share a large camper cabin with a family that I request or " +
			"with a family with similarly aged kid(s) that I can meet at Camp.",
		"No, we would prefer not to share a camper cabin.",
		"Maybe, I am open to sharing a large camper cabin if a specific family that I know wants to.",
	},
	fieldSharedCabinForm: {
		"Share a cabin WITH a specific family that I know (please include names below " +
			"and ensure that the request is mutual).",
		"House my family NEAR a specific family that I know.",
		"Share a cabin with a family with similarly aged kid(s) that I can meet at Camp.",
		"No requests",
	},
	fieldSharedRequest:        {"We would love to be near the Garcia family."},
	fieldShareComments:        {"Please keep us close to the dining hall."},
	fieldCovidBunkingRequests: {"Anywhere with a short walk is fine."},

	fieldFamCampBathroom: {"Yes", "No"},
	fieldAdultBathroom:   {"Yes", "No"},

	fieldFamCampCPAP: {
		"Yes",
		"Yes, outlet needed for CPAP machine",
		"Yes, bathroom or other housing accommodation for a medical (not CPAP related) " +
			"or accessibility-related reason needed",
		"No",
	},
	fieldFamilyCampCPAP: {"Yes", "Yes, outlet needed for CPAP machine", "No"},
	fieldAdultCPAP: {
		"Yes",
		"Yes, outlet needed for CPAP machine",
		"Yes, bathroom or other housing accommodation for a medical (not CPAP related) " +
			"or accessibility-related reason needed",
		"No",
	},

	fieldAdultInfant: {"Yes", "No", "I'm attending Men's Weekend"},

	fieldFamCampOptOutVIP: {
		"Yes, please register regardless of cabin type",
		"No, I am only able to attend with this accommodation",
	},
	fieldAdultOptOut: {
		"Yes, please register regardless of cabin type",
		"No, I am only able to attend with this accommodation",
	},

	// The assignment lane. Staff type these by hand into CampMinder, so the
	// probe is a plausible free-text cabin name rather than an option sentence.
	fieldNameFamilyCampCabin:           {"Pine Cabin"},
	fieldNameReportableFamilyCampCabin: {"Pine Cabin"},
}

// registrationColumns is every family_camp_registrations column the derived
// sync writes for one household, in the NORMALISED form it is written in.
//
// Normalised rather than raw struct fields on purpose: `share_eligibility` is
// "" on the struct and "unknown" in the column for a household that never
// reached the collapse (NormalizeShareEligibility), so a raw-field diff would
// report a write for every request field that merely creates a bucket. The
// column is what a reader of the table sees, and the column is what this
// compares.
//
// It mirrors setRegistrationRequestFields plus the six columns upsertRegistrations
// writes directly. Keeping the two in step is what TestRegistrationColumnsCoverEveryWrittenColumn
// below is for.
func registrationColumns(reg *registrationData) map[string]string {
	eligibility, eligibilitySource := NormalizeShareEligibility(
		reg.shareEligibility, reg.shareEligibilitySource)
	return map[string]string{
		"cabin_assignment":           reg.cabinAssignment,
		"share_cabin_preference":     reg.shareCabinPreference,
		"shared_cabin_modes_raw":     reg.sharedCabinModesRaw,
		"arrival_eta":                reg.arrivalETA,
		"special_occasions":          reg.specialOccasions,
		"goals":                      reg.goals,
		"notes":                      reg.notes,
		"needs_accommodation":        strconv.FormatBool(reg.needsAccommodation),
		"share_cabin_gate":           reg.shareCabinGate,
		"wants_near":                 strconv.FormatBool(reg.wantsNear),
		"wants_with_named":           strconv.FormatBool(reg.wantsWithNamed),
		"wants_similar_ages":         strconv.FormatBool(reg.wantsSimilarAges),
		"request_text":               reg.requestText,
		"request_source_field":       reg.requestSourceField,
		"request_last_updated":       formatRequestStamp(reg.requestLastUpdated),
		"needs_private_bathroom":     strconv.FormatBool(reg.needsPrivateBathroom),
		"needs_power":                strconv.FormatBool(reg.needsPower),
		"accommodation_is_mandatory": strconv.FormatBool(reg.accommodationIsMandatory),
		"has_infant":                 strconv.FormatBool(reg.hasInfant),
		"needs_fridge":               strconv.FormatBool(reg.needsFridge),
		"needs_step_free":            strconv.FormatBool(reg.needsStepFree),
		"share_eligibility":          eligibility,
		"share_eligibility_source":   eligibilitySource,
		enrollmentStatusColumn:       reg.enrollmentStatus,
	}
}

// medicalColumns is the same read for family_camp_medical, reusing the
// production list rather than a second copy of it.
func medicalColumns(med *medicalData) map[string]string {
	out := make(map[string]string, 14)
	for _, c := range medicalColumnValues(med) {
		out[c.column] = c.value
	}
	return out
}

// columnsWrittenBy drives the real transforms with ONE person value and returns
// every column whose written form differs from the empty household's.
//
// Both transforms are run: a source field can reach family_camp_registrations
// and family_camp_medical from the same answer, which is precisely the fan-out
// the registry could not previously express (the CPAP fields do it).
func columnsWrittenBy(f lodgingSourceField, value string, at time.Time) []string {
	entry := customValueEntry{
		householdPBID: "hh_probe",
		personPBID:    "p_probe",
		fieldName:     f.Name,
		value:         value,
		lastUpdated:   at,
	}
	// The two lanes are loaded separately and only the person lane reaches
	// processMedical, so probing a household field through the person argument
	// would exercise a route the sync never takes.
	var householdValues, personValues []customValueEntry
	if f.Grain == grainHousehold {
		householdValues = []customValueEntry{entry}
	} else {
		personValues = []customValueEntry{entry}
	}

	baseReg := registrationColumns(&registrationData{})
	baseMed := medicalColumns(&medicalData{})

	got := map[string]string{}
	for k, v := range baseReg {
		got[k] = v
	}
	for k, v := range baseMed {
		got["family_camp_medical."+k] = v
	}

	s := NewFamilyCampDerivedSync(nil)
	for _, reg := range s.processRegistrations(householdValues, personValues) {
		for k, v := range registrationColumns(reg) {
			got[k] = v
		}
	}
	for _, med := range s.processMedical(personValues) {
		for k, v := range medicalColumns(med) {
			got["family_camp_medical."+k] = v
		}
	}

	var written []string
	for column, value := range got {
		base, ok := baseReg[strings.TrimPrefix(column, "family_camp_medical.")]
		if strings.HasPrefix(column, "family_camp_medical.") {
			base, ok = baseMed[strings.TrimPrefix(column, "family_camp_medical.")]
		}
		if !ok {
			continue
		}
		if value != base {
			written = append(written, column)
		}
	}
	sort.Strings(written)
	return written
}

// TestLodgingRequestFieldsDeclareEveryColumnTheTransformWrites is the guard
// kindred#2569 asks for: no registered source field may write a stored column
// its registry row does not name.
//
// BOTH registries are walked. lodgingSourceFields is not exempt just because
// its ingest is the assignment lane: "Family Camp Cabin" is admitted by the
// family-camp name heuristic as well, so the same household answer that becomes
// a lodging_assignments row ALSO lands in family_camp_registrations.cabin_assignment
// -- a fan-out that spans two ingests and was invisible in either registry.
func TestLodgingRequestFieldsDeclareEveryColumnTheTransformWrites(t *testing.T) {
	t.Parallel()
	at := time.Date(2026, 4, 21, 9, 0, 0, 0, time.UTC)

	for _, registry := range []struct {
		name   string
		fields []lodgingSourceField
	}{
		{"lodgingRequestFields", lodgingRequestFields},
		{"lodgingSourceFields", lodgingSourceFields},
	} {
		for _, f := range registry.fields {
			probes, ok := requestFieldProbes[f.Name]
			if !ok || len(probes) == 0 {
				t.Errorf("%s: %q (cm_id %d) has no probe value; the registry and this table must stay in step",
					registry.name, f.Name, f.CMID)
				continue
			}

			for _, probe := range probes {
				for _, column := range columnsWrittenBy(f, probe, at) {
					if slices.Contains(f.Targets, column) {
						continue
					}
					t.Errorf("%s: %q (cm_id %d) writes %s, which its registry row does not declare\n"+
						"  probe:    %q\n  declared: %v",
						registry.name, f.Name, f.CMID, column, probe, f.Targets)
				}
			}
		}
	}
}

// TestRegistrationColumnsCoverEveryWrittenColumn keeps the mirror above honest.
//
// registrationColumns is a hand-written list, and a column added to
// setRegistrationRequestFields but not to it would be invisible to the fan-out
// guard -- the guard would go green on the very write it exists to catch. This
// asserts the mirror against the production writer by counting: every Set in
// setRegistrationRequestFields and in upsertRegistrations' two branches.
func TestRegistrationColumnsCoverEveryWrittenColumn(t *testing.T) {
	t.Parallel()

	// The six upsertRegistrations writes outside setRegistrationRequestFields,
	// plus household and year, which are keys rather than answers.
	direct := []string{
		"cabin_assignment", "share_cabin_preference", "shared_cabin_modes_raw",
		"arrival_eta", "special_occasions", "goals", "notes", "needs_accommodation",
	}
	mirrored := registrationColumns(&registrationData{})
	for _, column := range direct {
		if _, ok := mirrored[column]; !ok {
			t.Errorf("registrationColumns is missing %q, which upsertRegistrations writes", column)
		}
	}

	// And every column setRegistrationRequestFields writes. Read off the
	// production function by running it against a scratch record would need a
	// PocketBase collection; this list is the second-best guard and is short
	// enough to keep in step by eye.
	shared := []string{
		enrollmentStatusColumn, "share_cabin_gate", "wants_near", "wants_with_named",
		"wants_similar_ages", "request_text", "request_source_field",
		"request_last_updated", "needs_private_bathroom", "needs_power",
		"accommodation_is_mandatory", "has_infant", "needs_fridge", "needs_step_free",
		"share_eligibility", "share_eligibility_source",
	}
	for _, column := range shared {
		if _, ok := mirrored[column]; !ok {
			t.Errorf("registrationColumns is missing %q, which setRegistrationRequestFields writes", column)
		}
	}
	if len(mirrored) != len(direct)+len(shared) {
		t.Errorf("registrationColumns has %d columns; the two writer lists name %d",
			len(mirrored), len(direct)+len(shared))
	}
}
