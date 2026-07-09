package rbac

import (
	"testing"

	"github.com/pocketbase/pocketbase/core"
)

// TestExtractBusinessCategoryReadsRealRecordMetadata exercises the runtime path
// the pure decideConfigWrite tests bypass: reading metadata.business_category off
// an actual *core.Record. Record.Get on a json field returns types.JSONRaw
// ([]byte), NOT a map[string]any — the original extractBusinessCategory asserted
// map[string]any and silently returned "", which made guardConfigWrite deny
// EVERY non-admin config write (existingCategory was always ""). This test locks
// in that extractBusinessCategory decodes the real stored/post-body value.
func TestExtractBusinessCategoryReadsRealRecordMetadata(t *testing.T) {
	collection := core.NewBaseCollection("config")
	collection.Fields.Add(&core.JSONField{Name: "metadata"})

	newRecordWithMetadata := func(meta any) *core.Record {
		rec := core.NewRecord(collection)
		rec.Set("metadata", meta)
		return rec
	}

	cases := []struct {
		name string
		meta any
		want string
	}{
		{"json object with category", map[string]any{"business_category": "registration"}, "registration"},
		{"json object without category key", map[string]any{"friendly_name": "x"}, ""},
		{"empty metadata", map[string]any{}, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := newRecordWithMetadata(tc.meta)
			if got := extractBusinessCategory(rec.Get("metadata")); got != tc.want {
				t.Fatalf("extractBusinessCategory(record.Get(%q)) = %q, want %q", "metadata", got, tc.want)
			}
		})
	}

	// The decoded-map path (e.g. a request body value) must still work.
	if got := extractBusinessCategory(map[string]any{"business_category": "solver"}); got != "solver" {
		t.Fatalf("extractBusinessCategory(map) = %q, want %q", got, "solver")
	}
}

func TestDecideConfigWrite(t *testing.T) {
	tests := []struct {
		name                  string
		isSuperuser           bool
		isAdmin               bool
		hasRegistrationManage bool
		originalCategory      string // stored category (empty for creates)
		resultCategory        string // post-body category that will be saved
		isCreate              bool
		want                  configWriteDecision
	}{
		{
			// Regression: a PocketBase superuser writing config via the _/ admin
			// dashboard has neither is_admin nor cached_permissions, so without an
			// explicit bypass it was wrongly denied "Missing registration.manage".
			name:        "superuser bypasses all checks",
			isSuperuser: true,
			want:        configWriteAllow,
		},
		{
			name:             "admin bypasses all checks on a solver config",
			isAdmin:          true,
			originalCategory: "solver",
			resultCategory:   "solver",
			want:             configWriteAllow,
		},
		{
			name:             "non-admin without registration.manage is denied",
			originalCategory: "registration",
			resultCategory:   "registration",
			want:             configWriteDenyMissingPermission,
		},
		{
			name:                  "registration.manage editing a registration config is allowed",
			hasRegistrationManage: true,
			originalCategory:      "registration",
			resultCategory:        "registration",
			want:                  configWriteAllow,
		},
		{
			// Eligibility: the STORED category must be registration. Reading the
			// original (not the post-body) value blocks relabelling a solver
			// config to "registration" in the same PATCH to gain edit access.
			name:                  "registration.manage editing a solver config is denied",
			hasRegistrationManage: true,
			originalCategory:      "solver",
			resultCategory:        "solver",
			want:                  configWriteDenyWrongCategory,
		},
		{
			name:                  "registration.manage relabelling a solver config to registration is denied",
			hasRegistrationManage: true,
			originalCategory:      "solver",
			resultCategory:        "registration",
			want:                  configWriteDenyWrongCategory,
		},
		{
			name:                  "registration.manage mutating category to solver is denied",
			hasRegistrationManage: true,
			originalCategory:      "registration",
			resultCategory:        "solver",
			want:                  configWriteDenyCategoryMutation,
		},
		{
			// #1732: blanking the category — whether by sending business_category:""
			// or by omitting it under json-replace semantics — yields an empty
			// resulting category and must be denied.
			name:                  "registration.manage blanking category is denied",
			hasRegistrationManage: true,
			originalCategory:      "registration",
			resultCategory:        "",
			want:                  configWriteDenyCategoryMutation,
		},
		{
			name:                  "registration.manage creating a registration config is allowed",
			hasRegistrationManage: true,
			resultCategory:        "registration",
			isCreate:              true,
			want:                  configWriteAllow,
		},
		{
			name:                  "registration.manage creating a solver config is denied",
			hasRegistrationManage: true,
			resultCategory:        "solver",
			isCreate:              true,
			want:                  configWriteDenyWrongCategory,
		},
		{
			name:                  "registration.manage creating a category-less config is denied",
			hasRegistrationManage: true,
			resultCategory:        "",
			isCreate:              true,
			want:                  configWriteDenyWrongCategory,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := decideConfigWrite(
				tt.isSuperuser,
				tt.isAdmin,
				tt.hasRegistrationManage,
				tt.originalCategory,
				tt.resultCategory,
				tt.isCreate,
			)
			if got != tt.want {
				t.Errorf("decideConfigWrite() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestFlattenPermissions(t *testing.T) {
	tests := []struct {
		name     string
		roles    [][]string
		expected []string
	}{
		{
			name:     "single role single permission",
			roles:    [][]string{{"bunking.view"}},
			expected: []string{"bunking.view"},
		},
		{
			name:     "multiple roles with overlap",
			roles:    [][]string{{"bunking.view", "bunking.manage"}, {"bunking.view", "metrics.view"}},
			expected: []string{"bunking.manage", "bunking.view", "metrics.view"},
		},
		{
			name:     "empty roles",
			roles:    [][]string{},
			expected: []string{},
		},
		{
			name:     "role with empty permissions",
			roles:    [][]string{{}},
			expected: []string{},
		},
		{
			name:     "all permissions from multiple roles",
			roles:    [][]string{{"sync.run", "solver.configure"}, {"metrics.view", "metrics.financial"}, {"bunking.view"}},
			expected: []string{"bunking.view", "metrics.financial", "metrics.view", "solver.configure", "sync.run"},
		},
		{
			name:     "completely duplicate roles",
			roles:    [][]string{{"bunking.view", "bunking.manage"}, {"bunking.view", "bunking.manage"}},
			expected: []string{"bunking.manage", "bunking.view"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := flattenPermissions(tt.roles)
			if len(result) != len(tt.expected) {
				t.Errorf("expected %d permissions, got %d: %v", len(tt.expected), len(result), result)
				return
			}
			for i, perm := range result {
				if perm != tt.expected[i] {
					t.Errorf("at index %d: expected %q, got %q", i, tt.expected[i], perm)
				}
			}
		})
	}
}
