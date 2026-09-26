package rbac

import (
	"encoding/json"
	"os"
	"slices"
	"strings"
	"testing"
)

// bootedField is the slice of a collection field this file reads.
type bootedField struct {
	Name     string `json:"name"`
	Type     string `json:"type"`
	Required bool   `json:"required"`
}

// bootedCollectionWithFields adds fields to users_rules_schema_test.go's
// bootedCollection (embedded, so its *string rules keep null and "" apart).
type bootedCollectionWithFields struct {
	bootedCollection
	Fields []bootedField `json:"fields"`
}

// loadBootedCollections reads the /api/collections dump CI's Migrations &
// Schema Agreement job writes (pocketbase/pb_sp2/boot-schema.sh locally).
func loadBootedCollections(t *testing.T) []bootedCollectionWithFields {
	t.Helper()
	path := os.Getenv("KINDRED_PROD_SCHEMA_JSON")
	if path == "" {
		t.Skip("KINDRED_PROD_SCHEMA_JSON not set -- runs in CI's Migrations & Schema Agreement job only")
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	var dump struct {
		Items []bootedCollectionWithFields `json:"items"`
	}
	if err := json.Unmarshal(raw, &dump); err != nil {
		t.Fatalf("parse %s: %v", path, err)
	}
	if len(dump.Items) == 0 {
		t.Fatalf("%s lists no collections -- the boot produced nothing to assert against", path)
	}
	return dump.Items
}

// assertAllRulesNull: nil (superusers only) on all five rules. "" would be
// PUBLIC; any filter at all would open the table to the SDK.
//
//nolint:gocritic // hugeParam: by value so callers pass range variables as-is (Task 5 does)
func assertAllRulesNull(t *testing.T, c bootedCollectionWithFields) {
	t.Helper()
	for which, got := range map[string]*string{
		"listRule": c.ListRule, "viewRule": c.ViewRule, "createRule": c.CreateRule,
		"updateRule": c.UpdateRule, "deleteRule": c.DeleteRule,
	} {
		assertRule(t, c.Name, which, got, nil)
	}
}

// TestBootedSchemaFinancialAidRulesAreNull: every per-family financial table
// is closed to the SDK (campership spec §14.3). FastAPI reads as superuser
// behind require_permission; the Go sync writes through app.Save.
func TestBootedSchemaFinancialAidRulesAreNull(t *testing.T) {
	cols := loadBootedCollections(t)
	byName := make(map[string]bootedCollectionWithFields, len(cols))
	for _, c := range cols {
		byName[c.Name] = c
	}

	t.Run("legacy financial tables", func(t *testing.T) {
		for _, name := range []string{"financial_transactions", "financial_aid_applications"} {
			c, ok := byName[name]
			if !ok {
				t.Errorf("collection %q missing from the booted schema", name)
				continue
			}
			assertAllRulesNull(t, c)
		}
	})

	// Discovered by PREFIX, so an aid_ collection a later sub-project adds is
	// covered the day it lands, with no list here to update. Case-folded:
	// PocketBase resolves collection names case-insensitively.
	t.Run("every aid_ collection", func(t *testing.T) {
		var found []string
		for _, c := range cols {
			if strings.HasPrefix(strings.ToLower(c.Name), "aid_") {
				found = append(found, c.Name)
				assertAllRulesNull(t, c)
			}
		}
		// Without this the loop can pass by looking at nothing.
		if !slices.Contains(found, "aid_change_log") {
			t.Fatalf("aid_change_log missing; aid_ collections found: %v -- the prefix check is checking nothing", found)
		}
	})
}

// TestBootedAidChangeLogShape pins the fixed contract other sub-projects write
// against (bunking/financial_aid/change_log.py): exactly these fields, these
// types, these required flags.
func TestBootedAidChangeLogShape(t *testing.T) {
	cols := loadBootedCollections(t)
	var fields []bootedField
	found := false
	for _, c := range cols {
		if c.Name == "aid_change_log" {
			fields, found = c.Fields, true
		}
	}
	if !found {
		t.Fatal("aid_change_log missing from the booted schema")
	}
	type spec struct {
		typ      string
		required bool
	}
	want := map[string]spec{
		"entity":    {"text", true},
		"entity_id": {"text", true},
		"year":      {"number", true},
		"action":    {"text", true},
		"before":    {"json", false},
		"after":     {"json", false},
		"actor":     {"text", true},
		"reason":    {"text", false},
		"created":   {"autodate", false},
		// Sub-project 4a (1500000194): the rows of one staff action share an
		// operation_id; persona is the "view as" persona a write was made under.
		"operation_id": {"text", true},
		"persona":      {"text", false},
	}
	got := make(map[string]bootedField, len(fields))
	for _, f := range fields {
		got[f.Name] = f
	}
	for name, w := range want {
		f, ok := got[name]
		if !ok {
			t.Errorf("aid_change_log.%s missing", name)
			continue
		}
		if f.Type != w.typ || f.Required != w.required {
			t.Errorf("aid_change_log.%s = %s required=%v, want %s required=%v", name, f.Type, f.Required, w.typ, w.required)
		}
	}
	for name := range got {
		if _, ok := want[name]; !ok && name != "id" {
			t.Errorf("aid_change_log.%s is not in the fixed contract", name)
		}
	}
}
