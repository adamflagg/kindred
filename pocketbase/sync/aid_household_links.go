package sync

import (
	"fmt"
	"sort"
)

const (
	aidLinkSourceAuto  = "auto"
	aidLinkSourceStaff = "staff"
)

// aidHouseholdLink is one aid_household_links row: a household joined to a
// family key for one season. A family is every household reachable through
// shared keys (see aidFamilyIndex).
type aidHouseholdLink struct {
	HouseholdCMID int
	FamilyKey     string
	Source        string
	Excluded      bool
}

func aidLinkKey(household int, familyKey string) string {
	return fmt.Sprintf("%d|%s", household, familyKey)
}

// positiveUnique returns the positive ids, sorted and de-duplicated.
func positiveUnique(ids []int) []int {
	seen := make(map[int]bool, len(ids))
	out := make([]int, 0, len(ids))
	for _, id := range ids {
		if id > 0 && !seen[id] {
			seen[id] = true
			out = append(out, id)
		}
	}
	sort.Ints(out)
	return out
}

// computeAutoHouseholdLinks joins households that one person belongs to. Each
// group is one person's household ids (their own household plus their primary
// and alternate childhood households). Components of two or more households
// become rows keyed "hh-<smallest household id>"; a lone household needs no row,
// because HouseholdSet already returns the household itself.
func computeAutoHouseholdLinks(groups [][]int) []aidHouseholdLink {
	parent := map[int]int{}
	find := func(x int) int {
		for parent[x] != x {
			parent[x] = parent[parent[x]]
			x = parent[x]
		}
		return x
	}
	for _, group := range groups {
		ids := positiveUnique(group)
		for _, h := range ids {
			if _, ok := parent[h]; !ok {
				parent[h] = h
			}
		}
		for _, h := range ids[min(1, len(ids)):] {
			ra, rb := find(ids[0]), find(h)
			if ra == rb {
				continue
			}
			if ra < rb {
				parent[rb] = ra
			} else {
				parent[ra] = rb
			}
		}
	}
	members := map[int][]int{}
	for h := range parent {
		root := find(h)
		members[root] = append(members[root], h)
	}
	var out []aidHouseholdLink
	for _, hs := range members {
		if len(hs) < 2 {
			continue
		}
		sort.Ints(hs)
		key := fmt.Sprintf("hh-%d", hs[0])
		for _, h := range hs {
			out = append(out, aidHouseholdLink{HouseholdCMID: h, FamilyKey: key, Source: aidLinkSourceAuto})
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].FamilyKey != out[j].FamilyKey {
			return out[i].FamilyKey < out[j].FamilyKey
		}
		return out[i].HouseholdCMID < out[j].HouseholdCMID
	})
	return out
}

// mergeHouseholdLinks returns the staff rows followed by every auto row that no
// staff row shadows. A staff row with the same (household, key) replaces the
// auto row -- the unique index allows only one -- which is how an exclusion
// works.
func mergeHouseholdLinks(auto, staff []aidHouseholdLink) []aidHouseholdLink {
	shadowed := make(map[string]bool, len(staff))
	out := make([]aidHouseholdLink, 0, len(auto)+len(staff))
	for _, l := range staff {
		shadowed[aidLinkKey(l.HouseholdCMID, l.FamilyKey)] = true
		out = append(out, l)
	}
	for _, l := range auto {
		if !shadowed[aidLinkKey(l.HouseholdCMID, l.FamilyKey)] {
			out = append(out, l)
		}
	}
	return out
}

// aidFamilyIndex resolves a household to its family's household set. The zero
// value is usable and treats every household as its own family.
type aidFamilyIndex struct {
	keysByHousehold map[int][]string
	householdsByKey map[string][]int
}

func newAidFamilyIndex(links []aidHouseholdLink) aidFamilyIndex {
	idx := aidFamilyIndex{keysByHousehold: map[int][]string{}, householdsByKey: map[string][]int{}}
	for _, l := range links {
		if l.Excluded || l.HouseholdCMID <= 0 || l.FamilyKey == "" {
			continue
		}
		idx.keysByHousehold[l.HouseholdCMID] = append(idx.keysByHousehold[l.HouseholdCMID], l.FamilyKey)
		idx.householdsByKey[l.FamilyKey] = append(idx.householdsByKey[l.FamilyKey], l.HouseholdCMID)
	}
	return idx
}

// HouseholdSet is every household reachable from h through shared keys,
// including h, sorted. Empty for h <= 0.
func (f aidFamilyIndex) HouseholdSet(h int) []int {
	if h <= 0 {
		return nil
	}
	seen := map[int]bool{h: true}
	queue := []int{h}
	for len(queue) > 0 {
		cur := queue[0]
		queue = queue[1:]
		for _, key := range f.keysByHousehold[cur] {
			for _, other := range f.householdsByKey[key] {
				if !seen[other] {
					seen[other] = true
					queue = append(queue, other)
				}
			}
		}
	}
	out := make([]int, 0, len(seen))
	for id := range seen {
		out = append(out, id)
	}
	sort.Ints(out)
	return out
}
