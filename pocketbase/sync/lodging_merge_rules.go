package sync

import (
	"fmt"
	"slices"

	"github.com/pocketbase/pocketbase/core"
)

// UnitNode is one lodging_units row reduced to what the merge rules need.
type UnitNode struct {
	ID          string
	ParentID    string
	IsContainer bool
}

// MergeVerdict answers "may these units be bound into one bookable slot".
//
// The rule: a merge is legal iff its members are the COMPLETE child set of
// some container. Partial sets are what 1500000129's intermediate containers
// exist to make expressible -- two rooms of a four-room building are legal
// only because an "upstairs" container was seeded to hold exactly those two.
type MergeVerdict struct {
	Legal        bool
	ContainerID  string
	MissingUnits []string
	Reason       string
}

// JudgeMerge evaluates memberIDs against the tree.
//
// MissingUnits is the repair hint and the reason this returns a struct rather
// than a bool: when a set is one member short of a container, naming the
// absentee turns a dead end into a one-click registry fix.
func JudgeMerge(tree map[string]UnitNode, memberIDs []string) MergeVerdict {
	if len(memberIDs) < 2 {
		return MergeVerdict{Reason: "a merge needs at least two member units"}
	}

	members := make(map[string]bool, len(memberIDs))
	for _, id := range memberIDs {
		if _, ok := tree[id]; !ok {
			return MergeVerdict{Reason: fmt.Sprintf("member %q is not a known unit", id)}
		}
		members[id] = true
	}

	// Every member must share one parent. Checking the parent set first means
	// a set spanning two buildings fails here rather than being reported as
	// "missing" every room in one of them.
	parents := make(map[string]bool)
	for id := range members {
		parents[tree[id].ParentID] = true
	}
	if len(parents) != 1 {
		return MergeVerdict{Reason: "members do not share a single parent container"}
	}

	var parentID string
	for p := range parents {
		parentID = p
	}
	if parentID == "" {
		return MergeVerdict{Reason: "members have no parent container"}
	}
	if !tree[parentID].IsContainer {
		return MergeVerdict{Reason: fmt.Sprintf("parent %q is not a registered container", parentID)}
	}

	var missing []string
	for id, node := range tree {
		if node.ParentID == parentID && !members[id] {
			missing = append(missing, id)
		}
	}
	if len(missing) > 0 {
		slices.Sort(missing) // deterministic, so the queue row is stable across runs
		return MergeVerdict{
			MissingUnits: missing,
			Reason: fmt.Sprintf(
				"not the complete child set of its container: %d sibling unit(s) absent",
				len(missing),
			),
		}
	}

	return MergeVerdict{Legal: true, ContainerID: parentID}
}

// PlacementIsLegal reports whether a resolution may be materialized as a
// placement -- the same question placementFor answers when it decides between
// writing straight to a unit and routing through JudgeMerge.
//
// A resolution naming exactly one unit is a direct placement, not a merge, so
// there is nothing for JudgeMerge to judge and it is always legal. A
// resolution naming two or more is legal exactly when JudgeMerge finds them
// the complete child set of one container.
//
// placementFor and recheckIllegalMerges both have to ask this; before this
// function existed they asked it separately, and recheckIllegalMerges's
// direct JudgeMerge(...).Legal call omitted the single-unit case, so a repair
// that narrowed an alias down to one surviving unit would sync clean while
// its queue row stayed open forever. This is the one predicate both call.
func PlacementIsLegal(tree map[string]UnitNode, res AliasResolution) bool {
	return !res.IsMerge() || JudgeMerge(tree, res.UnitIDs).Legal
}

// HasParentCycle reports whether pointing unitID's parent at proposedParentID
// would create a loop -- either self-parenting or adopting a descendant.
//
// The frontend picker already filters these out (unitTree.ts, descendantIds).
// This is the server-side backstop (#1899) for the direct write that picker
// cannot filter. JudgeMerge does not walk parent links at all -- one hop per
// member, then a flat scan -- so it cannot hang on a cycle regardless; this
// function's own walk below is the one that would, without the visited guard
// it carries.
func HasParentCycle(tree map[string]UnitNode, unitID, proposedParentID string) bool {
	if proposedParentID == "" {
		return false
	}
	if unitID == proposedParentID {
		return true
	}
	// Walk up from the proposed parent. Meeting unitID means unitID is an
	// ancestor of it, so the link would close a loop. The visited set only
	// bounds the walk's length against a cycle that ALREADY exists elsewhere
	// in the data -- revisiting a node this walk has already seen answers
	// "this walk is looping", not "unitID is on the loop", so it must stop
	// the walk without reporting a cycle.
	visited := make(map[string]bool, len(tree))
	for cur := proposedParentID; cur != ""; cur = tree[cur].ParentID {
		if cur == unitID {
			return true
		}
		if visited[cur] {
			return false
		}
		visited[cur] = true
	}
	return false
}

// BuildUnitTree loads every lodging_units row. The table is ~93 rows, so this
// is one unfiltered read per caller rather than a cache to invalidate.
func BuildUnitTree(app core.App) (map[string]UnitNode, error) {
	records, err := app.FindAllRecords("lodging_units")
	if err != nil {
		return nil, fmt.Errorf("loading lodging_units: %w", err)
	}
	tree := make(map[string]UnitNode, len(records))
	for _, r := range records {
		tree[r.Id] = UnitNode{
			ID:          r.Id,
			ParentID:    r.GetString("parent_unit"),
			IsContainer: r.GetBool("is_container"),
		}
	}
	return tree, nil
}
