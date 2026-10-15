package sync

import (
	"strconv"
	"strings"

	"github.com/pocketbase/dbx"
)

// Every value a Go filter compares against is bound through a `{:name}`
// placeholder and dbx.Params, never pasted into the filter text (kindred#3195).
// PocketBase quotes a bound value itself, so a quote inside it stays data. The
// guard in pb_filter_param_guard_test.go fails CI on a pasted value.

// equalsAnyFilter returns `(field = {:any0} || field = {:any1} || ...)` and the
// params that bind it, for matching a field against a batch of values. Pass
// the params as the trailing argument of FindRecordsByFilter. The placeholder
// names are fixed, so combine it only with filters whose own placeholders are
// named differently. Callers check for an empty batch first: no values yields
// "()", which PocketBase rejects.
func equalsAnyFilter(field string, values []string) (string, dbx.Params) {
	conditions := make([]string, len(values))
	params := make(dbx.Params, len(values))
	for i, v := range values {
		name := "any" + strconv.Itoa(i)
		conditions[i] = field + " = {:" + name + "}"
		params[name] = v
	}
	return "(" + strings.Join(conditions, " || ") + ")", params
}
