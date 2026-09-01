package sync

import (
	"fmt"

	"github.com/pocketbase/pocketbase/core"
)

// customValuesPreloadKey returns the preload key builder shared by
// syncPersonCustomFieldValues (person_custom_field_values.go) and
// syncHouseholdCustomFieldValues (household_custom_field_values.go). The two
// were identical closures apart from which relation column names the owner
// -- ownerField is that column name ("person" or "household").
//
// KeyBuilder returns identity only (ownerPBId:fieldDefPBId)
// PreloadCompositeRecords appends |year to create yearScopedKey
//
// kindred#2661: extracted out of the two Sync() methods so the orphan replay
// tests for both services (person_custom_field_values_orphan_replay_test.go,
// household_custom_field_values_orphan_replay_test.go) can call the real
// builder instead of keeping their own hand-copied twin.
func customValuesPreloadKey(ownerField string) func(*core.Record) (string, bool) {
	return func(record *core.Record) (string, bool) {
		ownerPBId := record.GetString(ownerField)
		fieldDefPBId := record.GetString("field_definition")

		if ownerPBId != "" && fieldDefPBId != "" {
			// Return identity only - PreloadCompositeRecords adds |year
			return fmt.Sprintf("%s:%s", ownerPBId, fieldDefPBId), true
		}
		return "", false
	}
}
