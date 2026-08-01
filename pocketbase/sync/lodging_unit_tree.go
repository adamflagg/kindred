package sync

import (
	"fmt"

	"github.com/pocketbase/pocketbase/core"
)

// UnitNode is one lodging_units row reduced to what the cycle guard needs.
type UnitNode struct {
	ID          string
	ParentID    string
	IsContainer bool
}

// HasParentCycle reports whether pointing unitID's parent at proposedParentID
// would create a loop -- either self-parenting or adopting a descendant.
//
// The frontend picker already filters these out (unitTree.ts, descendantIds).
// This is the server-side backstop (#1899) for the direct write that picker
// cannot filter. The walk below is the only thing in the lodging code that
// follows parent links, which is why it carries its own visited guard.
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
