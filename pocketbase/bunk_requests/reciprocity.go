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

// RecomputePairReciprocity recomputes is_reciprocal on every row of a
// (personA, personB, request_type) pair in the same year + session.
// Idempotent: writes only if the new value differs from the stored one.
//
// Reciprocity is meaningful only for bunk_with and not_bunk_with rows that
// share year+session+request_type; the call is a no-op for any other shape.
//
// Production allows multiple rows per directed pair when they originate
// from different source_field values (the unique index includes source_field).
// Reciprocity is a pair-level property — all sibling rows in the same
// direction share the same target is_reciprocal — so every sibling must
// be updated, not just the lowest-id one. The previous single-row logic
// silently left non-lowest-id siblings stale when their request_type was
// flipped (#1445).
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

	rowsAB, err := findRows(app, year, sessionID, personA, personB, requestType)
	if err != nil {
		return fmt.Errorf("find A→B: %w", err)
	}
	rowsBA, err := findRows(app, year, sessionID, personB, personA, requestType)
	if err != nil {
		return fmt.Errorf("find B→A: %w", err)
	}

	aResolved := anyResolved(rowsAB)
	bResolved := anyResolved(rowsBA)

	// Reciprocity is a symmetric pair-level property: both rows are reciprocal
	// iff at least one row on each side exists AND at least one is resolved on
	// each side. Matches the graph builder's has_forward && has_backward
	// semantic at social_graph_builder.py:379.
	pairReciprocal := aResolved && bResolved

	for _, row := range rowsAB {
		if err := setIfChanged(app, row, pairReciprocal); err != nil {
			return fmt.Errorf("update A→B sibling %s: %w", row.Id, err)
		}
	}
	for _, row := range rowsBA {
		if err := setIfChanged(app, row, pairReciprocal); err != nil {
			return fmt.Errorf("update B→A sibling %s: %w", row.Id, err)
		}
	}
	return nil
}

// findRows returns every bunk_request matching the given coordinates, or
// an empty slice if none exist. Production allows multiple rows per directed
// pair when they originate from different source_field values; this helper
// returns all of them so reciprocity updates can apply uniformly across
// siblings (#1445 — a single-row helper silently left stale state on
// non-lowest-id rows when request_type was flipped).
func findRows(app core.App, year, sessionID, requester, requestee int, requestType string) ([]*core.Record, error) {
	filter := "year = {:year} && session_id = {:sessionID} && " +
		"requester_id = {:requester} && requestee_id = {:requestee} && " +
		"request_type = {:requestType}"
	records, err := app.FindRecordsByFilter(
		"bunk_requests",
		filter,
		"id",
		0, // 0 = unlimited
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
	return records, nil
}

// anyResolved reports whether any row in the slice has status = "resolved".
func anyResolved(rows []*core.Record) bool {
	for _, r := range rows {
		if r.GetString("status") == statusResolved {
			return true
		}
	}
	return false
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
