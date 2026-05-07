// Package bunkrequests provides reciprocity-correctness hooks for the
// bunk_requests PocketBase collection.
package bunkrequests

import (
	"fmt"

	"github.com/pocketbase/pocketbase/core"
)

const (
	requestTypeBunkWith    = "bunk_with"
	requestTypeNotBunkWith = "not_bunk_with"
	statusResolved         = "resolved"
)

// RecomputePairReciprocity recomputes is_reciprocal on both rows of a
// (personA, personB, request_type) pair in the same year + session.
// Idempotent: writes only if the new value differs from the stored one.
//
// Reciprocity is meaningful only for bunk_with and not_bunk_with rows that
// share year+session+request_type; the call is a no-op for any other shape.
func RecomputePairReciprocity(
	app core.App,
	year int,
	sessionID int,
	personA int,
	personB int,
	requestType string,
) error {
	if requestType != requestTypeBunkWith && requestType != requestTypeNotBunkWith {
		return nil
	}
	if personA == 0 || personB == 0 || personA == personB {
		return nil
	}

	rowAB, err := findRow(app, year, sessionID, personA, personB, requestType)
	if err != nil {
		return fmt.Errorf("find A→B: %w", err)
	}
	rowBA, err := findRow(app, year, sessionID, personB, personA, requestType)
	if err != nil {
		return fmt.Errorf("find B→A: %w", err)
	}

	aResolved := rowAB != nil && rowAB.GetString("status") == statusResolved
	bResolved := rowBA != nil && rowBA.GetString("status") == statusResolved

	// Reciprocity is a symmetric pair-level property: both rows are reciprocal
	// iff both exist AND both are resolved. Matches the graph builder's
	// has_forward && has_backward semantic at social_graph_builder.py:379.
	pairReciprocal := aResolved && bResolved

	if err := setIfChanged(app, rowAB, pairReciprocal); err != nil {
		return fmt.Errorf("update A→B: %w", err)
	}
	if err := setIfChanged(app, rowBA, pairReciprocal); err != nil {
		return fmt.Errorf("update B→A: %w", err)
	}
	return nil
}

// findRow returns the bunk_request matching the given coordinates, or nil if
// no row exists. If multiple match (dedup miss), returns the first.
func findRow(app core.App, year, sessionID, requester, requestee int, requestType string) (*core.Record, error) {
	filter := "year = {:year} && session_id = {:sessionID} && " +
		"requester_id = {:requester} && requestee_id = {:requestee} && " +
		"request_type = {:requestType}"
	records, err := app.FindRecordsByFilter(
		"bunk_requests",
		filter,
		"",
		1,
		0,
		map[string]any{
			"year":        year,
			"sessionID":   sessionID,
			"requester":   requester,
			"requestee":   requestee,
			"requestType": requestType,
		},
	)
	if err != nil {
		return nil, fmt.Errorf("find bunk_requests: %w", err)
	}
	if len(records) == 0 {
		return nil, nil
	}
	return records[0], nil
}

// setIfChanged updates is_reciprocal only if the stored value differs from
// the target. This is the recursion-termination guarantee — when our save
// triggers OnRecordAfterUpdateSuccess, the re-entry recomputes the same
// target value and finds it already stored, so no further save fires.
func setIfChanged(app core.App, row *core.Record, target bool) error {
	if row == nil {
		return nil
	}
	if row.GetBool("is_reciprocal") == target {
		return nil
	}
	row.Set("is_reciprocal", target)
	if err := app.Save(row); err != nil {
		return fmt.Errorf("save is_reciprocal: %w", err)
	}
	return nil
}
