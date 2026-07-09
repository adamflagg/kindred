package rbac

import (
	"testing"
)

func TestDecideConfigWrite(t *testing.T) {
	tests := []struct {
		name                  string
		isSuperuser           bool
		isAdmin               bool
		hasRegistrationManage bool
		existingCategory      string
		newCategory           string
		newCategoryProvided   bool
		bodyReadable          bool
		want                  configWriteDecision
	}{
		{
			// Regression: a PocketBase superuser writing config via the _/ admin
			// dashboard has neither is_admin nor cached_permissions, so without an
			// explicit bypass it was wrongly denied "Missing registration.manage".
			name:         "superuser bypasses all checks",
			isSuperuser:  true,
			bodyReadable: true,
			want:         configWriteAllow,
		},
		{
			name:             "superuser without admin/permission on a solver config is still allowed",
			isSuperuser:      true,
			existingCategory: "solver",
			bodyReadable:     true,
			want:             configWriteAllow,
		},
		{
			name:             "admin bypasses all checks",
			isAdmin:          true,
			existingCategory: "solver",
			bodyReadable:     true,
			want:             configWriteAllow,
		},
		{
			// Admins bypass before the fail-closed body check, so an unreadable
			// body must not affect them.
			name:         "admin allowed even when request body is unreadable",
			isAdmin:      true,
			bodyReadable: false,
			want:         configWriteAllow,
		},
		{
			name:             "non-admin without registration.manage is denied",
			existingCategory: "registration",
			bodyReadable:     true,
			want:             configWriteDenyMissingPermission,
		},
		{
			name:                  "registration.manage on a registration config is allowed",
			hasRegistrationManage: true,
			existingCategory:      "registration",
			bodyReadable:          true,
			want:                  configWriteAllow,
		},
		{
			name:                  "registration.manage on a non-registration config is denied",
			hasRegistrationManage: true,
			existingCategory:      "solver",
			bodyReadable:          true,
			want:                  configWriteDenyWrongCategory,
		},
		{
			name:                  "registration.manage mutating category is denied",
			hasRegistrationManage: true,
			existingCategory:      "registration",
			newCategory:           "solver",
			newCategoryProvided:   true,
			bodyReadable:          true,
			want:                  configWriteDenyCategoryMutation,
		},
		{
			name:                  "registration.manage same-category update is allowed",
			hasRegistrationManage: true,
			existingCategory:      "registration",
			newCategory:           "registration",
			newCategoryProvided:   true,
			bodyReadable:          true,
			want:                  configWriteAllow,
		},
		{
			// #1732: an explicit business_category:"" is a mutation away from
			// "registration" and must be denied, not silently allowed.
			name:                  "registration.manage blanking category (explicit empty) is denied",
			hasRegistrationManage: true,
			existingCategory:      "registration",
			newCategory:           "",
			newCategoryProvided:   true,
			bodyReadable:          true,
			want:                  configWriteDenyCategoryMutation,
		},
		{
			// A true omission (no business_category in the body) leaves the
			// category untouched and stays allowed.
			name:                  "registration.manage omitting category is allowed",
			hasRegistrationManage: true,
			existingCategory:      "registration",
			newCategoryProvided:   false,
			bodyReadable:          true,
			want:                  configWriteAllow,
		},
		{
			// #1732: if the request body can't be read we cannot verify the write
			// isn't mutating the category, so a non-admin write fails closed.
			name:                  "registration.manage with unreadable body is denied (fail closed)",
			hasRegistrationManage: true,
			existingCategory:      "registration",
			bodyReadable:          false,
			want:                  configWriteDenyCategoryMutation,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := decideConfigWrite(
				tt.isSuperuser,
				tt.isAdmin,
				tt.hasRegistrationManage,
				tt.existingCategory,
				tt.newCategory,
				tt.newCategoryProvided,
				tt.bodyReadable,
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
