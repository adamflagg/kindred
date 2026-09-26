package sync

import (
	"reflect"
	"testing"
)

func TestComputeAutoHouseholdLinks(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name   string
		groups [][]int
		want   []aidHouseholdLink
	}{
		{name: "no people", groups: nil, want: nil},
		{name: "one household is not a family link", groups: [][]int{{100, 100, 0}}, want: nil},
		{
			name:   "primary and alternate childhood homes join",
			groups: [][]int{{100, 100, 200}},
			want: []aidHouseholdLink{
				{HouseholdCMID: 100, FamilyKey: "hh-100", Source: aidLinkSourceAuto},
				{HouseholdCMID: 200, FamilyKey: "hh-100", Source: aidLinkSourceAuto},
			},
		},
		{
			name:   "siblings chain three homes into one family keyed by the smallest",
			groups: [][]int{{300, 200}, {200, 100}},
			want: []aidHouseholdLink{
				{HouseholdCMID: 100, FamilyKey: "hh-100", Source: aidLinkSourceAuto},
				{HouseholdCMID: 200, FamilyKey: "hh-100", Source: aidLinkSourceAuto},
				{HouseholdCMID: 300, FamilyKey: "hh-100", Source: aidLinkSourceAuto},
			},
		},
		{
			// Impact §2.2 Task 3 (tracker H4, fictional ids): separated parents, each
			// in their own household, both post aid for one child whose primary
			// childhood home is the mother's and alternate the father's. The parents
			// are not enrolled, so only the child contributes a group, and that group
			// alone makes the two homes one family.
			name:   "separated parents who each post for the child are one family",
			groups: [][]int{{300, 300, 400}},
			want: []aidHouseholdLink{
				{HouseholdCMID: 300, FamilyKey: "hh-300", Source: aidLinkSourceAuto},
				{HouseholdCMID: 400, FamilyKey: "hh-300", Source: aidLinkSourceAuto},
			},
		},
		{
			name:   "two separate families stay separate",
			groups: [][]int{{500, 600}, {100, 200}},
			want: []aidHouseholdLink{
				{HouseholdCMID: 100, FamilyKey: "hh-100", Source: aidLinkSourceAuto},
				{HouseholdCMID: 200, FamilyKey: "hh-100", Source: aidLinkSourceAuto},
				{HouseholdCMID: 500, FamilyKey: "hh-500", Source: aidLinkSourceAuto},
				{HouseholdCMID: 600, FamilyKey: "hh-500", Source: aidLinkSourceAuto},
			},
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := computeAutoHouseholdLinks(tc.groups); !reflect.DeepEqual(got, tc.want) {
				t.Errorf("got %+v\nwant %+v", got, tc.want)
			}
		})
	}
}

func TestMergeHouseholdLinksLetsStaffRowsShadowAutoRows(t *testing.T) {
	t.Parallel()
	auto := []aidHouseholdLink{
		{HouseholdCMID: 100, FamilyKey: "hh-100", Source: aidLinkSourceAuto},
		{HouseholdCMID: 400, FamilyKey: "hh-100", Source: aidLinkSourceAuto},
	}
	staff := []aidHouseholdLink{
		{HouseholdCMID: 400, FamilyKey: "hh-100", Source: aidLinkSourceStaff, Excluded: true},
		{HouseholdCMID: 700, FamilyKey: "hh-100", Source: aidLinkSourceStaff},
	}
	want := []aidHouseholdLink{staff[0], staff[1], auto[0]}
	if got := mergeHouseholdLinks(auto, staff); !reflect.DeepEqual(got, want) {
		t.Errorf("got %+v\nwant %+v", got, want)
	}
}

func TestAidFamilyIndexHouseholdSet(t *testing.T) {
	t.Parallel()
	links := []aidHouseholdLink{
		{HouseholdCMID: 100, FamilyKey: "hh-100", Source: aidLinkSourceAuto},
		{HouseholdCMID: 200, FamilyKey: "hh-100", Source: aidLinkSourceAuto},
		{HouseholdCMID: 200, FamilyKey: "staff-merge", Source: aidLinkSourceStaff},
		{HouseholdCMID: 700, FamilyKey: "staff-merge", Source: aidLinkSourceStaff},
		{HouseholdCMID: 400, FamilyKey: "hh-100", Source: aidLinkSourceStaff, Excluded: true},
	}
	idx := newAidFamilyIndex(links)
	cases := map[int][]int{
		100: {100, 200, 700}, // transitive through the staff key
		700: {100, 200, 700},
		400: {400}, // excluded: joins nothing
		900: {900}, // never linked
	}
	for h, want := range cases {
		if got := idx.HouseholdSet(h); !reflect.DeepEqual(got, want) {
			t.Errorf("HouseholdSet(%d) = %v, want %v", h, got, want)
		}
	}
	var zero aidFamilyIndex
	if got := zero.HouseholdSet(100); !reflect.DeepEqual(got, []int{100}) {
		t.Errorf("zero index must return the household itself, got %v", got)
	}
	if got := zero.HouseholdSet(0); len(got) != 0 {
		t.Errorf("household 0 has no set, got %v", got)
	}
}
