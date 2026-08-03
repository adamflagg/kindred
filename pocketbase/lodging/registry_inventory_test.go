package lodging

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// Guards the class found reviewing kindred#1914 (see kindred#1918): a
// whole-building inventory row stranding its rooms on the container.
//
// The inventory sheet lists ROOMS, so most buildings arrive as several rows and
// each lands on the room it describes. But a building can arrive as a single
// whole-building row. That row matches the building, which is a CONTAINER, and
// the match is correct -- there is no per-room row to target. What is missing is
// the next step: the amenity data stops at the container and the bookable rooms
// underneath it stay empty.
//
// It matters because containers are never bookable, nothing resolves amenities
// up the parent chain (lodging_roster_service.py reads them straight off the
// unit), and the fit check judges non-container units. So every room in that
// building reports has_power:false meaning "nobody has said" -- the exact
// blindness the inventory exists to end. Worse, it is invisible until staff
// confirm the cabins, at which point rosterAttention.ts stops reading false as
// "unknown" and starts reading it as "we checked, there is none".
//
// Counting cannot see it. Reconciling amenity totals against the sheet counts
// each row exactly once whether it sits on the container or on the rooms, so
// the totals reconcile perfectly either way -- in #1914 all ten counts
// reconciled and the defect was present. verify-lodging-seed.sh cannot see it
// either: it asserts the database matches the registry file, and the file was
// self-consistently wrong.

// inventoryAmenities reports which amenity flags the row carries.
//
// This is deliberately the amenity half of apply_lodging_inventory.py's
// INVENTORY_FIELDS -- the fields the inventory sheet supplies -- and
// deliberately EXCLUDES MaxBeds and Sleeps. A container carrying capacity is
// the intended whole-building aggregate, so a guard keyed on "the container has
// data" would flag the legitimate case. Bathroom and BathroomGroup are excluded
// for the same reason: they are structural, not sheet amenities.
func inventoryAmenities(u *registryUnit) []string {
	flags := []struct {
		name string
		set  bool
	}{
		{"has_power", u.HasPower},
		{"has_ac", u.HasAC},
		{"has_fridge", u.HasFridge},
		{"is_accessible", u.IsAccessible},
		{"has_heat", u.HasHeat},
		{"is_weatherized", u.IsWeatherized},
		{"has_plumbing", u.HasPlumbing},
		{"has_space_heater", u.HasSpaceHeater},
		{"has_pack_play_space", u.HasPackPlaySpace},
		{"has_living_room", u.HasLivingRoom},
		{"has_kitchen", u.HasKitchen},
		{"has_lights", u.HasLights},
	}

	var set []string
	for _, f := range flags {
		if f.set {
			set = append(set, f.name)
		}
	}
	// HasRamp is a string, where empty means NOT ASSESSED rather than false.
	if u.HasRamp != "" {
		set = append(set, "has_ramp")
	}
	return set
}

type strandedContainer struct {
	Code      string
	Amenities []string
	Leaves    []string
}

// findStrandedContainers returns every container carrying amenity data whose
// non-container descendants carry none.
//
// That shape has no legitimate reading: either the data belongs on the rooms,
// or it is shared and belongs on both. A container with no bookable descendants
// at all is not flagged -- there is nothing for the data to have failed to
// reach.
func findStrandedContainers(units []registryUnit) []strandedContainer {
	// Pointers into `units` rather than copies: registryUnit is 208 bytes and
	// golangci-lint's gocritic flags the by-value walk, which pre-push does not
	// run and CI does.
	byCode := make(map[string]*registryUnit, len(units))
	children := make(map[string][]string, len(units))
	for i := range units {
		u := &units[i]
		byCode[u.Code] = u
		if u.ParentUnit != "" {
			children[u.ParentUnit] = append(children[u.ParentUnit], u.Code)
		}
	}

	// A container's children can themselves be containers -- a building whose
	// rooms sit under per-floor containers is a real shape in the registry, and
	// a single-level check would miss it entirely. `seen` guards a malformed
	// parent cycle; validateRegistry does not reject one, and an unguarded walk
	// would hang the suite rather than fail it.
	var leavesOf func(code string, seen map[string]bool) []string
	leavesOf = func(code string, seen map[string]bool) []string {
		if seen[code] {
			return nil
		}
		seen[code] = true

		var leaves []string
		for _, child := range children[code] {
			if byCode[child].IsContainer {
				leaves = append(leaves, leavesOf(child, seen)...)
				continue
			}
			leaves = append(leaves, child)
		}
		return leaves
	}

	var stranded []strandedContainer
	for i := range units {
		u := &units[i]
		if !u.IsContainer {
			continue
		}
		amenities := inventoryAmenities(u)
		if len(amenities) == 0 {
			continue
		}

		leaves := leavesOf(u.Code, map[string]bool{})
		if len(leaves) == 0 {
			continue
		}

		received := false
		for _, leaf := range leaves {
			if len(inventoryAmenities(byCode[leaf])) > 0 {
				received = true
				break
			}
		}
		if !received {
			stranded = append(stranded, strandedContainer{
				Code: u.Code, Amenities: amenities, Leaves: leaves,
			})
		}
	}
	return stranded
}

func TestFindStrandedContainersFlagsAWholeBuildingRowItsRoomsNeverReceived(t *testing.T) {
	units := []registryUnit{
		{Code: "house", Name: "House", IsContainer: true},
		{Code: "house-a", Name: "House A", ParentUnit: "house"},
		{Code: "house-b", Name: "House B", ParentUnit: "house"},
	}
	units[0].HasPower = true
	units[0].HasHeat = true

	got := findStrandedContainers(units)
	if len(got) != 1 || got[0].Code != "house" {
		t.Fatalf("expected the container to be flagged, got %+v", got)
	}
	if len(got[0].Leaves) != 2 {
		t.Errorf("expected both rooms reported as starved, got %v", got[0].Leaves)
	}
}

