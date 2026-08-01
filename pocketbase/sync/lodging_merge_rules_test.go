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

func TestJudgeMergeAcceptsACompleteChildSet(t *testing.T) {
	v := JudgeMerge(testTree(), []string{"r1", "r2"})
	if !v.Legal {
		t.Fatalf("expected {r1,r2} legal under 'up', got %+v", v)
	}
	if v.ContainerID != "up" {
		t.Errorf("ContainerID = %q, want \"up\"", v.ContainerID)
	}
}

func TestJudgeMergeIsOrderIndependent(t *testing.T) {
	if !JudgeMerge(testTree(), []string{"r2", "r1"}).Legal {
		t.Error("member order must not affect legality")
	}
}

func TestJudgeMergeRejectsAPartialChildSet(t *testing.T) {
	// {r2,r3} spans two containers and completes neither.
	v := JudgeMerge(testTree(), []string{"r2", "r3"})
	if v.Legal {
		t.Fatal("expected {r2,r3} illegal")
	}
	if v.Reason == "" {
		t.Error("an illegal verdict must carry a Reason for the work queue")
	}
}

// The Health Center case: a set that is one member short of a container.
// The missing member must be named, because that is the whole repair hint.
func TestJudgeMergeNamesTheMissingMember(t *testing.T) {
	tree := testTree()
	tree["r5"] = UnitNode{ID: "r5", ParentID: "up"}
	v := JudgeMerge(tree, []string{"r1", "r2"})
	if v.Legal {
		t.Fatal("with r5 under 'up', {r1,r2} is no longer complete")
	}
	if len(v.MissingUnits) != 1 || v.MissingUnits[0] != "r5" {
		t.Errorf("MissingUnits = %v, want [r5]", v.MissingUnits)
	}
}

func TestJudgeMergeRejectsFewerThanTwoMembers(t *testing.T) {
	if JudgeMerge(testTree(), []string{"r1"}).Legal {
		t.Error("a merge needs at least two members")
	}
}

func TestHasParentCycleDetectsSelfAndDescendants(t *testing.T) {
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
