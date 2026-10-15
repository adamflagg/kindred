package sync

import (
	"testing"
)

// ============================================================================
// kindred#3213 -- "Adult Reg" sessions are adult-only Family Camp attendees.
//
// From 2027 CampMinder files an "Adult Reg: …" session beside each Family Camp
// weekend, in the Adult Programs group. Adults beyond a family's first two, and
// adults who come without children, register there. They are typed
// family_adult and point at their weekend through parent_id, the way an AG
// session points at its main session.
// ============================================================================

// TestFamilyAdultGroupAndNamePathsAgree pins that an Adult Reg session reads the
// same whether CampMinder returns its group id or not. Before #3213 the name
// fallback typed "Adult Reg: Family Camp N" as `family` while the group path
// typed it `adult` -- the type depended on which path the sync happened to take.
func TestFamilyAdultGroupAndNamePathsAgree(t *testing.T) {
	t.Parallel()
	s := &SessionsSync{}

	names := []string{
		"Adult Reg: Family Camp 1 (Memorial Day Weekend)",
		"Adult Reg: Family Camp 5 (Families of Color Weekend)",
		"Adult Reg: Family Camp 6",
		"Adult Reg: Prospective Families Weekend",
	}
	for _, name := range names {
		viaGroup := s.classifySessionType(sessionInfo{cmID: 1, name: name}, groupAdult, nil)
		viaName := s.classifySessionType(sessionInfo{cmID: 1, name: name}, 0, nil)
		if viaGroup != sessionTypeFamilyAdult || viaName != sessionTypeFamilyAdult {
			t.Errorf("%q: group path = %q, name path = %q; both must be %q",
				name, viaGroup, viaName, sessionTypeFamilyAdult)
		}
	}
}

// weekendInfo builds a sessionInfo with the sync's parsed date format.
func weekendInfo(cmID int, name, start, end string) sessionInfo {
	return sessionInfo{
		cmID: cmID, name: name,
		startDate: start + " 00:00:00Z", endDate: end + " 00:00:00Z",
	}
}

// TestPairFamilyAdultParents covers how an Adult Reg session finds its weekend.
//
// The name is the authority: "Family Camp N" pairs by its number, anything else
// by the exact name after the "Adult Reg:" prefix. Dates are a last resort,
// because CampMinder's own 2027 setup gives one Adult Reg session the NEXT
// weekend's dates -- pairing by date first would attach it to the wrong weekend.
func TestPairFamilyAdultParents(t *testing.T) {
	t.Parallel()

	infos := []sessionInfo{
		// Family Camp weekends.
		weekendInfo(101, "Family Camp 4: Labor Day Weekend", "2027-09-03", "2027-09-06"),
		weekendInfo(102, "Family Camp 5: Autumn Weekend", "2027-09-09", "2027-09-12"),
		weekendInfo(103, "Family Camp 6", "2027-09-16", "2027-09-19"),
		weekendInfo(104, "Prospective Families Weekend", "2027-09-24", "2027-09-26"),
		weekendInfo(105, "Winter Family Camp", "2027-12-26", "2027-12-28"),
		weekendInfo(106, "Spring Family Retreat", "2027-04-02", "2027-04-04"),
		weekendInfo(107, "Spring Family Gathering", "2027-04-02", "2027-04-04"),

		// Adult Reg sessions.
		weekendInfo(201, "Adult Reg: Family Camp 4 (Labor Day Weekend)", "2027-09-03", "2027-09-06"),
		// CampMinder slip: Family Camp 5's Adult Reg carries Family Camp 6's dates.
		weekendInfo(202, "Adult Reg: Family Camp 5 (Autumn Weekend)", "2027-09-16", "2027-09-19"),
		weekendInfo(203, "Adult Reg: Family Camp 6", "2027-09-16", "2027-09-19"),
		weekendInfo(204, "Adult Reg: Prospective Families Weekend", "2027-09-24", "2027-09-26"),
		// No number, no exact name -- but exactly one weekend shares its dates.
		weekendInfo(205, "Adult Reg: Winter Weekend", "2027-12-26", "2027-12-28"),
		// Two weekends share its dates: ambiguous, so no parent.
		weekendInfo(206, "Adult Reg: Spring Weekend", "2027-04-02", "2027-04-04"),
		// Names a weekend that does not exist, on dates no weekend has.
		weekendInfo(207, "Adult Reg: Family Camp 9", "2027-10-01", "2027-10-03"),

		// An ordinary adult weekend sharing a Family Camp's dates is not paired.
		weekendInfo(301, "Women's Weekend", "2027-09-03", "2027-09-06"),
	}
	types := map[int]string{
		101: sessionTypeFamily, 102: sessionTypeFamily, 103: sessionTypeFamily,
		104: sessionTypeFamily, 105: sessionTypeFamily, 106: sessionTypeFamily, 107: sessionTypeFamily,
		201: sessionTypeFamilyAdult, 202: sessionTypeFamilyAdult, 203: sessionTypeFamilyAdult,
		204: sessionTypeFamilyAdult, 205: sessionTypeFamilyAdult, 206: sessionTypeFamilyAdult,
		207: sessionTypeFamilyAdult,
		301: sessionTypeAdult,
	}

	got := pairFamilyAdultParents(infos, types)

	want := map[int]int{
		201: 101, // number match
		202: 102, // number match wins over the mismatched dates
		203: 103,
		204: 104, // exact name after the prefix
		205: 105, // unique date match
	}
	for cmID, parent := range want {
		if got[cmID] != parent {
			t.Errorf("parent of %d = %d, want %d", cmID, got[cmID], parent)
		}
	}
	for _, cmID := range []int{206, 207, 301, 101} {
		if parent, ok := got[cmID]; ok {
			t.Errorf("%d was paired with %d; want no parent", cmID, parent)
		}
	}
}

