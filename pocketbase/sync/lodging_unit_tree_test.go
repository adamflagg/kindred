package sync

import "testing"

// A four-room building with two intermediate containers, mirroring the shape
// seeded by 1500000129: rooms 1+2 under an "upstairs" container, 3+4 under a
// "downstairs" container, both under the building.
func testTree() map[string]UnitNode {
	return map[string]UnitNode{
		"bldg": {ID: "bldg", ParentID: "", IsContainer: true},
		"up":   {ID: "up", ParentID: "bldg", IsContainer: true},
		"down": {ID: "down", ParentID: "bldg", IsContainer: true},
		"r1":   {ID: "r1", ParentID: "up"},
		"r2":   {ID: "r2", ParentID: "up"},
		"r3":   {ID: "r3", ParentID: "down"},
		"r4":   {ID: "r4", ParentID: "down"},
	}
}

// The two shapes a cycle takes: a unit pointing at itself, and a unit adopting
// something already beneath it.
func TestHasParentCycleDetectsSelfAndDescendants(t *testing.T) {
	t.Parallel()
	tree := testTree()
	if !HasParentCycle(tree, "up", "up") {
		t.Error("a unit cannot be its own parent")
	}
	if !HasParentCycle(tree, "bldg", "up") {
		t.Error("bldg cannot adopt its own descendant 'up' as parent")
	}
	if HasParentCycle(tree, "r1", "down") {
		t.Error("moving r1 under 'down' is not a cycle")
	}
}

// A pre-existing cycle elsewhere in the tree (a<->b) must not taint the
// answer for an unrelated unit. Reparenting r1 under 'a' never reaches r1,
// so it closes no loop for r1 -- the tree may already be corrupt, but that
// is a separate problem from the one this function answers.
func TestHasParentCycleIgnoresAnUnrelatedPreExistingCycle(t *testing.T) {
	t.Parallel()
	tree := map[string]UnitNode{
		"a": {ID: "a", ParentID: "b"}, "b": {ID: "b", ParentID: "a"}, // loop, unrelated to r1
		"bldg": {ID: "bldg", IsContainer: true},
		"up":   {ID: "up", ParentID: "bldg"},
		"r1":   {ID: "r1", ParentID: "up"},
	}
	if HasParentCycle(tree, "r1", "a") {
		t.Error("reparenting r1 under 'a' does not create a cycle involving r1")
	}
}