func TestFindStrandedContainersAllowsACapacityOnlyAggregate(t *testing.T) {
	// The intended shape: the container carries the whole-building bed count and
	// the rooms carry the amenities. A guard keyed on capacity would flag this.
	beds := 7
	units := []registryUnit{
		{Code: "house", Name: "House", IsContainer: true, MaxBeds: &beds},
		{Code: "house-a", Name: "House A", ParentUnit: "house"},
		{Code: "house-b", Name: "House B", ParentUnit: "house"},
	}
	units[1].HasPower = true
	units[2].HasPower = true

	if got := findStrandedContainers(units); len(got) != 0 {
		t.Fatalf("capacity-only container with amenity-bearing rooms must not be flagged, got %+v", got)
	}
}

func TestFindStrandedContainersTreatsCapacityAsNotAnAmenity(t *testing.T) {
	// The sharp version of the case above. There, the rooms carry amenities, so
	// the guard short-circuits on "a room received the data" and never has to
	// decide whether capacity counts -- it passes either way, which makes it
	// worthless as a check on that rule.
	//
	// Here nothing downstream carries anything, so the ONLY thing keeping the
	// container unflagged is that MaxBeds and Sleeps are excluded from the
	// amenity set. Rooms nobody has inventoried yet are a different and far
	// broader condition than a whole-building row that failed to reach them.
	beds, sleeps := 7, 7
	units := []registryUnit{
		{Code: "house", Name: "House", IsContainer: true, MaxBeds: &beds, Sleeps: &sleeps},
		{Code: "house-a", Name: "House A", ParentUnit: "house"},
		{Code: "house-b", Name: "House B", ParentUnit: "house"},
	}

	if got := findStrandedContainers(units); len(got) != 0 {
		t.Fatalf("capacity is a whole-building aggregate, not amenity data, got %+v", got)
	}
}

func TestFindStrandedContainersWalksNestedContainers(t *testing.T) {
	// building -> per-floor containers -> rooms. A single-level check sees only
	// the floor containers, finds no non-container children carrying data on the
	// building itself, and reports nothing.
	units := []registryUnit{
		{Code: "house", Name: "House", IsContainer: true},
		{Code: "house-up", Name: "House Upstairs", ParentUnit: "house", IsContainer: true},
		{Code: "house-1", Name: "House 1", ParentUnit: "house-up"},
		{Code: "house-2", Name: "House 2", ParentUnit: "house-up"},
	}
	units[0].HasKitchen = true

	got := findStrandedContainers(units)
	if len(got) != 1 || got[0].Code != "house" {
		t.Fatalf("expected the outer container flagged through its floor container, got %+v", got)
	}
	if len(got[0].Leaves) != 2 {
		t.Errorf("expected the two rooms two levels down, got %v", got[0].Leaves)
	}
}

func TestFindStrandedContainersIgnoresAContainerWithNoRooms(t *testing.T) {
	units := []registryUnit{{Code: "house", Name: "House", IsContainer: true}}
	units[0].HasPower = true

	if got := findStrandedContainers(units); len(got) != 0 {
		t.Fatalf("a container with no descendants has nothing to strand, got %+v", got)
	}
}

func TestFindStrandedContainersPassesWhenOneRoomCarriesTheData(t *testing.T) {
	// Partial is not this defect. One room carrying the data means the row
	// reached the rooms; whether every sibling should have it too is a data
	// question staff own, not a structural one.
	units := []registryUnit{
		{Code: "house", Name: "House", IsContainer: true},
		{Code: "house-a", Name: "House A", ParentUnit: "house"},
		{Code: "house-b", Name: "House B", ParentUnit: "house"},
	}
	units[0].HasPower = true
	units[1].HasPower = true

	if got := findStrandedContainers(units); len(got) != 0 {
		t.Fatalf("one amenity-bearing room is enough, got %+v", got)
	}
}

func TestFindStrandedContainersToleratesAParentCycle(t *testing.T) {
	// validateRegistry does not reject a cycle. An unguarded descendant walk
	// would hang the suite rather than fail it, which is the worse failure.
	units := []registryUnit{
		{Code: "a", Name: "A", IsContainer: true, ParentUnit: "b"},
		{Code: "b", Name: "B", IsContainer: true, ParentUnit: "a"},
	}
	units[0].HasPower = true

	_ = findStrandedContainers(units) // must terminate
}

func TestPrivateRegistryHasNoStrandedContainers(t *testing.T) {
	// Runs against the real file when kindred-local is linked, and skips
	// cleanly otherwise -- the same graceful degradation SeedRegistry and
	// verify-lodging-seed.sh already have for a clone without the private repo.
	path := filepath.Join("..", "..", "config", "lodging_registry.json")
	data, err := os.ReadFile(path) //nolint:gosec // G304: fixed path to local config
	if err != nil {
		if os.IsNotExist(err) {
			t.Skip("private lodging registry absent; run scripts/setup/setup-local-config.sh")
		}
		t.Fatalf("reading %s: %v", path, err)
	}

	var doc registryDoc
	if err := json.Unmarshal(data, &doc); err != nil {
		t.Fatalf("parsing %s: %v", path, err)
	}
	if len(doc.Units) == 0 {
		t.Fatalf("%s parsed to zero units", path)
	}

	for _, s := range findStrandedContainers(doc.Units) {
		t.Errorf(
			"container %q carries %v while none of its %d bookable rooms (%v) carry any: "+
				"a whole-building inventory row landed on the container and never reached the rooms",
			s.Code, s.Amenities, len(s.Leaves), s.Leaves,
		)
	}
}