// TestPairFamilyAdultParentsAmbiguousNumberFallsBackToDates: a number that names
// more than one weekend is no pairing at all, so the date fallback decides.
func TestPairFamilyAdultParentsAmbiguousNumberFallsBackToDates(t *testing.T) {
	t.Parallel()

	infos := []sessionInfo{
		weekendInfo(101, "Family Camp 2: Spring", "2027-05-01", "2027-05-03"),
		weekendInfo(102, "Family Camp 2 (Overflow)", "2027-05-08", "2027-05-10"),
		weekendInfo(201, "Adult Reg: Family Camp 2", "2027-05-08", "2027-05-10"),
	}
	types := map[int]string{101: sessionTypeFamily, 102: sessionTypeFamily, 201: sessionTypeFamilyAdult}

	got := pairFamilyAdultParents(infos, types)
	if got[201] != 102 {
		t.Errorf("parent of 201 = %d, want 102 (the only weekend on its dates)", got[201])
	}
}

// TestTransformSessionCarriesTheFamilyAdultParent pins the hand-off from the
// pairing pass to the record: the pairing travels through overrideParents, the
// same channel the embedded-session pass uses, so parent_id is written and stays
// in the compare fields (a later CampMinder correction re-pairs the session).
func TestTransformSessionCarriesTheFamilyAdultParent(t *testing.T) {
	t.Parallel()
	s := &SessionsSync{groupIDMap: map[int]string{}}

	data := map[string]any{
		"ID": float64(201), "Name": "Adult Reg: Family Camp 4", "SeasonID": float64(2027),
		"StartDate": "2027-09-03T00:00:00Z", "EndDate": "2027-09-06T00:00:00Z",
	}
	pbData, err := s.transformSessionToPBWithParent(
		data, map[string]int{}, map[int]string{201: sessionTypeFamilyAdult}, map[int]int{201: 101})
	if err != nil {
		t.Fatalf("transformSessionToPBWithParent: %v", err)
	}
	if pbData["session_type"] != sessionTypeFamilyAdult {
		t.Errorf("session_type = %v, want %q", pbData["session_type"], sessionTypeFamilyAdult)
	}
	if pbData["parent_id"] != 101 {
		t.Errorf("parent_id = %v, want 101", pbData["parent_id"])
	}
}
